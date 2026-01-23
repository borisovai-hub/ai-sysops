#!/bin/bash
# Скрипт установки веб-интерфейса управления
# Использование: sudo ./install-management-ui.sh [project-root-path]
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение и найдет management-ui.

set -e

# Определение директории скрипта (абсолютный путь)
# Это позволяет запускать скрипт из любой директории
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Установка веб-интерфейса управления ==="
echo ""

if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Получение корневой директории проекта (где находится management-ui)
# Может быть передан как аргумент или определяется автоматически
PROJECT_ROOT="${1:-}"
if [ -z "$PROJECT_ROOT" ]; then
    # Пытаемся определить автоматически
    # Проверяем несколько возможных расположений
    if [ -d "$(dirname "$(dirname "$SCRIPT_DIR")")/management-ui" ]; then
        PROJECT_ROOT="$(dirname "$(dirname "$SCRIPT_DIR")")"
    elif [ -d "$(dirname "$SCRIPT_DIR")/management-ui" ]; then
        PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
    else
        PROJECT_ROOT="$(dirname "$(dirname "$(dirname "$SCRIPT_DIR")")")"
    fi
fi
# Преобразуем в абсолютный путь
PROJECT_ROOT="$(cd "$PROJECT_ROOT" && pwd)"

# Проверка наличия Node.js
if ! command -v node &> /dev/null; then
    echo "[1/5] Установка Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
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
echo "  Скрипт находится в: $SCRIPT_DIR"
echo "  Корневая директория проекта: $PROJECT_ROOT"

# Поиск директории management-ui в различных возможных расположениях
MANAGEMENT_UI_FOUND=""
MANAGEMENT_UI_PATH=""

# 1. В корневой директории проекта (основной вариант)
if [ -d "$PROJECT_ROOT/management-ui" ]; then
    MANAGEMENT_UI_PATH="$PROJECT_ROOT/management-ui"
    MANAGEMENT_UI_FOUND="yes"
# 2. В родительской директории относительно скрипта
elif [ -d "$(dirname "$PROJECT_ROOT")/management-ui" ]; then
    MANAGEMENT_UI_PATH="$(dirname "$PROJECT_ROOT")/management-ui"
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
    cp -r "$MANAGEMENT_UI_PATH"/* "$APP_DIR/"
    echo "Файлы скопированы из $MANAGEMENT_UI_PATH"
else
    echo "Предупреждение: директория management-ui не найдена"
    echo "Искали в:"
    echo "  - $PROJECT_ROOT/management-ui"
    echo "  - $(dirname "$PROJECT_ROOT")/management-ui"
    echo "  - $(dirname "$SCRIPT_DIR")/management-ui"
    echo "  - ./management-ui"
    echo "  - ../management-ui"
    echo ""
    echo "Создаю базовую структуру..."
    mkdir -p "$APP_DIR/public"
    # Базовые файлы будут созданы отдельно
fi

# Установка зависимостей
echo ""
echo "[4/5] Установка зависимостей Node.js..."
cd "$APP_DIR"
if [ -f "package.json" ]; then
    npm install --production
else
    echo "Ошибка: package.json не найден"
    exit 1
fi

# Создание systemd service
echo ""
echo "[5/5] Создание systemd service..."
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

[Install]
WantedBy=multi-user.target
EOF

# Запуск сервиса
systemctl daemon-reload
systemctl enable management-ui
systemctl start management-ui

# Проверка статуса
sleep 2
if systemctl is-active --quiet management-ui; then
    echo ""
    echo "=== Установка завершена! ==="
    echo ""
    echo "Веб-интерфейс управления запущен"
    echo "  Проверка статуса: systemctl status management-ui"
    echo "  Просмотр логов: journalctl -u management-ui -f"
    echo ""
    echo "Настройте Traefik для проксирования веб-интерфейса"
else
    echo ""
    echo "Ошибка: сервис не запустился"
    echo "Проверьте логи: journalctl -u management-ui -n 50"
    exit 1
fi
