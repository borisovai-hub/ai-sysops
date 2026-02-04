#!/bin/bash
# Инкрементальный деплой Management UI
# Обновляет код и конфиг, не трогает auth.json и projects.json
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

APP_DIR="/opt/management-ui"
CONFIG_DIR="/etc/management-ui"
RENDERED_CONFIG="$REPO_ROOT/rendered-configs/management-ui.config.json"

echo "=== Деплой Management UI ==="

# Проверка что каталог существует (создаётся при install)
if [ ! -d "$APP_DIR" ]; then
    echo "ОШИБКА: $APP_DIR не существует. Сначала выполните install-management-ui.sh"
    exit 1
fi

# Обновление кода (сохраняем node_modules)
echo "Обновление кода..."
rsync -av --delete \
    --exclude=node_modules \
    "$REPO_ROOT/management-ui/" "$APP_DIR/"

# Обновление конфига (не трогаем auth.json и projects.json)
if [ -f "$RENDERED_CONFIG" ]; then
    echo "Обновление конфига..."
    mkdir -p "$CONFIG_DIR"
    cp "$RENDERED_CONFIG" "$CONFIG_DIR/config.json"
    chmod 600 "$CONFIG_DIR/config.json"
else
    echo "ПРЕДУПРЕЖДЕНИЕ: rendered config не найден, конфиг не обновлён"
fi

# Установка зависимостей
echo "Установка зависимостей..."
cd "$APP_DIR"
npm ci --production --prefer-offline 2>/dev/null || npm ci --production

# Перезапуск сервиса
echo "Перезапуск сервиса..."
if systemctl list-unit-files | grep -q management-ui.service; then
    systemctl restart management-ui
    sleep 2
    if systemctl is-active --quiet management-ui; then
        echo "management-ui запущен"
    else
        echo "ОШИБКА: management-ui не запустился"
        journalctl -u management-ui -n 20 --no-pager
        exit 1
    fi
else
    echo "ПРЕДУПРЕЖДЕНИЕ: systemd сервис management-ui не найден"
fi

echo "=== Management UI задеплоен ==="
