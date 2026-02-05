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

# Обновление Traefik-конфига для админки
TRAEFIK_DYNAMIC_DIR="/etc/traefik/dynamic"
ADMIN_TRAEFIK_CONFIG="$REPO_ROOT/config/single-machine/traefik/dynamic/admin.yml"
if [ -f "$ADMIN_TRAEFIK_CONFIG" ]; then
    echo "Обновление Traefik-конфига для админки..."
    mkdir -p "$TRAEFIK_DYNAMIC_DIR"
    cp "$ADMIN_TRAEFIK_CONFIG" "$TRAEFIK_DYNAMIC_DIR/admin.yml"
else
    echo "ПРЕДУПРЕЖДЕНИЕ: Traefik-конфиг админки не найден: $ADMIN_TRAEFIK_CONFIG"
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

# Создание DNS-записей для админки (идемпотентно)
DNS_API_PORT=5353
DNS_API_BASE="http://127.0.0.1:${DNS_API_PORT}"
DNS_CONFIG="/etc/dns-api/config.json"

if [ -f "$DNS_CONFIG" ]; then
    ADMIN_DOMAINS=("admin")
    SERVER_IP=$(hostname -I | awk '{print $1}')

    if [ -n "$SERVER_IP" ]; then
        echo "Проверка DNS-записей для админки (IP: $SERVER_IP)..."

        # Получаем текущие записи
        EXISTING_RECORDS=$(curl -sf "${DNS_API_BASE}/api/records" 2>/dev/null || echo '{"records":[]}')

        for SUBDOMAIN in "${ADMIN_DOMAINS[@]}"; do
            # Проверяем, существует ли запись
            if echo "$EXISTING_RECORDS" | grep -q "\"subdomain\":\"${SUBDOMAIN}\""; then
                echo "  DNS запись '${SUBDOMAIN}' уже существует — пропуск"
            else
                echo "  Создание DNS записи: ${SUBDOMAIN} → ${SERVER_IP}"
                curl -sf -X POST "${DNS_API_BASE}/api/records" \
                    -H "Content-Type: application/json" \
                    -d "{\"subdomain\":\"${SUBDOMAIN}\",\"ip\":\"${SERVER_IP}\"}" \
                    > /dev/null 2>&1 && echo "    OK" || echo "    ПРЕДУПРЕЖДЕНИЕ: не удалось создать запись"
            fi
        done
    else
        echo "ПРЕДУПРЕЖДЕНИЕ: не удалось определить IP сервера, DNS-записи не созданы"
    fi
else
    echo "ПРЕДУПРЕЖДЕНИЕ: DNS API конфиг не найден, DNS-записи не созданы"
fi

echo "=== Management UI задеплоен ==="
