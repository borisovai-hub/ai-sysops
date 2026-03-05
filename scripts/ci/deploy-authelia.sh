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

# [2/4] Проверка email пользователя в users_database.yml
USERS_DB="/etc/authelia/users_database.yml"
if [ -f "$USERS_DB" ]; then
    # Источники: CI Variables → install-config.json
    AUTHELIA_USERNAME="${AUTHELIA_USERNAME:-$(get_config_value "authelia_username" 2>/dev/null)}"
    AUTHELIA_EMAIL="${AUTHELIA_EMAIL:-$(get_config_value "authelia_email" 2>/dev/null)}"
    if [ -n "$AUTHELIA_EMAIL" ]; then
        # Сохранить в install-config для будущих переустановок
        save_config_value "authelia_email" "$AUTHELIA_EMAIL" 2>/dev/null || true
        [ -n "$AUTHELIA_USERNAME" ] && save_config_value "authelia_username" "$AUTHELIA_USERNAME" 2>/dev/null || true

        # Определение целевого пользователя в YAML
        TARGET_USER="${AUTHELIA_USERNAME:-admin}"

        # Извлечение email только для целевого пользователя (awk: найти блок user, вернуть email)
        CURRENT_EMAIL=$(awk -v user="  ${TARGET_USER}:" '
            $0 == user { found=1; next }
            found && /^  [^ ]/ { found=0 }
            found && /email:/ { gsub(/.*email:[[:space:]]*/, ""); gsub(/['"'"'"]/, ""); print; exit }
        ' "$USERS_DB" 2>/dev/null || true)

        echo "  [Диагностика] user=${TARGET_USER}, текущий email='${CURRENT_EMAIL:-пусто}', целевой='${AUTHELIA_EMAIL}'"

        if [ -n "$CURRENT_EMAIL" ] && [ "$CURRENT_EMAIL" != "$AUTHELIA_EMAIL" ]; then
            echo "  Обновление email: $CURRENT_EMAIL -> $AUTHELIA_EMAIL"
            # Замена только в блоке целевого пользователя (sed address range)
            sed -i "/^  ${TARGET_USER}:/,/^  [^ ]/{ s|email:.*|email: '${AUTHELIA_EMAIL}'| }" "$USERS_DB"
            UPDATED=$((UPDATED + 1))
        elif [ -z "$CURRENT_EMAIL" ]; then
            echo "  [Предупреждение] Email для ${TARGET_USER} не найден в файле"
            UPDATED=$((UPDATED + 1))
        else
            echo "  [OK] email для ${TARGET_USER} актуален"
            UPDATED=$((UPDATED + 1))
        fi

        # Очистка OIDC сессий/токенов в SQLite — старые токены содержат закешированный email
        AUTHELIA_DB="/var/lib/authelia/db.sqlite3"
        if [ -f "$AUTHELIA_DB" ] && command -v sqlite3 &>/dev/null; then
            echo "  Очистка OIDC сессий (сброс закешированных claims)..."
            sqlite3 "$AUTHELIA_DB" "DELETE FROM oauth2_consent_session;" 2>/dev/null || true
            sqlite3 "$AUTHELIA_DB" "DELETE FROM oauth2_access_token_session;" 2>/dev/null || true
            sqlite3 "$AUTHELIA_DB" "DELETE FROM oauth2_refresh_token_session;" 2>/dev/null || true
            sqlite3 "$AUTHELIA_DB" "DELETE FROM oauth2_authorization_code_session;" 2>/dev/null || true
            sqlite3 "$AUTHELIA_DB" "DELETE FROM oauth2_pkce_request_session;" 2>/dev/null || true
            sqlite3 "$AUTHELIA_DB" "DELETE FROM oauth2_openid_connect_session;" 2>/dev/null || true
            echo "  [OK] OIDC сессии очищены"
        elif [ -f "$AUTHELIA_DB" ]; then
            echo "  [Предупреждение] sqlite3 не установлен — не удалось очистить OIDC кеш"
        fi
    fi
    # Обновить displayname если указан
    AUTHELIA_DISPLAYNAME="${AUTHELIA_DISPLAYNAME:-$(get_config_value "authelia_displayname" 2>/dev/null)}"
    if [ -n "$AUTHELIA_DISPLAYNAME" ]; then
        CURRENT_DISPLAYNAME=$(awk -v user="  ${TARGET_USER}:" '
            $0 == user { found=1; next }
            found && /^  [^ ]/ { found=0 }
            found && /displayname:/ { gsub(/.*displayname:[[:space:]]*/, ""); gsub(/['"'"'"]/, ""); print; exit }
        ' "$USERS_DB" 2>/dev/null || true)
        if [ -n "$CURRENT_DISPLAYNAME" ] && [ "$CURRENT_DISPLAYNAME" != "$AUTHELIA_DISPLAYNAME" ]; then
            echo "  Обновление displayname: $CURRENT_DISPLAYNAME -> $AUTHELIA_DISPLAYNAME"
            sed -i "/^  ${TARGET_USER}:/,/^  [^ ]/{ s|displayname:.*|displayname: '${AUTHELIA_DISPLAYNAME}'| }" "$USERS_DB"
            UPDATED=$((UPDATED + 1))
        fi
    fi
fi

# [3/4] Проверка authelia@file middleware в Traefik конфигах
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
_ensure_authelia_middleware "$TRAEFIK_DYN/analytics.yml"
# files.yml — публичное файловое хранилище, без Authelia
# Удалить authelia@file если был добавлен ранее
if [ -f "$TRAEFIK_DYN/files.yml" ] && grep -q "authelia@file" "$TRAEFIK_DYN/files.yml"; then
    sed -i '/authelia@file/d' "$TRAEFIK_DYN/files.yml"
    echo "  [OK] files.yml — authelia@file удалён (публичный сервис)"
    UPDATED=$((UPDATED + 1))
fi

# Mailu: отдельная обработка (mailu-compress)
if [ -f "$TRAEFIK_DYN/mailu.yml" ] && ! grep -q "authelia@file" "$TRAEFIK_DYN/mailu.yml"; then
    sed -i '/- mailu-compress$/a\        - authelia@file' "$TRAEFIK_DYN/mailu.yml"
    echo "  [OK] mailu.yml — authelia@file добавлен"
    UPDATED=$((UPDATED + 1))
elif [ -f "$TRAEFIK_DYN/mailu.yml" ]; then
    echo "  [OK] mailu.yml — authelia@file есть"
fi

# [4/4] Management UI использует Authelia ForwardAuth (OIDC больше не нужен)
MGMT_CONFIG="/etc/management-ui/config.json"
if [ -f "$MGMT_CONFIG" ] && grep -q '"oidc"' "$MGMT_CONFIG"; then
    echo "  [Инфо] OIDC секция в config.json больше не используется (ForwardAuth через Traefik)"
fi

# Диагностика: показать актуальный email из users_database.yml (после всех изменений)
if [ -f "$USERS_DB" ]; then
    DIAG_LINE=$(grep 'email:' "$USERS_DB" 2>/dev/null || echo "строка не найдена")
    echo "  [Диагностика ПОСЛЕ] email строка: $DIAG_LINE"
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
    # Перезапуск Authelia при изменениях в конфиге или users_database
    if systemctl is-active --quiet authelia 2>/dev/null; then
        echo "  Перезапуск Authelia..."
        systemctl restart authelia
        sleep 2
        if systemctl is-active --quiet authelia; then
            echo "  [OK] Authelia перезапущена"
        else
            echo "  [ОШИБКА] Authelia не запустилась после перезапуска"
        fi
    fi
fi

echo "=== Authelia задеплоена ==="
