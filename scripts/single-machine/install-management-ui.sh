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
    echo "[1/5] Установка Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
else
    echo "[1/5] Node.js уже установлен: $(node --version)"
fi

# Создание директории для приложения
APP_DIR="/opt/management-ui"
echo ""
echo "[2/5] Создание директории приложения: $APP_DIR"
mkdir -p "$APP_DIR"

# Копирование файлов (предполагается, что файлы уже есть в проекте)
echo ""
echo "[3/5] Копирование файлов приложения..."
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

# Установка зависимостей
echo ""
echo "[4/5] Установка зависимостей Node.js..."
cd "$APP_DIR"
if [ -f "package.json" ]; then
    npm install --production
    if [ $? -ne 0 ]; then
        echo "Ошибка: Не удалось установить зависимости npm"
        exit 1
    fi
else
    echo "Ошибка: package.json не найден в $APP_DIR"
    exit 1
fi

# Создание файла авторизации по умолчанию
echo ""
echo "[5/6] Создание файла авторизации..."
AUTH_DIR="/etc/management-ui"
AUTH_FILE="$AUTH_DIR/auth.json"
mkdir -p "$AUTH_DIR"

# Генерация безопасного случайного пароля
if [ ! -f "$AUTH_FILE" ] || [ "$FORCE_MODE" = true ]; then
    # Генерация пароля: 24 символа, включая буквы, цифры и специальные символы
    if command -v openssl &> /dev/null; then
        DEFAULT_PASSWORD=$(openssl rand -base64 18 | tr -d "=+/" | cut -c1-24)
    elif [ -c /dev/urandom ]; then
        DEFAULT_PASSWORD=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9!@#$%^&*' | fold -w 24 | head -n 1)
    else
        # Fallback: используем комбинацию случайных данных
        DEFAULT_PASSWORD=$(date +%s | sha256sum | base64 | head -c 24)
    fi
    
    DEFAULT_USERNAME="admin"
    
    # Создание резервной копии если файл существует
    if [ -f "$AUTH_FILE" ]; then
        cp "$AUTH_FILE" "${AUTH_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
        echo "  Создана резервная копия существующего файла авторизации"
    fi
    
    # Создание файла авторизации
    cat > "$AUTH_FILE" << EOF
{
  "username": "$DEFAULT_USERNAME",
  "password": "$DEFAULT_PASSWORD"
}
EOF
    chmod 600 "$AUTH_FILE"
    echo "  Файл авторизации создан: $AUTH_FILE"
    echo ""
    echo "  =========================================="
    echo "  УЧЕТНЫЕ ДАННЫЕ ПО УМОЛЧАНИЮ:"
    echo "  =========================================="
    echo "  Логин: $DEFAULT_USERNAME"
    echo "  Пароль: $DEFAULT_PASSWORD"
    echo "  =========================================="
    echo ""
    echo "  ВАЖНО: Сохраните эти данные!"
    echo "  Файл авторизации: $AUTH_FILE"
    echo "  Для изменения пароля отредактируйте файл:"
    echo "    sudo nano $AUTH_FILE"
    echo ""
else
    echo "  [Пропуск] Файл авторизации уже существует: $AUTH_FILE"
    echo "  Для просмотра учетных данных:"
    echo "    sudo cat $AUTH_FILE"
fi

# Создание systemd service
echo ""
echo "[6/6] Создание systemd service..."
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
User=root
WorkingDirectory=$APP_DIR
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000

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
