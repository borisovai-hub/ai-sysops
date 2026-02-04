#!/bin/bash
# Инкрементальный деплой DNS API
# Обновляет код и конфиг, не трогает records.json
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

APP_DIR="/opt/dns-api"
CONFIG_DIR="/etc/dns-api"
RENDERED_CONFIG="$REPO_ROOT/rendered-configs/dns-api.config.json"

echo "=== Деплой DNS API ==="

# DNS API может быть не установлен — это опционально
if [ ! -d "$APP_DIR" ]; then
    echo "Каталог $APP_DIR не существует — создаём"
    mkdir -p "$APP_DIR"
fi

# Обновление кода
echo "Обновление кода..."
rsync -av --delete \
    --exclude=node_modules \
    "$REPO_ROOT/scripts/dns-api/" "$APP_DIR/"

# Обновление конфига (не трогаем records.json)
if [ -f "$RENDERED_CONFIG" ]; then
    echo "Обновление конфига..."
    mkdir -p "$CONFIG_DIR"
    cp "$RENDERED_CONFIG" "$CONFIG_DIR/config.json"
    chmod 600 "$CONFIG_DIR/config.json"
else
    echo "ПРЕДУПРЕЖДЕНИЕ: rendered config не найден, конфиг не обновлён"
fi

# Установка зависимостей (если есть package.json)
if [ -f "$APP_DIR/package.json" ]; then
    echo "Установка зависимостей..."
    cd "$APP_DIR"
    npm ci --production --prefer-offline 2>/dev/null || npm ci --production
fi

# Перезапуск сервиса (если существует)
if systemctl list-unit-files | grep -q dns-api.service; then
    echo "Перезапуск сервиса..."
    systemctl restart dns-api
    sleep 2
    if systemctl is-active --quiet dns-api; then
        echo "dns-api запущен"
    else
        echo "ПРЕДУПРЕЖДЕНИЕ: dns-api не запустился"
        journalctl -u dns-api -n 10 --no-pager
    fi
else
    echo "systemd сервис dns-api не найден — пропуск перезапуска"
fi

echo "=== DNS API задеплоен ==="
