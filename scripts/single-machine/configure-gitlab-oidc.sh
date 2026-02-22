#!/bin/bash
# Скрипт настройки OmniAuth OIDC в GitLab CE для SSO через Authelia
# Использование: sudo ./configure-gitlab-oidc.sh [--force]
#
# Параметры:
#   --force - перезаписать существующую конфигурацию OIDC
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение.

# Определение директории скрипта (абсолютный путь)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Загрузка общих функций
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Предупреждение: common.sh не найден, некоторые функции могут быть недоступны"
fi

set +e

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Параметры
FORCE_MODE=false
for arg in "$@"; do
    case "$arg" in
        --force) FORCE_MODE=true ;;
    esac
done

# Проверка установки GitLab
if ! is_service_installed "gitlab-runsvdir.service"; then
    echo "Ошибка: GitLab не установлен"
    echo "Сначала запустите: sudo ./install-gitlab.sh"
    exit 1
fi

GITLAB_CONFIG="/etc/gitlab/gitlab.rb"

if [ ! -f "$GITLAB_CONFIG" ]; then
    echo "Ошибка: Файл конфигурации GitLab не найден: $GITLAB_CONFIG"
    exit 1
fi

# Проверка Authelia
GITLAB_CLIENT_SECRET_FILE="/etc/authelia/secrets/gitlab_client_secret"
if [ ! -f "$GITLAB_CLIENT_SECRET_FILE" ]; then
    echo "Ошибка: Authelia не установлена или OIDC-клиент gitlab не создан"
    echo "Сначала запустите: sudo ./install-authelia.sh"
    exit 1
fi

echo "=== Настройка GitLab OIDC (Authelia SSO) ==="
echo ""

# Проверка: уже настроено?
if grep -q "omniauth_providers" "$GITLAB_CONFIG" && [ "$FORCE_MODE" != true ]; then
    echo "  [Пропуск] OmniAuth уже настроен в gitlab.rb"
    echo "  Используйте --force для перезаписи"
    exit 0
fi

# Чтение client_secret
GITLAB_CLIENT_SECRET=$(cat "$GITLAB_CLIENT_SECRET_FILE")
if [ -z "$GITLAB_CLIENT_SECRET" ]; then
    echo "Ошибка: Файл $GITLAB_CLIENT_SECRET_FILE пуст"
    exit 1
fi

# Определение доменов
FIRST_BASE=""
if type get_base_domains &>/dev/null; then
    FIRST_BASE=$(get_base_domains | head -1)
fi
[ -z "$FIRST_BASE" ] && FIRST_BASE="borisovai.tech"

AUTH_PREFIX="auth"
if type get_config_value &>/dev/null; then
    AUTH_PREFIX_CFG=$(get_config_value "auth_prefix")
    [ -n "$AUTH_PREFIX_CFG" ] && AUTH_PREFIX="$AUTH_PREFIX_CFG"
fi

ISSUER_URL="https://${AUTH_PREFIX}.${FIRST_BASE}"

# Определение GITLAB_DOMAIN из external_url в gitlab.rb
GITLAB_DOMAIN=$(grep "^external_url" "$GITLAB_CONFIG" | head -1 | sed "s/external_url ['\"]https\?:\/\///;s/['\"]//g" | tr -d '[:space:]')
if [ -z "$GITLAB_DOMAIN" ]; then
    echo "Ошибка: Не удалось определить external_url из $GITLAB_CONFIG"
    exit 1
fi

REDIRECT_URI="https://${GITLAB_DOMAIN}/users/auth/openid_connect/callback"

echo "  Issuer:       $ISSUER_URL"
echo "  GitLab:       $GITLAB_DOMAIN"
echo "  Redirect URI: $REDIRECT_URI"
echo "  Client ID:    gitlab"
echo ""

# Резервная копия
cp "$GITLAB_CONFIG" "${GITLAB_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
echo "  [OK] Резервная копия создана"

# Удаление старого блока OmniAuth (если есть)
if grep -q "# OmniAuth SSO через Authelia" "$GITLAB_CONFIG"; then
    sed -i '/# OmniAuth SSO через Authelia/,/omniauth_block_auto_created_users/d' "$GITLAB_CONFIG"
    echo "  [OK] Старая конфигурация OmniAuth удалена"
fi

# Удаление отдельных строк omniauth (если были добавлены вручную)
sed -i '/^gitlab_rails\[.omniauth_providers.\]/d' "$GITLAB_CONFIG"
sed -i '/^gitlab_rails\[.omniauth_allow_single_sign_on.\]/d' "$GITLAB_CONFIG"
sed -i '/^gitlab_rails\[.omniauth_auto_link_user.\]/d' "$GITLAB_CONFIG"
sed -i '/^gitlab_rails\[.omniauth_block_auto_created_users.\]/d' "$GITLAB_CONFIG"

# Добавление конфигурации OmniAuth
cat >> "$GITLAB_CONFIG" << EOF

# OmniAuth SSO через Authelia (автогенерация скриптом configure-gitlab-oidc.sh)
gitlab_rails['omniauth_providers'] = [{
    name: "openid_connect",
    label: "BorisovAI SSO",
    args: {
        scope: ["openid", "profile", "email", "groups"],
        issuer: "${ISSUER_URL}",
        discovery: true,
        pkce: true,
        uid_field: "preferred_username",
        client_options: {
            identifier: "gitlab",
            secret: "${GITLAB_CLIENT_SECRET}",
            redirect_uri: "${REDIRECT_URI}"
        }
    }
}]
gitlab_rails['omniauth_allow_single_sign_on'] = ['openid_connect']
gitlab_rails['omniauth_auto_link_user'] = ['openid_connect']
gitlab_rails['omniauth_block_auto_created_users'] = false
EOF

echo "  [OK] Конфигурация OmniAuth добавлена в gitlab.rb"
echo ""

# Применение конфигурации
echo "  Применение конфигурации (gitlab-ctl reconfigure)..."
gitlab-ctl reconfigure
RECONFIGURE_EXIT=$?

if [ $RECONFIGURE_EXIT -eq 0 ]; then
    echo ""
    echo "=== Настройка OIDC завершена! ==="
    echo ""
    echo "  Issuer:       $ISSUER_URL"
    echo "  Client ID:    gitlab"
    echo "  Redirect URI: $REDIRECT_URI"
    echo ""
    echo "  На странице логина GitLab появится кнопка 'BorisovAI SSO'"
    echo "  Новые пользователи Authelia автоматически создаются в GitLab при первом входе"
else
    echo ""
    echo "Ошибка: gitlab-ctl reconfigure завершился с кодом $RECONFIGURE_EXIT"
    echo "Проверьте логи: sudo gitlab-ctl tail"
    exit 1
fi
