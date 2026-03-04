#!/bin/bash
# Инкрементальный деплой Management UI (monorepo: shared + backend + frontend)
# Обновляет код и конфиг, не трогает auth.json и projects.json
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

APP_DIR="/opt/management-ui"
CONFIG_DIR="/etc/management-ui"
DB_DIR="/var/lib/management-ui"
BACKUP_DIR="/var/backups/management-ui"
RENDERED_CONFIG="$REPO_ROOT/rendered-configs/management-ui.config.json"

echo "=== Деплой Management UI ==="

# Проверка что каталог существует (создаётся при install)
if [ ! -d "$APP_DIR" ]; then
    echo "ОШИБКА: $APP_DIR не существует. Сначала выполните install-management-ui.sh"
    exit 1
fi

# --- Бэкап перед обновлением ---
echo "Создание бэкапа..."
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
mkdir -p "$BACKUP_DIR"

# Бэкап кода (без node_modules)
tar czf "$BACKUP_DIR/app_${TIMESTAMP}.tar.gz" \
    --exclude='node_modules' \
    -C /opt management-ui/ 2>/dev/null || echo "ПРЕДУПРЕЖДЕНИЕ: не удалось создать бэкап кода"

# Бэкап БД
if [ -f "$DB_DIR/management-ui.db" ]; then
    cp "$DB_DIR/management-ui.db" "$BACKUP_DIR/management-ui_${TIMESTAMP}.db"
    echo "Бэкап БД создан: $BACKUP_DIR/management-ui_${TIMESTAMP}.db"
fi

# Бэкап конфигов
if [ -d "$CONFIG_DIR" ]; then
    tar czf "$BACKUP_DIR/config_${TIMESTAMP}.tar.gz" \
        -C /etc management-ui/ 2>/dev/null || true
fi

# Удаление старых бэкапов (хранить 5 последних)
ls -t "$BACKUP_DIR"/app_*.tar.gz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
ls -t "$BACKUP_DIR"/management-ui_*.db 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true
ls -t "$BACKUP_DIR"/config_*.tar.gz 2>/dev/null | tail -n +6 | xargs rm -f 2>/dev/null || true

echo "Бэкап создан в $BACKUP_DIR"

# --- Обновление кода ---
echo "Обновление кода..."
rsync -av --delete \
    --exclude=node_modules \
    --exclude=test.db \
    --exclude=test.db-shm \
    --exclude=test.db-wal \
    --exclude='*.tsbuildinfo' \
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

# --- Сборка monorepo ---
echo "Установка зависимостей..."
cd "$APP_DIR"
npm ci

# Очистка стейл build-артефактов (rsync --exclude не удаляет существующие)
echo "Очистка стейл build-кэша..."
rm -rf shared/dist backend/dist frontend/dist
rm -f shared/tsconfig.tsbuildinfo backend/tsconfig.tsbuildinfo frontend/tsconfig.tsbuildinfo

echo "Сборка monorepo (shared -> frontend -> backend)..."
npm run build

# --- Создание system user (до всех chown операций) ---
if ! id -u management-ui > /dev/null 2>&1; then
    echo "Создание пользователя management-ui..."
    adduser --system --no-create-home --group management-ui 2>/dev/null || true
fi

# --- Подготовка БД ---
echo "Подготовка каталога БД..."
mkdir -p "$DB_DIR"
chown -R management-ui:management-ui "$DB_DIR"
# Миграции применятся автоматически при старте (initDb → migrate)

# Права на директории
chown -R management-ui:management-ui "$APP_DIR"
chown -R management-ui:management-ui "$CONFIG_DIR" 2>/dev/null || true

# --- Обновление systemd ---
CURRENT_EXEC=$(grep -oP 'ExecStart=\K.*' /etc/systemd/system/management-ui.service 2>/dev/null || echo "")
NEED_SYSTEMD_UPDATE=false

# Проверяем что ExecStart и User корректны
if [[ "$CURRENT_EXEC" != *"backend/dist/index.js"* ]]; then
    NEED_SYSTEMD_UPDATE=true
fi
# Проверяем что User=management-ui (а не root или другой)
CURRENT_USER=$(grep -oP 'User=\K.*' /etc/systemd/system/management-ui.service 2>/dev/null || echo "")
if [[ "$CURRENT_USER" != "management-ui" ]]; then
    NEED_SYSTEMD_UPDATE=true
fi
# Проверяем что StartLimitIntervalSec в [Unit] (не в [Service])
if grep -q '^\[Service\]' /etc/systemd/system/management-ui.service 2>/dev/null && \
   grep -A20 '^\[Service\]' /etc/systemd/system/management-ui.service 2>/dev/null | grep -q 'StartLimitIntervalSec'; then
    NEED_SYSTEMD_UPDATE=true
fi

if [ "$NEED_SYSTEMD_UPDATE" = true ] && [ -f /etc/systemd/system/management-ui.service ]; then
    echo "Обновление systemd service (monorepo entry point)..."
    cp /etc/systemd/system/management-ui.service "/etc/systemd/system/management-ui.service.backup.${TIMESTAMP}"
    cat > /etc/systemd/system/management-ui.service << 'SVCEOF'
[Unit]
Description=Management UI
After=network.target traefik.service
StartLimitBurst=5
StartLimitIntervalSec=60

[Service]
Type=simple
User=management-ui
Group=management-ui
WorkingDirectory=/opt/management-ui
ExecStart=/usr/bin/node backend/dist/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=SERVER_NAME=contabo-sm-139
Environment=CONFIG_REPO_DIR=/opt/server-configs
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/etc/management-ui /var/log /var/lib/management-ui /opt/server-configs
PrivateTmp=true

[Install]
WantedBy=multi-user.target
SVCEOF
    systemctl daemon-reload
    echo "systemd service обновлён"
fi

# --- Перезапуск ---
echo "Перезапуск сервиса..."
if systemctl list-unit-files | grep -q management-ui.service; then
    systemctl restart management-ui
    sleep 3
    if systemctl is-active --quiet management-ui; then
        echo "management-ui запущен"
    else
        echo "ОШИБКА: management-ui не запустился"
        journalctl -u management-ui -n 30 --no-pager
        # Попытка отката
        echo "Попытка отката..."
        if [ -f "$BACKUP_DIR/app_${TIMESTAMP}.tar.gz" ]; then
            tar xzf "$BACKUP_DIR/app_${TIMESTAMP}.tar.gz" -C /opt/
            if [ -f "/etc/systemd/system/management-ui.service.backup.${TIMESTAMP}" ]; then
                cp "/etc/systemd/system/management-ui.service.backup.${TIMESTAMP}" /etc/systemd/system/management-ui.service
                systemctl daemon-reload
            fi
            cd "$APP_DIR" && npm ci --omit=dev 2>/dev/null || true
            systemctl restart management-ui
            sleep 2
            if systemctl is-active --quiet management-ui; then
                echo "ОТКАТ ВЫПОЛНЕН: предыдущая версия восстановлена"
            else
                echo "КРИТИЧЕСКАЯ ОШИБКА: откат не помог"
                journalctl -u management-ui -n 20 --no-pager
            fi
        fi
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

        EXISTING_RECORDS=$(curl -sf "${DNS_API_BASE}/api/records" 2>/dev/null || echo '{"records":[]}')

        for SUBDOMAIN in "${ADMIN_DOMAINS[@]}"; do
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
