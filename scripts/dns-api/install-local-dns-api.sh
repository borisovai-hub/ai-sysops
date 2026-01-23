#!/bin/bash
# Скрипт установки локального DNS API сервера
# Использование: sudo ./install-local-dns-api.sh

set -e

if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

echo "=== Установка локального DNS API сервера ==="
echo ""

# Проверка Node.js
if ! command -v node &> /dev/null; then
    echo "[1/5] Установка Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
else
    echo "[1/5] Node.js уже установлен: $(node --version)"
fi

# Создание директорий
echo ""
echo "[2/5] Создание директорий..."
API_DIR="/opt/local-dns-api"
mkdir -p "$API_DIR"
mkdir -p "/etc/dns-api"
mkdir -p "/var/log/local-dns-api"

# Копирование файлов
echo ""
echo "[3/5] Копирование файлов..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/local-dns-api-server.js" ]; then
    cp "$SCRIPT_DIR/local-dns-api-server.js" "$API_DIR/"
    chmod +x "$API_DIR/local-dns-api-server.js"
    echo "Файлы скопированы"
else
    echo "Ошибка: local-dns-api-server.js не найден"
    exit 1
fi

# Установка зависимостей
echo ""
echo "[4/5] Установка зависимостей Node.js..."
cd "$API_DIR"

# Создание или обновление package.json
cat > package.json << EOF
{
  "name": "local-dns-api",
  "version": "1.0.0",
  "description": "Local DNS API server",
  "main": "local-dns-api-server.js",
  "dependencies": {
    "express": "^4.18.2",
    "fs-extra": "^11.1.1",
    "uuid": "^9.0.0"
  }
}
EOF

# Установка зависимостей
npm install --production

# Проверка что uuid установлен
if [ ! -d "node_modules/uuid" ]; then
    echo "Предупреждение: модуль uuid не найден, переустанавливаем зависимости..."
    npm install uuid --production
fi

# Создание systemd service
echo ""
echo "[5/5] Создание systemd service..."
cat > /etc/systemd/system/local-dns-api.service << EOF
[Unit]
Description=Local DNS API Server
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=$API_DIR
ExecStart=/usr/bin/node local-dns-api-server.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=local-dns-api

[Install]
WantedBy=multi-user.target
EOF

# Инициализация файла записей
if [ ! -f "/etc/dns-api/records.json" ]; then
    echo "Создание файла записей..."
    cat > /etc/dns-api/records.json << EOF
{
  "records": []
}
EOF
    chmod 600 /etc/dns-api/records.json
fi

# Запуск сервиса
systemctl daemon-reload
systemctl enable local-dns-api
systemctl start local-dns-api

sleep 2
if systemctl is-active --quiet local-dns-api; then
    echo ""
    echo "=== Установка завершена! ==="
    echo ""
    echo "Локальный DNS API сервер запущен"
    echo "  API: http://127.0.0.1:5353"
    echo "  Файл записей: /etc/dns-api/records.json"
    echo ""
    echo "Проверка статуса: systemctl status local-dns-api"
    echo "Просмотр логов: journalctl -u local-dns-api -f"
else
    echo ""
    echo "Ошибка: сервис не запустился"
    echo "Проверьте логи: journalctl -u local-dns-api -n 50"
    exit 1
fi
