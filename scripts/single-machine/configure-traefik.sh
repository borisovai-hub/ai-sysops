#!/bin/bash
# Скрипт конфигурации Traefik для всех сервисов
# Использование:
#   sudo ./configure-traefik.sh  # использует base_domains из /etc/install-config.json
#   sudo ./configure-traefik.sh <gitlab-domain> <n8n-domain> <ui-domain> [--force]
#
# Примечание: Скрипт можно запускать из любой директории.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Предупреждение: common.sh не найден"
fi

set +e

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

FORCE_MODE=false
POSITIONAL_ARGS=()
for arg in "$@"; do
    case $arg in
        --force) FORCE_MODE=true ;;
        *) POSITIONAL_ARGS+=("$arg") ;;
    esac
done

GITLAB_DOMAIN="${POSITIONAL_ARGS[0]:-}"
N8N_DOMAIN="${POSITIONAL_ARGS[1]:-}"
UI_DOMAIN="${POSITIONAL_ARGS[2]:-}"

# Режим базовых доменов: без аргументов — читаем из конфига
USE_BASE_DOMAINS=false
if [ -z "$GITLAB_DOMAIN" ] && [ -z "$N8N_DOMAIN" ] && [ -z "$UI_DOMAIN" ]; then
    if [ -n "$(get_config_value "base_domains")" ]; then
        USE_BASE_DOMAINS=true
        GITLAB_PREFIX=$(get_config_value "gitlab_prefix")
        [ -z "$GITLAB_PREFIX" ] && GITLAB_PREFIX="gitlab"
        N8N_PREFIX=$(get_config_value "n8n_prefix")
        [ -z "$N8N_PREFIX" ] && N8N_PREFIX="n8n"
        UI_PREFIX=$(get_config_value "ui_prefix")
        [ -z "$UI_PREFIX" ] && UI_PREFIX="ui"
        GITLAB_MIDDLE=$(get_config_value "gitlab_middle")
        N8N_MIDDLE=$(get_config_value "n8n_middle")
        UI_MIDDLE=$(get_config_value "ui_middle")
        SITE_PREFIX=$(get_config_value "site_prefix")
        SITE_PORT=$(get_config_value "site_port")
    fi
fi

if [ "$USE_BASE_DOMAINS" != true ] && { [ -z "$GITLAB_DOMAIN" ] || [ -z "$N8N_DOMAIN" ] || [ -z "$UI_DOMAIN" ]; }; then
    echo "Использование: $0 [<gitlab-domain> <n8n-domain> <ui-domain>] [--force]"
    echo "  Без аргументов — используются base_domains из /etc/install-config.json"
    exit 1
fi

# Построить строку доменов для сервиса (Host(`a`) || Host(`b`))
# Второй аргумент — опциональный «средний» уровень (например dev: gitlab.dev.borisovai.ru)
build_host_rule() {
    local prefix="$1"
    local middle="${2:-}"
    local domains=""
    if [ "$USE_BASE_DOMAINS" = true ]; then
        while IFS= read -r full; do
            [ -z "$full" ] && continue
            if [ -n "$domains" ]; then
                domains="${domains} || Host(\`${full}\`)"
            else
                domains="Host(\`${full}\`)"
            fi
        done < <(build_service_domains "$prefix" "$middle")
    fi
    echo "$domains"
}

# Правило из списка полных имён хостов (через запятую). Если для n8n/ui нет DNS на всех base_domains — задайте n8n_hosts/management_ui_hosts в конфиге.
build_host_rule_from_list() {
    local list="$1"
    local domains=""
    local h
    while IFS= read -r h; do
        h=$(echo "$h" | sed 's/\r//g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')
        [ -z "$h" ] && continue
        if [ -n "$domains" ]; then
            domains="${domains} || Host(\`${h}\`)"
        else
            domains="Host(\`${h}\`)"
        fi
    done < <(echo "$list" | tr ',' '\n')
    echo "$domains"
}

# Сайт (Next.js) включён, если задан site_port в конфиге
site_domains_configured() {
    [ "$USE_BASE_DOMAINS" != true ] && return 1
    [ -n "$(get_config_value "site_port")" ] || return 1
    local rule
    rule=$(build_host_rule "${SITE_PREFIX:-}")
    [ -n "$rule" ]
}

# Первый домен сервиса (для вывода и обратной совместимости)
first_domain() {
    local prefix="$1"
    local middle="${2:-}"
    if [ "$USE_BASE_DOMAINS" = true ]; then
        build_service_domains "$prefix" "$middle" | head -1
    else
        echo "$3"
    fi
}

if [ "$USE_BASE_DOMAINS" = true ]; then
    GITLAB_DOMAIN=$(first_domain "$GITLAB_PREFIX" "$GITLAB_MIDDLE" "$GITLAB_DOMAIN")
    N8N_HOSTS_CFG=$(get_config_value "n8n_hosts")
    if [ -n "$N8N_HOSTS_CFG" ]; then
        N8N_DOMAIN=$(echo "$N8N_HOSTS_CFG" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | head -1)
    else
        N8N_DOMAIN=$(first_domain "$N8N_PREFIX" "$N8N_MIDDLE" "$N8N_DOMAIN")
    fi
    MGMT_UI_HOSTS_CFG=$(get_config_value "management_ui_hosts")
    if [ -n "$MGMT_UI_HOSTS_CFG" ]; then
        UI_DOMAIN=$(echo "$MGMT_UI_HOSTS_CFG" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | head -1)
    else
        UI_DOMAIN=$(first_domain "$UI_PREFIX" "$UI_MIDDLE" "$UI_DOMAIN")
    fi
fi

echo "=== Конфигурация Traefik для всех сервисов ==="
echo ""

DYNAMIC_DIR="/etc/traefik/dynamic"
mkdir -p "$DYNAMIC_DIR"

# Удаление \r и пробелов по краям (чтобы в YAML не попадали непечатаемые символы)
_sanitize_for_yaml() {
    sed 's/\r//g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

update_config() {
    local config_file="$1"
    local service_name="$2"
    local domain_or_rule="$3"
    local backend_url="$4"
    local middle="${5:-}"
    local explicit_rule="${6:-}"
    domain_or_rule=$(echo "$domain_or_rule" | _sanitize_for_yaml)
    backend_url=$(echo "$backend_url" | _sanitize_for_yaml)
    local host_rule="$domain_or_rule"
    if [ -n "$explicit_rule" ]; then
        host_rule=$(echo "$explicit_rule" | _sanitize_for_yaml)
    elif [ "$USE_BASE_DOMAINS" = true ]; then
        if echo "$domain_or_rule" | grep -q ','; then
            host_rule=""
            local part
            while IFS= read -r prefix; do
                [ -z "$prefix" ] && continue
                part=$(build_host_rule "$prefix" "")
                [ -n "$part" ] && host_rule="${host_rule:+$host_rule || }$part"
            done < <(echo "$domain_or_rule" | tr ',' '\n' | _sanitize_for_yaml)
        else
            host_rule=$(build_host_rule "$domain_or_rule" "$middle")
        fi
    else
        host_rule="Host(\`${domain_or_rule}\`)"
    fi
    host_rule=$(echo "$host_rule" | _sanitize_for_yaml)
    if [ -z "$host_rule" ]; then
        echo "  [Ошибка] Нет доменов для $service_name"
        return 1
    fi

    if [ "$FORCE_MODE" = true ] || [ ! -f "$config_file" ]; then
        if [ "$service_name" = "gitlab" ]; then
            cat > "$config_file" << EOF
http:
  middlewares:
    gitlab-headers:
      headers:
        customRequestHeaders:
          X-Forwarded-Proto: "https"
          X-Forwarded-Ssl: "on"

    gitlab-compress:
      compress:
        excludedContentTypes:
          - "text/event-stream"

    gitlab-buffering:
      buffering:
        maxRequestBodyBytes: 0
        maxResponseBodyBytes: 0

  routers:
    ${service_name}:
      rule: "${host_rule}"
      service: ${service_name}
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - gitlab-headers
        - gitlab-compress
        - gitlab-buffering

  serversTransports:
    gitlab-transport:
      forwardingTimeouts:
        dialTimeout: "30s"
        responseHeaderTimeout: "600s"
        idleConnTimeout: "600s"

  services:
    ${service_name}:
      loadBalancer:
        serversTransport: gitlab-transport@file
        responseForwarding:
          flushInterval: "100ms"
        servers:
          - url: "${backend_url}"
EOF
        else
            cat > "$config_file" << EOF
http:
  middlewares:
    ${service_name}-compress:
      compress:
        excludedContentTypes:
          - "text/event-stream"

  routers:
    ${service_name}:
      rule: "${host_rule}"
      service: ${service_name}
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - ${service_name}-compress
        - authelia@file

  services:
    ${service_name}:
      loadBalancer:
        servers:
          - url: "${backend_url}"
EOF
        fi
        echo "  [Создано] Конфигурация для $service_name"
    else
        cp "$config_file" "${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
        # Разделитель # (в host_rule может быть || для нескольких доменов)
        sed -i "s#rule: \".*\"#rule: \"${host_rule}\"#" "$config_file"
        CURRENT_URL=$(grep -o "url: \"[^\"]*\"" "$config_file" | sed 's/url: "\(.*\)"/\1/' | head -1)
        if [ "$CURRENT_URL" != "$backend_url" ]; then
            sed -i "s#url: \"[^\"]*\"#url: \"${backend_url}\"#" "$config_file"
            echo "  [Обновлено] Backend URL для $service_name"
        fi
        echo "  [Обновлено] Домены для $service_name"
    fi
}

echo "[1/6] Создание/обновление конфигурации для GitLab..."
if [ "$USE_BASE_DOMAINS" = true ]; then
    update_config "$DYNAMIC_DIR/gitlab.yml" "gitlab" "$GITLAB_PREFIX" "http://127.0.0.1:8888" "$GITLAB_MIDDLE"
else
    update_config "$DYNAMIC_DIR/gitlab.yml" "gitlab" "$GITLAB_DOMAIN" "http://127.0.0.1:8888"
fi

# Конфигурация для GitLab Pages (с wildcard для namespace субдоменов)
# Используем синтаксис Traefik v3 для HostRegexp
echo "[2/6] Создание/обновление конфигурации для GitLab Pages..."
PAGES_CONFIG="$DYNAMIC_DIR/gitlab-pages.yml"

# Функция для экранирования точек в домене для regex
escape_domain_for_regex() {
    echo "$1" | sed 's/\./\\\\./g'
}

if [ "$USE_BASE_DOMAINS" = true ]; then
    # Строим правило для *.public.<gitlab-prefix>.<base_domain> и public.<gitlab-prefix>.<base_domain>
    PAGES_HOST_RULE=""
    while IFS= read -r gitlab_full; do
        [ -z "$gitlab_full" ] && continue
        PAGES_DOMAIN="public.${gitlab_full}"
        PAGES_DOMAIN_ESCAPED=$(escape_domain_for_regex "$PAGES_DOMAIN")
        # Traefik v3 синтаксис: HostRegexp(`^regex$`)
        if [ -n "$PAGES_HOST_RULE" ]; then
            PAGES_HOST_RULE="${PAGES_HOST_RULE} || HostRegexp(\`^[a-z0-9-]+\\.${PAGES_DOMAIN_ESCAPED}\$\`) || Host(\`${PAGES_DOMAIN}\`)"
        else
            PAGES_HOST_RULE="HostRegexp(\`^[a-z0-9-]+\\.${PAGES_DOMAIN_ESCAPED}\$\`) || Host(\`${PAGES_DOMAIN}\`)"
        fi
    done < <(build_service_domains "$GITLAB_PREFIX" "$GITLAB_MIDDLE")
else
    PAGES_DOMAIN="public.${GITLAB_DOMAIN}"
    PAGES_DOMAIN_ESCAPED=$(escape_domain_for_regex "$PAGES_DOMAIN")
    PAGES_HOST_RULE="HostRegexp(\`^[a-z0-9-]+\\.${PAGES_DOMAIN_ESCAPED}\$\`) || Host(\`${PAGES_DOMAIN}\`)"
fi

if [ -n "$PAGES_HOST_RULE" ]; then
    # Одинарные кавычки в YAML — обратный слэш не экранируется (избегаем "unknown escape character")
    if [ "$FORCE_MODE" = true ] || [ ! -f "$PAGES_CONFIG" ]; then
        cat > "$PAGES_CONFIG" << EOF
http:
  routers:
    gitlab-pages:
      rule: '${PAGES_HOST_RULE}'
      service: gitlab-pages
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

  services:
    gitlab-pages:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: "http://127.0.0.1:8889"
EOF
        echo "  [Создано] Конфигурация для GitLab Pages (Traefik v3 wildcard)"
    else
        cp "$PAGES_CONFIG" "${PAGES_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
        sed -i "s#rule: '[^']*'#rule: '${PAGES_HOST_RULE}'#" "$PAGES_CONFIG"
        echo "  [Обновлено] Конфигурация для GitLab Pages"
    fi
else
    echo "  [Пропуск] Не удалось построить правило для GitLab Pages"
fi

echo "[3/6] Создание/обновление конфигурации для n8n..."
if [ -n "$N8N_HOSTS_CFG" ]; then
    update_config "$DYNAMIC_DIR/n8n.yml" "n8n" "$N8N_PREFIX" "http://127.0.0.1:5678" "$N8N_MIDDLE" "$(build_host_rule_from_list "$N8N_HOSTS_CFG")"
elif [ "$USE_BASE_DOMAINS" = true ]; then
    update_config "$DYNAMIC_DIR/n8n.yml" "n8n" "$N8N_PREFIX" "http://127.0.0.1:5678" "$N8N_MIDDLE"
else
    update_config "$DYNAMIC_DIR/n8n.yml" "n8n" "$N8N_DOMAIN" "http://127.0.0.1:5678"
fi
echo "[4/6] Создание/обновление конфигурации для веб-интерфейса управления..."
if [ -n "$MGMT_UI_HOSTS_CFG" ]; then
    update_config "$DYNAMIC_DIR/management-ui.yml" "management-ui" "admin" "http://127.0.0.1:3000" "" "$(build_host_rule_from_list "$MGMT_UI_HOSTS_CFG")"
elif [ "$USE_BASE_DOMAINS" = true ]; then
    update_config "$DYNAMIC_DIR/management-ui.yml" "management-ui" "admin" "http://127.0.0.1:3000"
else
    update_config "$DYNAMIC_DIR/management-ui.yml" "management-ui" "$UI_DOMAIN" "http://127.0.0.1:3000"
fi

if site_domains_configured; then
    echo "[5/6] Создание/обновление конфигурации для сайта (frontend + API)..."
    SITE_FRONTEND_PORT=$(get_config_value "site_port" | _sanitize_for_yaml)
    [ -z "$SITE_FRONTEND_PORT" ] && SITE_FRONTEND_PORT="4001"
    SITE_API_PORT=$(get_config_value "site_api_port" | _sanitize_for_yaml)
    [ -z "$SITE_API_PORT" ] && SITE_API_PORT="4002"
    SITE_FRONTEND_URL="http://127.0.0.1:${SITE_FRONTEND_PORT}"
    SITE_API_URL="http://127.0.0.1:${SITE_API_PORT}"
    HOST_RULE_APEX=$(build_host_rule "${SITE_PREFIX:-}" | _sanitize_for_yaml)
    HOST_RULE_API=$(build_host_rule "api" | _sanitize_for_yaml)
    if [ -z "$HOST_RULE_APEX" ] && [ -z "$HOST_RULE_API" ]; then
        echo "  [Ошибка] Не удалось построить правила для сайта"
    else
        SITE_API_YML="$DYNAMIC_DIR/site.yml"
        if [ "$FORCE_MODE" = true ] || [ ! -f "$SITE_API_YML" ]; then
            cat > "$SITE_API_YML" << SITEEOF
http:
  middlewares:
    site-compress:
      compress:
        excludedContentTypes:
          - "text/event-stream"

  routers:
SITEEOF
            if [ -n "$HOST_RULE_APEX" ]; then
                cat >> "$SITE_API_YML" << SITEEOF

    site:
      rule: "${HOST_RULE_APEX}"
      service: site-frontend
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - site-compress
SITEEOF
            fi
            if [ -n "$HOST_RULE_API" ]; then
                cat >> "$SITE_API_YML" << SITEEOF

    site-api:
      rule: "${HOST_RULE_API}"
      service: site-api
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - site-compress
SITEEOF
            fi
            cat >> "$SITE_API_YML" << SITEEOF

  services:
    site-frontend:
      loadBalancer:
        servers:
          - url: "${SITE_FRONTEND_URL}"
    site-api:
      loadBalancer:
        servers:
          - url: "${SITE_API_URL}"
SITEEOF
            echo "  [Создано] Конфигурация для сайта (frontend:${SITE_FRONTEND_PORT}, api:${SITE_API_PORT})"
        else
            cp "$SITE_API_YML" "${SITE_API_YML}.backup.$(date +%Y%m%d_%H%M%S)"
            cat > "$SITE_API_YML" << SITEEOF
http:
  middlewares:
    site-compress:
      compress:
        excludedContentTypes:
          - "text/event-stream"

  routers:
SITEEOF
            if [ -n "$HOST_RULE_APEX" ]; then
                cat >> "$SITE_API_YML" << SITEEOF

    site:
      rule: "${HOST_RULE_APEX}"
      service: site-frontend
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - site-compress
SITEEOF
            fi
            if [ -n "$HOST_RULE_API" ]; then
                cat >> "$SITE_API_YML" << SITEEOF

    site-api:
      rule: "${HOST_RULE_API}"
      service: site-api
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - site-compress
SITEEOF
            fi
            cat >> "$SITE_API_YML" << SITEEOF

  services:
    site-frontend:
      loadBalancer:
        servers:
          - url: "${SITE_FRONTEND_URL}"
    site-api:
      loadBalancer:
        servers:
          - url: "${SITE_API_URL}"
SITEEOF
            echo "  [Обновлено] Конфигурация для сайта (frontend:${SITE_FRONTEND_PORT}, api:${SITE_API_PORT})"
        fi
    fi
else
    echo "[5/6] Сайт (Next.js) не настроен — пропуск (задайте site_port в /etc/install-config.json)"
fi

# Проверка и создание конфига Mailu при настройке (если файла нет)
MAILU_YML="$DYNAMIC_DIR/mailu.yml"
MAILU_HTTP_PORT=6555
if [ "$USE_BASE_DOMAINS" = true ] && { [ "$FORCE_MODE" = true ] || [ ! -f "$MAILU_YML" ]; }; then
    MAIL_PREFIX_CFG=$(get_config_value "mail_prefix")
    [ -z "$MAIL_PREFIX_CFG" ] && MAIL_PREFIX_CFG="mail"
    MAIL_MIDDLE_CFG=$(get_config_value "mail_middle")
    MAIL_DOMAIN_FOR_MAILU=$(get_config_value "mail_domain")
    [ -z "$MAIL_DOMAIN_FOR_MAILU" ] && MAIL_DOMAIN_FOR_MAILU=$(build_service_domains "$MAIL_PREFIX_CFG" "$MAIL_MIDDLE_CFG" | head -1)
    if [ -n "$MAIL_DOMAIN_FOR_MAILU" ]; then
        MAILU_HOST_RULE=""
        while IFS= read -r full; do
            [ -z "$full" ] && continue
            if [ -n "$MAILU_HOST_RULE" ]; then
                MAILU_HOST_RULE="${MAILU_HOST_RULE} || Host(\`${full}\`)"
            else
                MAILU_HOST_RULE="Host(\`${full}\`)"
            fi
        done < <(build_service_domains "$MAIL_PREFIX_CFG" "$MAIL_MIDDLE_CFG" 2>/dev/null)
        [ -z "$MAILU_HOST_RULE" ] && MAILU_HOST_RULE="Host(\`${MAIL_DOMAIN_FOR_MAILU}\`)"
        echo "[5a/6] Создание конфигурации Mailu (mailu.yml отсутствовал)..."
        cat > "$MAILU_YML" << MAILUEOF
http:
  middlewares:
    mailu-headers:
      headers:
        customRequestHeaders:
          X-Forwarded-Proto: "https"
          X-Forwarded-Port: "443"
          X-Forwarded-Host: "${MAIL_DOMAIN_FOR_MAILU}"
        customResponseHeaders:
          X-Forwarded-Proto: "https"
        hostsProxyHeaders:
          - "X-Forwarded-Host"
        sslRedirect: false
        forceSTSHeader: false

    mailu-compress:
      compress:
        excludedContentTypes:
          - "text/event-stream"

  routers:
    mailu-admin:
      rule: "(${MAILU_HOST_RULE}) && PathPrefix(\`/admin\`)"
      service: mailu-front
      entryPoints:
        - websecure
      middlewares:
        - mailu-headers
        - mailu-compress
        - authelia@file
      tls:
        certResolver: letsencrypt
      priority: 10

    mailu-webmail:
      rule: "(${MAILU_HOST_RULE}) && (Path(\`/\`) || PathPrefix(\`/webmail\`))"
      service: mailu-front
      entryPoints:
        - websecure
      middlewares:
        - mailu-headers
        - mailu-compress
        - authelia@file
      tls:
        certResolver: letsencrypt
      priority: 5

    mailu-catchall:
      rule: "${MAILU_HOST_RULE}"
      service: mailu-front
      entryPoints:
        - websecure
      middlewares:
        - mailu-headers
        - mailu-compress
        - authelia@file
      tls:
        certResolver: letsencrypt
      priority: 1

  services:
    mailu-front:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: "http://127.0.0.1:${MAILU_HTTP_PORT}"
MAILUEOF
        chmod 644 "$MAILU_YML"
        echo "  [OK] Создан $MAILU_YML (домен: ${MAIL_DOMAIN_FOR_MAILU}, порт: ${MAILU_HTTP_PORT})"
    fi
fi

# ============================================================
# [6/8] Конфигурация для Authelia SSO (ForwardAuth middleware + роутер)
# ============================================================
AUTH_PREFIX_CFG=$(get_config_value "auth_prefix")
[ -z "$AUTH_PREFIX_CFG" ] && AUTH_PREFIX_CFG="auth"
AUTHELIA_YML="$DYNAMIC_DIR/authelia.yml"

if [ "$USE_BASE_DOMAINS" = true ]; then
    if [ "$FORCE_MODE" = true ] || [ ! -f "$AUTHELIA_YML" ]; then
        echo "[6/8] Создание конфигурации для Authelia SSO..."
        AUTH_HOST_RULE=$(build_host_rule "$AUTH_PREFIX_CFG" "")
        if [ -n "$AUTH_HOST_RULE" ]; then
            cat > "$AUTHELIA_YML" << AUTHELIEOF
http:
  middlewares:
    authelia:
      forwardAuth:
        address: 'http://127.0.0.1:9091/api/authz/forward-auth'
        trustForwardHeader: true
        authResponseHeaders:
          - 'Remote-User'
          - 'Remote-Groups'
          - 'Remote-Email'
          - 'Remote-Name'

  routers:
    authelia:
      rule: "${AUTH_HOST_RULE}"
      service: authelia
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

  services:
    authelia:
      loadBalancer:
        servers:
          - url: 'http://127.0.0.1:9091'
AUTHELIEOF
            chmod 644 "$AUTHELIA_YML"
            echo "  [OK] Создан $AUTHELIA_YML"
        else
            echo "  [Ошибка] Не удалось построить правило для Authelia"
        fi
    else
        echo "[6/8] [Пропуск] authelia.yml уже существует"
    fi
else
    echo "[6/8] [Пропуск] Authelia (нет base_domains)"
fi

# ============================================================
# [7/8] Конфигурация для frp туннелей (wildcard *.tunnel.*)
# ============================================================
FRP_PREFIX_CFG=$(get_config_value "frp_prefix")
FRP_VHOST_PORT_CFG=$(get_config_value "frp_vhost_port")
TUNNELS_YML="$DYNAMIC_DIR/tunnels.yml"

if [ "$USE_BASE_DOMAINS" = true ] && [ -n "$FRP_PREFIX_CFG" ]; then
    [ -z "$FRP_VHOST_PORT_CFG" ] && FRP_VHOST_PORT_CFG="17480"

    if [ "$FORCE_MODE" = true ] || [ ! -f "$TUNNELS_YML" ]; then
        echo "[7/8] Создание конфигурации для туннелей (frps)..."

        # Собираем HostRegexp для каждого base domain
        TUNNEL_HOST_RULE=""
        while IFS= read -r base; do
            [ -z "$base" ] && continue
            TUNNEL_DOMAIN="${FRP_PREFIX_CFG}.${base}"
            ESCAPED=$(echo "$TUNNEL_DOMAIN" | sed 's/\./\\\\./g')
            if [ -n "$TUNNEL_HOST_RULE" ]; then
                TUNNEL_HOST_RULE="${TUNNEL_HOST_RULE} || HostRegexp(\`^.+\\.${ESCAPED}\$\`)"
            else
                TUNNEL_HOST_RULE="HostRegexp(\`^.+\\.${ESCAPED}\$\`)"
            fi
        done < <(get_base_domains)

        cat > "$TUNNELS_YML" << TUNNELSEOF
http:
  routers:
    tunnels:
      rule: "${TUNNEL_HOST_RULE}"
      service: tunnel-frp
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      priority: 1

  services:
    tunnel-frp:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: "http://127.0.0.1:${FRP_VHOST_PORT_CFG}"
TUNNELSEOF
        chmod 644 "$TUNNELS_YML"
        echo "  [OK] Создан $TUNNELS_YML (порт: ${FRP_VHOST_PORT_CFG})"
    else
        echo "[7/8] [Пропуск] tunnels.yml уже существует"
    fi
else
    echo "[7/8] [Пропуск] frp не настроен (нет frp_prefix в конфиге)"
fi

echo "[8/8] Перезагрузка Traefik..."
if systemctl is-active --quiet traefik; then
    systemctl reload traefik 2>/dev/null || systemctl restart traefik
else
    echo "  [Предупреждение] Traefik не запущен, запуск..."
    systemctl start traefik
fi

sleep 2
if systemctl is-active --quiet traefik; then
    echo ""
    echo "=== Конфигурация Traefik завершена! ==="
    echo ""
    echo "Сервисы доступны по адресам:"
    echo "  - GitLab: https://${GITLAB_DOMAIN}"
    echo "  - GitLab Pages: https://public.${GITLAB_DOMAIN}"
    echo "  - n8n: https://${N8N_DOMAIN}"
    echo "  - Веб-интерфейс: https://${UI_DOMAIN}"
    if [ "$USE_BASE_DOMAINS" = true ]; then
        echo "  (и по всем базовым доменам)"
    fi
    if site_domains_configured; then
        SITE_APEX=$(build_service_domains "" | head -1)
        SITE_API_FIRST=$(build_service_domains "api" | head -1)
        SITE_FRONTEND_PORT=$(get_config_value "site_port")
        [ -z "$SITE_FRONTEND_PORT" ] && SITE_FRONTEND_PORT="4001"
        SITE_API_PORT=$(get_config_value "site_api_port")
        [ -z "$SITE_API_PORT" ] && SITE_API_PORT="4002"
        echo "  - Сайт (frontend): https://${SITE_APEX} (порт ${SITE_FRONTEND_PORT})"
        echo "  - Сайт (API): https://${SITE_API_FIRST} (порт ${SITE_API_PORT})"
    fi
    if [ -f "/etc/traefik/dynamic/mailu.yml" ]; then
        MAILU_ADMIN_DOMAIN=$(grep -A 5 "mailu-admin:" /etc/traefik/dynamic/mailu.yml | grep -o "Host(\`[^\`]*\`)" | sed "s/Host(\`\(.*\)\`)/\1/" | head -1)
        if [ -n "$MAILU_ADMIN_DOMAIN" ]; then
            echo "  - Mailu (Admin): https://${MAILU_ADMIN_DOMAIN}/admin"
            echo "  - Mailu (Webmail): https://${MAILU_ADMIN_DOMAIN}"
        fi
    fi
    echo ""
    echo "Примечание: SSL сертификаты будут получены автоматически в течение нескольких минут"
else
    echo ""
    echo "Ошибка: Traefik не запустился после перезагрузки"
    echo "Проверьте логи: journalctl -u traefik -n 50"
    exit 1
fi
