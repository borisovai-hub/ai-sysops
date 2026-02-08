#!/bin/bash
# Инкрементальный деплой Authelia SSO
# Если Authelia не установлена — пропуск (используйте manual job install:authelia)
# Если установлена — проверяет и обновляет Traefik конфиги и OIDC настройки
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Деплой Authelia ==="

# Если Authelia не установлена — пропуск
if [ ! -f "/usr/local/bin/authelia" ]; then
    echo "Authelia не установлена — пропуск (запустите install:authelia job)"
    exit 0
fi

echo "Authelia установлена, проверка конфигурации..."

# Загрузка общих функций
COMMON_SH="$REPO_ROOT/scripts/single-machine/common.sh"
if [ -f "$COMMON_SH" ]; then
    source "$COMMON_SH"
fi

TRAEFIK_DYN="/etc/traefik/dynamic"
AUTHELIA_PORT=$(get_config_value "authelia_port" 2>/dev/null)
[ -z "$AUTHELIA_PORT" ] && AUTHELIA_PORT="9091"
AUTHELIA_PREFIX=$(get_config_value "auth_prefix" 2>/dev/null)
[ -z "$AUTHELIA_PREFIX" ] && AUTHELIA_PREFIX="auth"

UPDATED=0

# [1/3] Проверка authelia.yml в Traefik
AUTHELIA_YML="$TRAEFIK_DYN/authelia.yml"
if [ ! -f "$AUTHELIA_YML" ]; then
    echo "  Создание authelia.yml..."
    # Раздельные роутеры (по одному на домен) — избегаем SAN-конфликт в Let's Encrypt
    ROUTERS_YAML=""
    HAS_DOMAINS=false
    while IFS= read -r base; do
        [ -z "$base" ] && continue
        HAS_DOMAINS=true
        SUFFIX=$(echo "$base" | sed 's/.*\.//')
        ROUTERS_YAML="${ROUTERS_YAML}
    authelia-${SUFFIX}:
      rule: \"Host(\`${AUTHELIA_PREFIX}.${base}\`)\"
      service: authelia
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
"
    done < <(get_base_domains 2>/dev/null)

    if [ "$HAS_DOMAINS" = true ]; then
        cat > "$AUTHELIA_YML" << TRAEFIKEOF
http:
  middlewares:
    authelia:
      forwardAuth:
        address: 'http://127.0.0.1:${AUTHELIA_PORT}/api/authz/forward-auth'
        trustForwardHeader: true
        authResponseHeaders:
          - 'Remote-User'
          - 'Remote-Groups'
          - 'Remote-Email'
          - 'Remote-Name'

  routers:${ROUTERS_YAML}
  services:
    authelia:
      loadBalancer:
        servers:
          - url: 'http://127.0.0.1:${AUTHELIA_PORT}'
TRAEFIKEOF
        chmod 644 "$AUTHELIA_YML"
        echo "  [OK] authelia.yml создан"
        UPDATED=$((UPDATED + 1))
    else
        echo "  [Предупреждение] Не удалось получить base_domains для authelia.yml"
    fi
else
    echo "  [OK] authelia.yml существует"
fi

# [2/3] Проверка authelia@file middleware в Traefik конфигах
_ensure_authelia_middleware() {
    local yml_file="$1"
    local fname
    fname=$(basename "$yml_file")
    if [ ! -f "$yml_file" ]; then
        return
    fi
    if grep -q "authelia@file" "$yml_file"; then
        echo "  [OK] $fname — authelia@file есть"
        return
    fi
    if grep -q "\-compress$" "$yml_file"; then
        sed -i '/- .*-compress$/a\        - authelia@file' "$yml_file"
        echo "  [OK] $fname — authelia@file добавлен"
        UPDATED=$((UPDATED + 1))
    fi
}

echo "  Проверка authelia@file middleware..."
_ensure_authelia_middleware "$TRAEFIK_DYN/management-ui.yml"
_ensure_authelia_middleware "$TRAEFIK_DYN/n8n.yml"

# Mailu: отдельная обработка (mailu-compress)
if [ -f "$TRAEFIK_DYN/mailu.yml" ] && ! grep -q "authelia@file" "$TRAEFIK_DYN/mailu.yml"; then
    sed -i '/- mailu-compress$/a\        - authelia@file' "$TRAEFIK_DYN/mailu.yml"
    echo "  [OK] mailu.yml — authelia@file добавлен"
    UPDATED=$((UPDATED + 1))
elif [ -f "$TRAEFIK_DYN/mailu.yml" ]; then
    echo "  [OK] mailu.yml — authelia@file есть"
fi

# [3/3] Проверка OIDC секции в Management UI config.json
MGMT_CONFIG="/etc/management-ui/config.json"
if [ -f "$MGMT_CONFIG" ]; then
    if grep -q '"oidc"' "$MGMT_CONFIG"; then
        echo "  [OK] OIDC секция в config.json есть"
    else
        MGMT_OIDC_SECRET=""
        if [ -f "/etc/authelia/secrets/mgmt_client_secret" ]; then
            MGMT_OIDC_SECRET=$(cat /etc/authelia/secrets/mgmt_client_secret)
        fi
        if [ -n "$MGMT_OIDC_SECRET" ]; then
            COOKIE_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 32 /dev/urandom | xxd -p | tr -d '\n')
            FIRST_BASE=$(get_config_value "base_domains" 2>/dev/null | tr ',' '\n' | head -1)
            [ -z "$FIRST_BASE" ] && FIRST_BASE="borisovai.ru"
            BASE_URL="https://admin.${FIRST_BASE}"
            ISSUER_URL="https://${AUTHELIA_PREFIX}.${FIRST_BASE}"

            cp "$MGMT_CONFIG" "${MGMT_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
            sed -i '$ s/}//' "$MGMT_CONFIG"
            cat >> "$MGMT_CONFIG" << OIDCEOF
  ,"oidc": {
    "enabled": true,
    "issuer": "${ISSUER_URL}",
    "base_url": "${BASE_URL}",
    "client_id": "management-ui",
    "client_secret": "${MGMT_OIDC_SECRET}",
    "cookie_secret": "${COOKIE_SECRET}"
  }
}
OIDCEOF
            chmod 600 "$MGMT_CONFIG"
            echo "  [OK] OIDC секция добавлена в config.json"
            systemctl restart management-ui 2>/dev/null || true
            UPDATED=$((UPDATED + 1))
        else
            echo "  [Предупреждение] mgmt_client_secret не найден — OIDC не настроен"
        fi
    fi
fi

# Health check
echo -n "  Authelia health... "
if curl -sf --max-time 5 http://127.0.0.1:${AUTHELIA_PORT}/api/health > /dev/null 2>&1; then
    echo "OK"
else
    echo "ПРЕДУПРЕЖДЕНИЕ (сервис может быть не запущен)"
fi

if [ "$UPDATED" -eq 0 ]; then
    echo "  Конфигурация без изменений"
else
    echo "  Обновлено: $UPDATED элемент(ов)"
fi

echo "=== Authelia задеплоена ==="
