#!/bin/bash
# Скрипт установки веб-интерфейса управления на одну машину
# Использование: sudo ./install-management-ui.sh [project-root-path] [--force]
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение и найдет management-ui.
# Если management-ui находится не в стандартном месте, укажите путь как аргумент.

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
INSTALL_ROOT=""

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
        *)
            if [ -z "$INSTALL_ROOT" ] && [ "$arg" != "--force" ]; then
                INSTALL_ROOT="$arg"
            fi
            ;;
    esac
done

# Получение корневой директории установки (где находится management-ui)
# Может быть передан как аргумент или определяется автоматически
if [ -z "$INSTALL_ROOT" ]; then
    INSTALL_ROOT="$(dirname "$SCRIPT_DIR")"
fi
# Преобразуем в абсолютный путь
INSTALL_ROOT="$(cd "$INSTALL_ROOT" && pwd)"

echo "=== Установка веб-интерфейса управления ==="
echo ""

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

if [ -n "$(get_config_value "base_domains")" ]; then
    UI_PREFIX=$(get_config_value "ui_prefix")
    [ -z "$UI_PREFIX" ] && UI_PREFIX="ui"
    save_config_value "ui_prefix" "$UI_PREFIX"
fi

# Проверка существования management-ui
APP_DIR="/opt/management-ui"
if [ "$FORCE_MODE" != true ]; then
    if is_dir_exists "$APP_DIR" && is_service_installed "management-ui.service"; then
        echo "  [Пропуск] Веб-интерфейс управления уже установлен"
        if is_service_running "management-ui.service"; then
            echo "  [OK] Веб-интерфейс запущен"
        else
            echo "  [Предупреждение] Веб-интерфейс установлен, но не запущен"
            echo "  Запуск сервиса..."
            systemctl start management-ui
        fi
        exit 0
    fi
fi

# Проверка наличия Node.js
if ! command -v node &> /dev/null; then
    echo "[1/7] Установка Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "[1/7] Node.js уже установлен: $(node --version)"
fi

# Создание директории для приложения
APP_DIR="/opt/management-ui"
echo ""
echo "[2/7] Создание директории приложения: $APP_DIR"
mkdir -p "$APP_DIR"

# Копирование файлов (предполагается, что файлы уже есть в проекте)
echo ""
echo "[3/7] Копирование файлов приложения..."
echo "Поиск директории management-ui..."
echo "  Скрипт находится в: $SCRIPT_DIR"
echo "  Корневая директория установки: $INSTALL_ROOT"

# Поиск директории management-ui в различных возможных расположениях
MANAGEMENT_UI_FOUND=""
MANAGEMENT_UI_PATH=""

# 1. В корневой директории установки (основной вариант: ~/install/management-ui)
if [ -d "$INSTALL_ROOT/management-ui" ]; then
    MANAGEMENT_UI_PATH="$INSTALL_ROOT/management-ui"
    MANAGEMENT_UI_FOUND="yes"
# 2. В родительской директории относительно скрипта
elif [ -d "$(dirname "$INSTALL_ROOT")/management-ui" ]; then
    MANAGEMENT_UI_PATH="$(dirname "$INSTALL_ROOT")/management-ui"
    MANAGEMENT_UI_FOUND="yes"
# 3. В той же директории что и скрипты
elif [ -d "$(dirname "$SCRIPT_DIR")/management-ui" ]; then
    MANAGEMENT_UI_PATH="$(dirname "$SCRIPT_DIR")/management-ui"
    MANAGEMENT_UI_FOUND="yes"
# 4. В текущей директории (если запускается из корня проекта)
elif [ -d "./management-ui" ]; then
    MANAGEMENT_UI_PATH="$(cd ./management-ui && pwd)"
    MANAGEMENT_UI_FOUND="yes"
# 5. В родительской директории
elif [ -d "../management-ui" ]; then
    MANAGEMENT_UI_PATH="$(cd ../management-ui && pwd)"
    MANAGEMENT_UI_FOUND="yes"
fi

if [ -n "$MANAGEMENT_UI_FOUND" ]; then
    echo "  Найдена директория management-ui: $MANAGEMENT_UI_PATH"
    if [ "$FORCE_MODE" = true ] && [ -d "$APP_DIR" ]; then
        echo "  Удаление старой версии..."
        rm -rf "$APP_DIR"/*
    fi
    cp -r "$MANAGEMENT_UI_PATH"/* "$APP_DIR/"
    echo "Файлы скопированы из $MANAGEMENT_UI_PATH"
    # Создание выделенного пользователя для запуска сервиса
    if ! id management-ui &>/dev/null; then
        adduser --system --no-create-home --group management-ui 2>/dev/null || true
        echo "  [OK] Создан пользователь management-ui"
    fi
    chown -R management-ui:management-ui "$APP_DIR"
    # Конфиги читаемы для management-ui, но принадлежат root
    chown root:management-ui /etc/management-ui/ 2>/dev/null || true
    chmod 750 /etc/management-ui/ 2>/dev/null || true
    for f in /etc/management-ui/*.json; do
        [ -f "$f" ] && chown root:management-ui "$f" && chmod 640 "$f"
    done
else
    echo "Ошибка: директория management-ui не найдена"
    echo ""
    echo "Убедитесь, что директория management-ui загружена на сервер"
    echo "Ожидаемое расположение: $INSTALL_ROOT/management-ui"
    echo ""
    echo "Если management-ui находится в другом месте, укажите путь:"
    echo "  sudo $SCRIPT_DIR/install-management-ui.sh /path/to/install/root"
    echo ""
    echo "Текущее расположение скрипта: $SCRIPT_DIR"
    echo "Определенная корневая директория установки: $INSTALL_ROOT"
    echo ""
    echo "Проверенные пути:"
    echo "  - $INSTALL_ROOT/management-ui"
    echo "  - $(dirname "$INSTALL_ROOT")/management-ui"
    echo "  - $(dirname "$SCRIPT_DIR")/management-ui"
    echo "  - ./management-ui"
    echo "  - ../management-ui"
    exit 1
fi

# Установка зависимостей и сборка monorepo
echo ""
echo "[4/7] Установка зависимостей и сборка..."
cd "$APP_DIR"
if [ -f "package.json" ]; then
    npm ci
    if [ $? -ne 0 ]; then
        echo "Ошибка: Не удалось установить зависимости npm"
        exit 1
    fi
    echo "Сборка monorepo (shared -> frontend -> backend)..."
    npm run build
    if [ $? -ne 0 ]; then
        echo "Ошибка: Сборка не удалась"
        exit 1
    fi
    echo "Миграции БД..."
    mkdir -p /var/lib/management-ui
    chown management-ui:management-ui /var/lib/management-ui
    npm run db:migrate -w backend 2>&1 || echo "ПРЕДУПРЕЖДЕНИЕ: миграции не выполнены"
else
    echo "Ошибка: package.json не найден в $APP_DIR"
    exit 1
fi

# Создание файла авторизации по умолчанию
echo ""
echo "[5/7] Создание файла авторизации..."
AUTH_DIR="/etc/management-ui"
AUTH_FILE="$AUTH_DIR/auth.json"
mkdir -p "$AUTH_DIR"

if [ ! -f "$AUTH_FILE" ]; then
    # Генерация пароля: 24 символа
    if command -v openssl &> /dev/null; then
        DEFAULT_PASSWORD=$(openssl rand -base64 18 | tr -d "=+/" | cut -c1-24)
    elif [ -c /dev/urandom ]; then
        DEFAULT_PASSWORD=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9!@#$%^&*' | fold -w 24 | head -n 1)
    else
        DEFAULT_PASSWORD=$(date +%s | sha256sum | base64 | head -c 24)
    fi

    DEFAULT_USERNAME="admin"

    cat > "$AUTH_FILE" << EOF
{
  "username": "$DEFAULT_USERNAME",
  "password": "$DEFAULT_PASSWORD"
}
EOF
    chmod 600 "$AUTH_FILE"
    echo "  Файл авторизации создан: $AUTH_FILE"

    # Сохранение секретов в файл (не в stdout)
    CRED_DIR="/root/.borisovai-credentials"
    mkdir -p "$CRED_DIR"
    chmod 700 "$CRED_DIR"
    cat > "$CRED_DIR/management-ui" << CRED_EOF
# management-ui credentials ($(date '+%Y-%m-%d %H:%M:%S'))
username=$DEFAULT_USERNAME
password=$DEFAULT_PASSWORD
CRED_EOF
    chmod 600 "$CRED_DIR/management-ui"

    echo ""
    echo "  =========================================="
    echo "  УЧЕТНЫЕ ДАННЫЕ СОХРАНЕНЫ:"
    echo "  =========================================="
    echo "  Логин: $DEFAULT_USERNAME"
    echo "  Пароль: сохранён в $CRED_DIR/management-ui"
    echo "  =========================================="
    echo ""
    echo "  Для просмотра: sudo cat $CRED_DIR/management-ui"
    echo "  Для изменения пароля: sudo nano $AUTH_FILE"
    echo ""
else
    echo "  [OK] Файл авторизации сохранён: $AUTH_FILE"
fi

# Создание конфигурации
echo ""
echo "[6/7] Настройка конфигурации..."
CONFIG_FILE="$AUTH_DIR/config.json"

# Чтение существующих значений из config.json (если есть)
_cfg_get() {
    local key="$1"
    if [ -f "$CONFIG_FILE" ]; then
        grep -o "\"$key\": \"[^\"]*\"" "$CONFIG_FILE" 2>/dev/null | cut -d'"' -f4
    fi
}

# Маскировка токена для отображения (первые 8 символов)
_mask_token() {
    local t="$1"
    if [ ${#t} -gt 8 ]; then
        echo "${t:0:8}..."
    else
        echo "$t"
    fi
}

_write_config() {
    local gitlab_url="$1" gitlab_token="$2" strapi_url="$3" strapi_token="$4"
    local base_port="${5:-4010}" runner_tag="${6:-deploy-production}"
    local main_site="${7:-/var/www/borisovai-site}" deploy_base="${8:-/var/www}"

    if [ -f "$CONFIG_FILE" ]; then
        cp "$CONFIG_FILE" "${CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    fi

    # Авторизация Management UI через Authelia ForwardAuth (Traefik middleware)
    # OIDC секция в config.json больше не нужна

    cat > "$CONFIG_FILE" << EOF
{
  "gitlab_url": "$gitlab_url",
  "gitlab_token": "$gitlab_token",
  "strapi_url": "$strapi_url",
  "strapi_token": "$strapi_token",
  "base_port": $base_port,
  "runner_tag": "$runner_tag",
  "main_site_path": "$main_site",
  "deploy_base_path": "$deploy_base"
}
EOF
    chmod 600 "$CONFIG_FILE"
    echo ""
    echo "  Конфигурация сохранена: $CONFIG_FILE"
}

_prompt_config() {
    local prev_gitlab_url="$1" prev_gitlab_token="$2" prev_strapi_url="$3" prev_strapi_token="$4"

    echo ""
    echo "  Введите параметры подключения к GitLab и Strapi."
    echo "  Нажмите Enter чтобы оставить текущее значение."
    echo ""

    # GitLab URL
    if [ -n "$prev_gitlab_url" ]; then
        read -r -p "  GitLab URL [$prev_gitlab_url]: " INPUT_GITLAB_URL
        [ -z "$INPUT_GITLAB_URL" ] && INPUT_GITLAB_URL="$prev_gitlab_url"
    else
        read -r -p "  GitLab URL (например https://gitlab.example.com): " INPUT_GITLAB_URL
    fi

    # GitLab Token
    if [ -n "$INPUT_GITLAB_URL" ]; then
        if [ -n "$prev_gitlab_token" ]; then
            read -r -p "  GitLab Token [$(_mask_token "$prev_gitlab_token")]: " INPUT_GITLAB_TOKEN
            [ -z "$INPUT_GITLAB_TOKEN" ] && INPUT_GITLAB_TOKEN="$prev_gitlab_token"
        else
            read -r -p "  GitLab Token (Personal Access Token): " INPUT_GITLAB_TOKEN
        fi
    else
        INPUT_GITLAB_TOKEN=""
    fi

    # Strapi URL
    if [ -n "$prev_strapi_url" ]; then
        read -r -p "  Strapi URL [$prev_strapi_url]: " INPUT_STRAPI_URL
        [ -z "$INPUT_STRAPI_URL" ] && INPUT_STRAPI_URL="$prev_strapi_url"
    else
        read -r -p "  Strapi URL (например https://strapi.example.com, Enter для пропуска): " INPUT_STRAPI_URL
    fi

    # Strapi Token
    if [ -n "$INPUT_STRAPI_URL" ]; then
        if [ -n "$prev_strapi_token" ]; then
            read -r -p "  Strapi Token [$(_mask_token "$prev_strapi_token")]: " INPUT_STRAPI_TOKEN
            [ -z "$INPUT_STRAPI_TOKEN" ] && INPUT_STRAPI_TOKEN="$prev_strapi_token"
        else
            read -r -p "  Strapi Token (API Token): " INPUT_STRAPI_TOKEN
        fi
    else
        INPUT_STRAPI_TOKEN=""
    fi

    local prev_base_port=$(_cfg_get "base_port")
    local prev_runner_tag=$(_cfg_get "runner_tag")
    local prev_main_site=$(_cfg_get "main_site_path")
    local prev_deploy_base=$(_cfg_get "deploy_base_path")

    _write_config \
        "${INPUT_GITLAB_URL:-}" "${INPUT_GITLAB_TOKEN:-}" \
        "${INPUT_STRAPI_URL:-}" "${INPUT_STRAPI_TOKEN:-}" \
        "${prev_base_port:-4010}" "${prev_runner_tag:-deploy-production}" \
        "${prev_main_site:-/var/www/borisovai-site}" "${prev_deploy_base:-/var/www}"
}

if [ -f "$CONFIG_FILE" ]; then
    echo "  Текущая конфигурация: $CONFIG_FILE"
    echo "    gitlab_url:    $(_cfg_get "gitlab_url")"
    echo "    gitlab_token:  $(_mask_token "$(_cfg_get "gitlab_token")")"
    echo "    strapi_url:    $(_cfg_get "strapi_url")"
    echo "    strapi_token:  $(_mask_token "$(_cfg_get "strapi_token")")"
    echo ""
    read -r -p "  Переписать конфигурацию? (y/N): " REWRITE_CONFIG
    if [ "$REWRITE_CONFIG" = "y" ] || [ "$REWRITE_CONFIG" = "Y" ]; then
        _prompt_config \
            "$(_cfg_get "gitlab_url")" "$(_cfg_get "gitlab_token")" \
            "$(_cfg_get "strapi_url")" "$(_cfg_get "strapi_token")"
    else
        echo "  [OK] Конфигурация без изменений"
        echo "  Для ручного редактирования: sudo nano $CONFIG_FILE"
    fi
else
    _prompt_config "" "" "" ""
fi

# Создание systemd service
echo ""
echo "[7/7] Создание systemd service..."
if [ "$FORCE_MODE" = true ] || [ ! -f "/etc/systemd/system/management-ui.service" ]; then
    # Создание резервной копии если файл существует
    if [ -f "/etc/systemd/system/management-ui.service" ]; then
        cp /etc/systemd/system/management-ui.service /etc/systemd/system/management-ui.service.backup.$(date +%Y%m%d_%H%M%S)
    fi
    cat > /etc/systemd/system/management-ui.service << EOF
[Unit]
Description=Management UI
After=network.target traefik.service

[Service]
Type=simple
User=management-ui
Group=management-ui
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node backend/dist/index.js
Restart=always
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=SERVER_NAME=contabo-sm-139
Environment=CONFIG_REPO_DIR=/opt/server-configs
NoNewPrivileges=false
ProtectSystem=strict
ReadWritePaths=/etc/management-ui /var/log /var/lib/management-ui /opt/server-configs
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
else
    echo "  [Пропуск] Systemd service уже существует"
fi

# Запуск сервиса
systemctl daemon-reload
systemctl enable management-ui

# Остановка перед запуском если уже запущен
if systemctl is-active --quiet management-ui 2>/dev/null; then
    echo "  Остановка существующего сервиса..."
    systemctl stop management-ui
fi

systemctl start management-ui

sleep 2
if systemctl is-active --quiet management-ui; then
    echo ""
    echo "=== Установка завершена! ==="
    echo ""
    echo "Веб-интерфейс управления запущен"
    echo "  Доступен на: http://127.0.0.1:3000"
    echo ""
    if [ -f "$AUTH_FILE" ]; then
        AUTH_USERNAME=$(grep -o '"username": "[^"]*"' "$AUTH_FILE" | cut -d'"' -f4)
        echo "  Учетные данные сохранены в: $AUTH_FILE"
        echo "  Логин: $AUTH_USERNAME"
        echo "  Для просмотра пароля: sudo cat $AUTH_FILE"
    fi
    echo ""
    echo "  Проверка статуса: systemctl status management-ui"
    echo "  Просмотр логов: journalctl -u management-ui -f"
else
    echo ""
    echo "Ошибка: сервис не запустился"
    echo "Проверьте логи: journalctl -u management-ui -n 50"
    exit 1
fi
