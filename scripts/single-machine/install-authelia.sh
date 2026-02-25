#!/bin/bash
# Скрипт установки Authelia (SSO / аутентификация)
# Использование: sudo ./install-authelia.sh [--force]
#
# Устанавливает Authelia на сервер и настраивает:
# - Бинарник /usr/local/bin/authelia
# - Конфиг /etc/authelia/configuration.yml
# - Пользователи /etc/authelia/users_database.yml
# - Секреты /etc/authelia/secrets/
# - Systemd unit authelia.service
# - DNS записи auth.<base_domain>
# - Traefik dynamic конфиг authelia.yml
#
# Параметры:
#   --force  - переустановить даже если уже установлено

# Определение директории скрипта (абсолютный путь)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Загрузка общих функций
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Предупреждение: common.sh не найден, некоторые функции могут быть недоступны"
fi

set +e

# Параметры
FORCE_MODE=false
AUTHELIA_VERSION="4.38.19"
AUTHELIA_PORT=9091
AUTHELIA_PREFIX="auth"

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
    esac
done

# Проверка root
if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Проверка идемпотентности
if [ "$FORCE_MODE" != true ]; then
    if [ -f "/usr/local/bin/authelia" ] && is_service_installed "authelia.service" 2>/dev/null; then
        echo "  [Пропуск] Authelia уже установлена"
        if is_service_running "authelia.service" 2>/dev/null; then
            echo "  [OK] Authelia запущена"
        else
            echo "  [Предупреждение] Authelia установлена, но не запущена"
            echo "  Запуск сервиса..."
            systemctl start authelia
        fi
        exit 0
    fi
fi

echo ""
echo "=== Установка Authelia (SSO) ==="
echo ""

# ============================================================
# [1/7] Скачивание Authelia с GitHub Releases
# ============================================================
echo "[1/7] Скачивание Authelia v${AUTHELIA_VERSION}..."

ARCH=$(uname -m)
case $ARCH in
    x86_64)  ARCH_NAME="amd64" ;;
    aarch64) ARCH_NAME="arm64" ;;
    armv7l)  ARCH_NAME="arm" ;;
    *)
        echo "  [ОШИБКА] Неподдерживаемая архитектура: $ARCH"
        exit 1
        ;;
esac

NEED_DOWNLOAD=false
if [ "$FORCE_MODE" = true ] || [ ! -f "/usr/local/bin/authelia" ]; then
    NEED_DOWNLOAD=true
else
    INSTALLED_VERSION=$(/usr/local/bin/authelia --version 2>/dev/null | grep -oP 'v?\K[0-9]+\.[0-9]+\.[0-9]+' || echo "unknown")
    if [ "$INSTALLED_VERSION" = "$AUTHELIA_VERSION" ]; then
        echo "  [Пропуск] Authelia v${AUTHELIA_VERSION} уже установлена"
    else
        echo "  Обновление с v${INSTALLED_VERSION} до v${AUTHELIA_VERSION}..."
        NEED_DOWNLOAD=true
    fi
fi

if [ "$NEED_DOWNLOAD" = true ]; then
    TMP_DIR=$(mktemp -d)
    AUTHELIA_ARCHIVE="authelia-v${AUTHELIA_VERSION}-linux-${ARCH_NAME}.tar.gz"
    AUTHELIA_URL="https://github.com/authelia/authelia/releases/download/v${AUTHELIA_VERSION}/${AUTHELIA_ARCHIVE}"

    if ! curl -fsSL -o "${TMP_DIR}/${AUTHELIA_ARCHIVE}" "$AUTHELIA_URL"; then
        echo "  [ОШИБКА] Не удалось скачать ${AUTHELIA_URL}"
        rm -rf "$TMP_DIR"
        exit 1
    fi

    tar -xzf "${TMP_DIR}/${AUTHELIA_ARCHIVE}" -C "$TMP_DIR"

    # Бинарник может быть в корне архива или в подпапке
    if [ -f "${TMP_DIR}/authelia-linux-${ARCH_NAME}" ]; then
        cp "${TMP_DIR}/authelia-linux-${ARCH_NAME}" /usr/local/bin/authelia
    elif [ -f "${TMP_DIR}/authelia" ]; then
        cp "${TMP_DIR}/authelia" /usr/local/bin/authelia
    else
        echo "  [ОШИБКА] Бинарник authelia не найден в архиве"
        ls -la "$TMP_DIR"
        rm -rf "$TMP_DIR"
        exit 1
    fi

    chmod +x /usr/local/bin/authelia
    rm -rf "$TMP_DIR"
    echo "  [OK] Authelia v${AUTHELIA_VERSION} установлена в /usr/local/bin/authelia"
fi

# ============================================================
# [2/7] Создание системного пользователя
# ============================================================
echo "[2/7] Создание системного пользователя..."

if id authelia &>/dev/null; then
    echo "  [Пропуск] Пользователь authelia уже существует"
else
    useradd --system --no-create-home --shell /usr/sbin/nologin authelia
    echo "  [OK] Пользователь authelia создан"
fi

mkdir -p /etc/authelia /etc/authelia/secrets /var/lib/authelia /var/log/authelia
chown authelia:authelia /etc/authelia /etc/authelia/secrets /var/lib/authelia /var/log/authelia
chmod 700 /etc/authelia /etc/authelia/secrets

# ============================================================
# [3/7] Генерация секретов (однократно)
# ============================================================
echo "[3/7] Генерация секретов..."

generate_secret() {
    openssl rand -base64 48 | tr -d '=+/' | cut -c1-64
}

# Каждый секрет генерируется один раз и не перезаписывается
for secret_name in jwt_secret session_secret storage_encryption_key oidc_hmac_secret; do
    SECRET_FILE="/etc/authelia/secrets/${secret_name}"
    if [ -f "$SECRET_FILE" ] && [ -s "$SECRET_FILE" ]; then
        echo "  [Пропуск] ${secret_name} уже существует"
    else
        generate_secret > "$SECRET_FILE"
        chmod 600 "$SECRET_FILE"
        chown authelia:authelia "$SECRET_FILE"
        echo "  [OK] ${secret_name} сгенерирован"
    fi
done

# RSA ключ для OIDC
OIDC_KEY_FILE="/etc/authelia/secrets/oidc.pem"
if [ -f "$OIDC_KEY_FILE" ] && [ -s "$OIDC_KEY_FILE" ]; then
    echo "  [Пропуск] OIDC RSA ключ уже существует"
else
    openssl genrsa -out "$OIDC_KEY_FILE" 4096 2>/dev/null
    chmod 600 "$OIDC_KEY_FILE"
    chown authelia:authelia "$OIDC_KEY_FILE"
    echo "  [OK] OIDC RSA ключ сгенерирован (4096 bit)"
fi

# Client secrets (plain text — для передачи в Management UI config и gitlab.rb)
for client_name in mgmt gitlab strapi; do
    SECRET_FILE="/etc/authelia/secrets/${client_name}_client_secret"
    if [ -f "$SECRET_FILE" ] && [ -s "$SECRET_FILE" ]; then
        echo "  [Пропуск] ${client_name}_client_secret уже существует"
    else
        generate_secret | cut -c1-48 > "$SECRET_FILE"
        chmod 600 "$SECRET_FILE"
        chown authelia:authelia "$SECRET_FILE"
        echo "  [OK] ${client_name}_client_secret сгенерирован"
    fi
done

# ============================================================
# [4/7] Генерация конфигов
# ============================================================
echo "[4/7] Генерация конфигурации..."

AUTHELIA_CONFIG="/etc/authelia/configuration.yml"
USERS_DB="/etc/authelia/users_database.yml"

# Получение base_domains
FIRST_BASE=$(get_base_domains | head -1)
if [ -z "$FIRST_BASE" ]; then
    echo "  [ОШИБКА] Базовые домены не настроены (base_domains пуст)"
    exit 1
fi

# Генерация argon2 хешей для client secrets
MGMT_SECRET=$(cat /etc/authelia/secrets/mgmt_client_secret)
GITLAB_SECRET=$(cat /etc/authelia/secrets/gitlab_client_secret)
STRAPI_SECRET=$(cat /etc/authelia/secrets/strapi_client_secret)
MGMT_HASH=$(authelia crypto hash generate argon2 --password "$MGMT_SECRET" 2>/dev/null || echo '$argon2id$v=19$m=65536,t=3,p=4$placeholder')
GITLAB_HASH=$(authelia crypto hash generate argon2 --password "$GITLAB_SECRET" 2>/dev/null || echo '$argon2id$v=19$m=65536,t=3,p=4$placeholder')
STRAPI_HASH=$(authelia crypto hash generate argon2 --password "$STRAPI_SECRET" 2>/dev/null || echo '$argon2id$v=19$m=65536,t=3,p=4$placeholder')

# Читаем RSA ключ (индентируем для YAML)
OIDC_RSA_KEY=$(sed 's/^/          /' "$OIDC_KEY_FILE")

# Backup существующего конфига
if [ -f "$AUTHELIA_CONFIG" ]; then
    cp "$AUTHELIA_CONFIG" "${AUTHELIA_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
fi

# Генерация session cookies для всех base_domains
SESSION_COOKIES=""
while IFS= read -r base; do
    [ -z "$base" ] && continue
    SESSION_COOKIES="${SESSION_COOKIES}
    - domain: '${base}'
      authelia_url: 'https://${AUTHELIA_PREFIX}.${base}'
      default_redirection_url: 'https://admin.${base}'
      expiration: 12h
      inactivity: 2h"
done < <(get_base_domains)

# Генерация access_control rules: bypass для публичных сервисов
BYPASS_DOMAINS=""
while IFS= read -r base; do
    [ -z "$base" ] && continue
    BYPASS_DOMAINS="${BYPASS_DOMAINS}
        - '${base}'
        - 'www.${base}'
        - 'api.${base}'
        - '${AUTHELIA_PREFIX}.${base}'"
done < <(get_base_domains)

# Домены для two_factor защиты
ADMIN_DOMAINS=""
N8N_DOMAINS=""
MAIL_DOMAINS=""
ANALYTICS_DOMAINS=""
FILES_DOMAINS=""
while IFS= read -r base; do
    [ -z "$base" ] && continue
    ADMIN_DOMAINS="${ADMIN_DOMAINS}
        - 'admin.${base}'"
    N8N_DOMAINS="${N8N_DOMAINS}
        - 'n8n.dev.${base}'"
    MAIL_DOMAINS="${MAIL_DOMAINS}
        - 'mail.dev.${base}'"
    ANALYTICS_DOMAINS="${ANALYTICS_DOMAINS}
        - 'analytics.dev.${base}'"
    FILES_DOMAINS="${FILES_DOMAINS}
        - 'files.dev.${base}'"
done < <(get_base_domains)

# OIDC redirect URIs
MGMT_REDIRECTS=""
GITLAB_REDIRECTS=""
STRAPI_REDIRECTS=""
while IFS= read -r base; do
    [ -z "$base" ] && continue
    MGMT_REDIRECTS="${MGMT_REDIRECTS}
          - 'https://admin.${base}/callback'"
    GITLAB_REDIRECTS="${GITLAB_REDIRECTS}
          - 'https://gitlab.dev.${base}/users/auth/openid_connect/callback'"
    STRAPI_REDIRECTS="${STRAPI_REDIRECTS}
          - 'https://api.${base}/strapi-plugin-sso/oidc/callback'"
done < <(get_base_domains)

cat > "$AUTHELIA_CONFIG" << EOF
---
# Authelia SSO configuration
# Документация: https://www.authelia.com/configuration/

theme: dark
default_2fa_method: totp

server:
  address: 'tcp://127.0.0.1:${AUTHELIA_PORT}'

log:
  level: info
  file_path: /var/log/authelia/authelia.log

totp:
  issuer: ${FIRST_BASE}
  period: 30
  skew: 1

authentication_backend:
  file:
    path: /etc/authelia/users_database.yml
    password:
      algorithm: argon2id
      iterations: 3
      memory: 65536
      parallelism: 4
      salt_length: 16
      key_length: 32

identity_validation:
  reset_password:
    jwt_secret: '$(cat /etc/authelia/secrets/jwt_secret)'

session:
  secret: '$(cat /etc/authelia/secrets/session_secret)'
  cookies:${SESSION_COOKIES}

storage:
  encryption_key: '$(cat /etc/authelia/secrets/storage_encryption_key)'
  local:
    path: /var/lib/authelia/db.sqlite3

regulation:
  max_retries: 5
  find_time: 2m
  ban_time: 5m

access_control:
  default_policy: deny
  rules:
    # Публичные ресурсы
    - domain:${BYPASS_DOMAINS}
      policy: bypass
    # GitLab — собственная авторизация
    - domain_regex: '^gitlab\.dev\..*'
      policy: bypass
    # GitLab Pages
    - domain_regex: '^.*\.public\.gitlab\.dev\..*'
      policy: bypass
    # Туннели — своя auth через frp token
    - domain_regex: '^.+\.tunnel\..*'
      policy: bypass
    # Management UI
    - domain:${ADMIN_DOMAINS}
      policy: two_factor
    # n8n
    - domain:${N8N_DOMAINS}
      policy: two_factor
    # Mailu
    - domain:${MAIL_DOMAINS}
      policy: two_factor
    # Umami Analytics — публичные трекинг-эндпоинты (скрипт + API сбора данных)
    - domain:${ANALYTICS_DOMAINS}
      resources:
        - '^/script\.js$'
        - '^/stats$'
        - '^/api/send$'
      policy: bypass
    # Umami Analytics — остальное через 2FA
    - domain:${ANALYTICS_DOMAINS}
      policy: two_factor
    # File Server — публичные файлы без авторизации
    - domain:${FILES_DOMAINS}
      resources:
        - '^/public/.*'
      policy: bypass
    # File Server — остальное через 2FA
    - domain:${FILES_DOMAINS}
      policy: two_factor

notifier:
  filesystem:
    filename: /var/lib/authelia/notifications.txt

identity_providers:
  oidc:
    hmac_secret: '$(cat /etc/authelia/secrets/oidc_hmac_secret)'
    jwks:
      - key_id: 'main'
        key: |
${OIDC_RSA_KEY}
    clients:
      - client_id: 'management-ui'
        client_name: 'Management UI'
        client_secret: '${MGMT_HASH}'
        public: false
        authorization_policy: two_factor
        redirect_uris:${MGMT_REDIRECTS}
        scopes: [openid, profile, email, groups]
        token_endpoint_auth_method: client_secret_post
      - client_id: 'gitlab'
        client_name: 'GitLab'
        client_secret: '${GITLAB_HASH}'
        public: false
        authorization_policy: two_factor
        redirect_uris:${GITLAB_REDIRECTS}
        scopes: [openid, profile, email, groups]
        token_endpoint_auth_method: client_secret_post
      - client_id: 'strapi'
        client_name: 'Strapi CMS'
        client_secret: '${STRAPI_HASH}'
        public: false
        authorization_policy: two_factor
        redirect_uris:${STRAPI_REDIRECTS}
        scopes: [openid, profile, email]
        token_endpoint_auth_method: client_secret_post
EOF

chmod 600 "$AUTHELIA_CONFIG"
chown authelia:authelia "$AUTHELIA_CONFIG"
echo "  [OK] Конфиг создан: ${AUTHELIA_CONFIG}"

# Users database — создаётся только если не существует
if [ -f "$USERS_DB" ] && [ -s "$USERS_DB" ]; then
    echo "  [Пропуск] users_database.yml уже существует"
else
    # Пароль: из auth.json Management UI или prompt
    ADMIN_PASSWORD=""
    AUTH_JSON="/etc/management-ui/auth.json"
    if [ -f "$AUTH_JSON" ]; then
        ADMIN_PASSWORD=$(grep -o '"password": *"[^"]*"' "$AUTH_JSON" | head -1 | sed 's/"password": *"//;s/"$//')
    fi

    if [ -z "$ADMIN_PASSWORD" ]; then
        echo "  Введите пароль для admin-пользователя Authelia:"
        read -s -r ADMIN_PASSWORD
        echo ""
    fi

    if [ -n "$ADMIN_PASSWORD" ]; then
        PASSWORD_HASH=$(authelia crypto hash generate argon2 --password "$ADMIN_PASSWORD" 2>/dev/null | sed 's/^Digest: //')
        if [ -z "$PASSWORD_HASH" ]; then
            echo "  [ПРЕДУПРЕЖДЕНИЕ] Не удалось создать хеш пароля. Создайте users_database.yml вручную."
            PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$ЗАМЕНИТЕ_ЭТОТ_ХЕШ'
        fi
    else
        PASSWORD_HASH='$argon2id$v=19$m=65536,t=3,p=4$ЗАМЕНИТЕ_ЭТОТ_ХЕШ'
    fi

    # Данные пользователя Authelia (отдельно от LE email)
    AUTHELIA_USERNAME=$(get_config_value "authelia_username")
    [ -z "$AUTHELIA_USERNAME" ] && AUTHELIA_USERNAME="admin"
    AUTHELIA_EMAIL=$(get_config_value "authelia_email")
    if [ -z "$AUTHELIA_EMAIL" ]; then
        # Фоллбэк: внутренний email из username@first_base
        AUTHELIA_EMAIL="${AUTHELIA_USERNAME}@${FIRST_BASE}"
    fi
    AUTHELIA_DISPLAYNAME=$(get_config_value "authelia_displayname")
    [ -z "$AUTHELIA_DISPLAYNAME" ] && AUTHELIA_DISPLAYNAME="Admin"

    cat > "$USERS_DB" << USERSEOF
---
users:
  ${AUTHELIA_USERNAME}:
    disabled: false
    displayname: '${AUTHELIA_DISPLAYNAME}'
    email: '${AUTHELIA_EMAIL}'
    password: '${PASSWORD_HASH}'
    groups:
      - admins
USERSEOF

    chmod 600 "$USERS_DB"
    chown authelia:authelia "$USERS_DB"
    echo "  [OK] users_database.yml создан (пользователь: admin)"
fi

# ============================================================
# [5/7] Systemd unit
# ============================================================
echo "[5/7] Настройка systemd..."

SYSTEMD_UNIT="/etc/systemd/system/authelia.service"

if [ "$FORCE_MODE" = true ] || [ ! -f "$SYSTEMD_UNIT" ]; then
    if [ -f "$SYSTEMD_UNIT" ]; then
        cp "$SYSTEMD_UNIT" "${SYSTEMD_UNIT}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    cat > "$SYSTEMD_UNIT" << 'EOF'
[Unit]
Description=Authelia SSO (аутентификация)
After=network.target traefik.service

[Service]
Type=simple
User=authelia
Group=authelia
ExecStart=/usr/local/bin/authelia --config /etc/authelia/configuration.yml
Restart=always
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/etc/authelia /var/lib/authelia /var/log/authelia
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
    echo "  [OK] Создан ${SYSTEMD_UNIT}"
else
    echo "  [Пропуск] Systemd service уже существует"
fi

# Запуск сервиса
systemctl daemon-reload
systemctl enable authelia

if systemctl is-active --quiet authelia 2>/dev/null; then
    echo "  Остановка существующего сервиса..."
    systemctl stop authelia
fi

systemctl start authelia

sleep 2
if systemctl is-active --quiet authelia; then
    echo "  [OK] Authelia запущена"
else
    echo ""
    echo "Ошибка: Authelia не запустилась"
    echo "Проверьте логи: journalctl -u authelia -n 50"
    exit 1
fi

# ============================================================
# [6/7] DNS записи
# ============================================================
echo "[6/7] Создание DNS записей..."

SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ifconfig.co 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$SERVER_IP" ]; then
    echo "  [Предупреждение] Не удалось определить IP для DNS записей"
    echo "  Создайте вручную: ${AUTHELIA_PREFIX}.<domain> → A → <server-ip>"
else
    DNS_API="http://127.0.0.1:5353/api/records"

    RECORDS_JSON=""
    while IFS= read -r base; do
        [ -z "$base" ] && continue
        if [ -n "$RECORDS_JSON" ]; then RECORDS_JSON="${RECORDS_JSON},"; fi
        RECORDS_JSON="${RECORDS_JSON}{\"subdomain\":\"${AUTHELIA_PREFIX}\",\"domain\":\"${base}\",\"ip\":\"${SERVER_IP}\"}"
    done < <(get_base_domains)

    if [ -n "$RECORDS_JSON" ]; then
        if curl -s -X POST -H "Content-Type: application/json" \
            -d "{\"records\":[${RECORDS_JSON}]}" \
            "${DNS_API}/bulk" 2>/dev/null | grep -q '"records"'; then
            echo "  [OK] DNS записи созданы для ${AUTHELIA_PREFIX} (через bulk API)"
        else
            while IFS= read -r base; do
                [ -z "$base" ] && continue
                curl -s -X POST -H "Content-Type: application/json" \
                    -d "{\"subdomain\":\"${AUTHELIA_PREFIX}\",\"domain\":\"${base}\",\"ip\":\"${SERVER_IP}\"}" \
                    "$DNS_API" 2>/dev/null
                echo "  [OK] ${AUTHELIA_PREFIX}.${base} → ${SERVER_IP}"
            done < <(get_base_domains)
        fi
    fi
fi

# ============================================================
# [7/7] Traefik dynamic конфиг
# ============================================================
echo "[7/7] Traefik dynamic конфиг..."

TRAEFIK_DYNAMIC_DIR="/etc/traefik/dynamic"
AUTHELIA_TRAEFIK="${TRAEFIK_DYNAMIC_DIR}/authelia.yml"

if [ ! -d "$TRAEFIK_DYNAMIC_DIR" ]; then
    echo "  [Предупреждение] Traefik dynamic директория не найдена: ${TRAEFIK_DYNAMIC_DIR}"
    echo "  Создайте конфиг вручную после установки Traefik."
else
    # Генерация раздельных роутеров (по одному на домен)
    # Комбинированный Host(A) || Host(B) вызывает SAN-конфликт в Let's Encrypt
    ROUTERS_YAML=""
    while IFS= read -r base; do
        [ -z "$base" ] && continue
        # Имя роутера: authelia-ru, authelia-tech и т.д.
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
    done < <(get_base_domains)

    cat > "$AUTHELIA_TRAEFIK" << TRAEFIKEOF
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

    echo "  [OK] Traefik конфиг создан: ${AUTHELIA_TRAEFIK}"
fi

# Сохранение параметров в install-config
save_config_value "authelia_port" "$AUTHELIA_PORT"
save_config_value "authelia_prefix" "$AUTHELIA_PREFIX"
save_config_value "auth_prefix" "$AUTHELIA_PREFIX"

# ============================================================
# Добавление authelia@file в Traefik конфиги защищённых сервисов
# ============================================================
echo ""
echo "[Авто] Добавление authelia@file middleware в Traefik конфиги..."
TRAEFIK_DYN="/etc/traefik/dynamic"

_add_authelia_middleware() {
    local yml_file="$1"
    if [ ! -f "$yml_file" ]; then
        echo "  [Пропуск] $yml_file не найден"
        return
    fi
    if grep -q "authelia@file" "$yml_file"; then
        echo "  [OK] $(basename "$yml_file") — authelia@file уже есть"
        return
    fi
    # Добавляем authelia@file после каждой строки с *-compress middleware
    cp "$yml_file" "${yml_file}.backup.$(date +%Y%m%d_%H%M%S)"
    sed -i '/- .*-compress$/a\        - authelia@file' "$yml_file"
    echo "  [OK] $(basename "$yml_file") — authelia@file добавлен"
}

_add_authelia_middleware "$TRAEFIK_DYN/management-ui.yml"
_add_authelia_middleware "$TRAEFIK_DYN/n8n.yml"

# Mailu: добавить authelia@file ко всем роутерам
if [ -f "$TRAEFIK_DYN/mailu.yml" ] && ! grep -q "authelia@file" "$TRAEFIK_DYN/mailu.yml"; then
    cp "$TRAEFIK_DYN/mailu.yml" "$TRAEFIK_DYN/mailu.yml.backup.$(date +%Y%m%d_%H%M%S)"
    sed -i '/- mailu-compress$/a\        - authelia@file' "$TRAEFIK_DYN/mailu.yml"
    echo "  [OK] mailu.yml — authelia@file добавлен"
elif [ -f "$TRAEFIK_DYN/mailu.yml" ]; then
    echo "  [OK] mailu.yml — authelia@file уже есть"
fi

# ============================================================
# Обновление config.json Management UI (OIDC секция)
# ============================================================
echo ""
echo "[Авто] Настройка OIDC в Management UI..."
MGMT_CONFIG="/etc/management-ui/config.json"

if [ -f "$MGMT_CONFIG" ]; then
    if grep -q '"oidc"' "$MGMT_CONFIG"; then
        echo "  [OK] OIDC секция уже есть в config.json"
    else
        MGMT_OIDC_SECRET=""
        if [ -f "/etc/authelia/secrets/mgmt_client_secret" ]; then
            MGMT_OIDC_SECRET=$(cat /etc/authelia/secrets/mgmt_client_secret)
        fi

        if [ -n "$MGMT_OIDC_SECRET" ]; then
            COOKIE_SECRET=""
            if command -v openssl &> /dev/null; then
                COOKIE_SECRET=$(openssl rand -hex 32)
            else
                COOKIE_SECRET=$(head -c 32 /dev/urandom | xxd -p | tr -d '\n')
            fi
            BASE_URL="https://admin.${FIRST_BASE}"
            ISSUER_URL="https://${AUTHELIA_PREFIX}.${FIRST_BASE}"

            # Добавляем oidc секцию перед последней закрывающей скобкой
            cp "$MGMT_CONFIG" "${MGMT_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
            # Убираем последнюю } и добавляем oidc блок
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
            echo "  Перезапуск Management UI..."
            systemctl restart management-ui 2>/dev/null || true
        else
            echo "  [Предупреждение] Секрет mgmt_client_secret не найден, OIDC не настроен"
        fi
    fi
else
    echo "  [Пропуск] config.json не найден (Management UI не установлен)"
fi

# ============================================================
# Итоги
# ============================================================
CRED_DIR="/root/.borisovai-credentials"
mkdir -p "$CRED_DIR"
chmod 700 "$CRED_DIR"
cat > "$CRED_DIR/authelia" << CRED_EOF
# Authelia credentials ($(date '+%Y-%m-%d %H:%M:%S'))
mgmt_client_id=management-ui
mgmt_client_secret=$(cat /etc/authelia/secrets/mgmt_client_secret)
gitlab_client_id=gitlab
gitlab_client_secret=$(cat /etc/authelia/secrets/gitlab_client_secret)
CRED_EOF
chmod 600 "$CRED_DIR/authelia"

echo ""
echo "=== Установка Authelia завершена! ==="
echo ""
echo "  Бинарник:       /usr/local/bin/authelia (v${AUTHELIA_VERSION})"
echo "  Конфиг:         /etc/authelia/configuration.yml"
echo "  Пользователи:   /etc/authelia/users_database.yml"
echo "  Секреты:        /etc/authelia/secrets/"
echo "  Systemd:        systemctl status authelia"
echo "  Логи:           journalctl -u authelia -f"
echo ""
echo "  Порт:           ${AUTHELIA_PORT} (localhost, за Traefik)"
echo "  URL:            https://${AUTHELIA_PREFIX}.${FIRST_BASE}"
echo ""
echo "  OIDC клиенты сохранены в: $CRED_DIR/authelia"
echo ""
echo "  Автоматически настроено:"
echo "    - authelia@file middleware в management-ui, n8n, mailu"
echo "    - OIDC секция в /etc/management-ui/config.json"
echo ""
echo "  Оставшиеся ручные шаги:"
echo "    1. Настроить OIDC в GitLab (gitlab.rb → omniauth_providers)"
echo "    2. Настроить MFA: https://${AUTHELIA_PREFIX}.${FIRST_BASE}"
echo ""
