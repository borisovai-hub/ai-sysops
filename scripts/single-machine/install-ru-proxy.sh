#!/bin/bash
# Скрипт установки Russian Reverse Proxy (Caddy + Management API)
# Использование: sudo ./install-ru-proxy.sh [--force]
#
# Запускается на РОССИЙСКОМ VPS (не на Contabo!)
#
# Устанавливает:
# - Caddy (reverse proxy с auto-HTTPS)
# - ru-proxy-api (Node.js, управление доменами)
# - Systemd units (caddy.service, ru-proxy-api.service)
# - Firewall (ufw)
#
# Параметры:
#   --force  - переустановить даже если уже установлено

set +e

# Параметры
FORCE_MODE=false
API_PORT=3100

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
    if command -v caddy &>/dev/null && systemctl is-active --quiet ru-proxy-api 2>/dev/null; then
        echo "  [Пропуск] RU Proxy уже установлен"
        echo "  Caddy:         $(systemctl is-active caddy 2>/dev/null || echo 'неизвестно')"
        echo "  ru-proxy-api:  $(systemctl is-active ru-proxy-api 2>/dev/null || echo 'неизвестно')"
        exit 0
    fi
fi

echo ""
echo "=== Установка Russian Reverse Proxy (Caddy + Management API) ==="
echo ""

# Определяем директорию скрипта (для копирования ru-proxy/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RU_PROXY_SRC="$REPO_ROOT/ru-proxy"

if [ ! -d "$RU_PROXY_SRC" ]; then
    echo "  [ОШИБКА] Директория ru-proxy/ не найдена в $REPO_ROOT"
    echo "  Убедитесь, что скрипт запускается из репозитория borisovai-admin"
    exit 1
fi

# ============================================================
# [1/7] Установка Caddy
# ============================================================
echo "[1/7] Установка Caddy..."

if command -v caddy &>/dev/null && [ "$FORCE_MODE" != true ]; then
    echo "  [Пропуск] Caddy уже установлен: $(caddy version 2>/dev/null || echo 'неизвестно')"
else
    # Установка зависимостей
    apt-get update -qq
    apt-get install -y -qq debian-keyring debian-archive-keyring apt-transport-https curl gnupg

    # Добавление репозитория Caddy
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list > /dev/null

    apt-get update -qq
    apt-get install -y -qq caddy

    if command -v caddy &>/dev/null; then
        echo "  [OK] Caddy установлен: $(caddy version)"
    else
        echo "  [ОШИБКА] Не удалось установить Caddy"
        exit 1
    fi
fi

# Остановить Caddy на время настройки
systemctl stop caddy 2>/dev/null || true

# ============================================================
# [2/7] Установка Node.js 20
# ============================================================
echo "[2/7] Проверка Node.js..."

NODE_OK=false
if command -v node &>/dev/null; then
    NODE_VERSION=$(node -v 2>/dev/null | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VERSION" -ge 20 ] 2>/dev/null; then
        NODE_OK=true
        echo "  [Пропуск] Node.js уже установлен: $(node -v)"
    fi
fi

if [ "$NODE_OK" != true ]; then
    echo "  Установка Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs

    if command -v node &>/dev/null; then
        echo "  [OK] Node.js установлен: $(node -v)"
    else
        echo "  [ОШИБКА] Не удалось установить Node.js"
        exit 1
    fi
fi

# ============================================================
# [3/7] Конфигурация
# ============================================================
echo "[3/7] Конфигурация..."

CONFIG_DIR="/etc/ru-proxy"
mkdir -p "$CONFIG_DIR"

# Чтение существующей конфигурации
EXISTING_CONTABO_IP=""
EXISTING_API_PORT="$API_PORT"
if [ -f "$CONFIG_DIR/config.json" ]; then
    EXISTING_CONTABO_IP=$(grep -o '"contabo_ip"\s*:\s*"[^"]*"' "$CONFIG_DIR/config.json" 2>/dev/null | sed 's/.*"contabo_ip"\s*:\s*"//;s/"//')
    EXISTING_API_PORT=$(grep -o '"api_port"\s*:\s*[0-9]*' "$CONFIG_DIR/config.json" 2>/dev/null | sed 's/.*:\s*//')
    [ -z "$EXISTING_API_PORT" ] && EXISTING_API_PORT="$API_PORT"
fi

# Запрос Contabo IP
if [ -n "$EXISTING_CONTABO_IP" ]; then
    read -p "  IP-адрес Contabo (основной сервер) [$EXISTING_CONTABO_IP]: " INPUT_IP
    CONTABO_IP="${INPUT_IP:-$EXISTING_CONTABO_IP}"
else
    read -p "  IP-адрес Contabo (основной сервер): " CONTABO_IP
    if [ -z "$CONTABO_IP" ]; then
        echo "  [ОШИБКА] IP-адрес Contabo обязателен!"
        exit 1
    fi
fi

# Запрос порта API
read -p "  Порт management API [$EXISTING_API_PORT]: " INPUT_PORT
API_PORT="${INPUT_PORT:-$EXISTING_API_PORT}"

# Начальные домены (можно изменить)
DEFAULT_DOMAINS="borisovai.ru,admin.borisovai.ru,api.borisovai.ru,gitlab.dev.borisovai.ru,n8n.dev.borisovai.ru,mail.dev.borisovai.ru,auth.borisovai.ru,analytics.dev.borisovai.ru"
echo ""
echo "  Начальные домены для проксирования:"
echo "  $DEFAULT_DOMAINS"
read -p "  Введите домены через запятую (или Enter для дефолтных): " INPUT_DOMAINS
DOMAINS="${INPUT_DOMAINS:-$DEFAULT_DOMAINS}"

# Сохранение конфигурации
cat > "$CONFIG_DIR/config.json" << EOF
{
    "contabo_ip": "$CONTABO_IP",
    "api_port": $API_PORT,
    "default_backend": "https://$CONTABO_IP"
}
EOF
chmod 640 "$CONFIG_DIR/config.json"
echo "  [OK] Конфигурация сохранена в $CONFIG_DIR/config.json"

# ============================================================
# [4/7] Генерация auth-token и domains.json
# ============================================================
echo "[4/7] Генерация auth-token и domains.json..."

# Auth token (только если не существует или --force)
AUTH_TOKEN_FILE="$CONFIG_DIR/auth-token"
if [ -f "$AUTH_TOKEN_FILE" ] && [ -s "$AUTH_TOKEN_FILE" ] && [ "$FORCE_MODE" != true ]; then
    echo "  [Пропуск] auth-token уже существует"
    AUTH_TOKEN=$(cat "$AUTH_TOKEN_FILE")
else
    AUTH_TOKEN=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-40)
    echo "$AUTH_TOKEN" > "$AUTH_TOKEN_FILE"
    chmod 600 "$AUTH_TOKEN_FILE"
    echo "  [OK] auth-token сгенерирован"
fi

# domains.json
DOMAINS_FILE="$CONFIG_DIR/domains.json"
if [ -f "$DOMAINS_FILE" ] && [ -s "$DOMAINS_FILE" ] && [ "$FORCE_MODE" != true ]; then
    echo "  [Пропуск] domains.json уже существует"
else
    BACKEND="https://$CONTABO_IP"
    # Генерируем JSON с помощью node
    node -e "
const domains = '${DOMAINS}'.split(',').map(d => d.trim()).filter(Boolean).map(domain => ({
    domain,
    backend: '${BACKEND}',
    enabled: true,
    addedAt: new Date().toISOString()
}));
const data = { defaultBackend: '${BACKEND}', domains };
require('fs').writeFileSync('${DOMAINS_FILE}', JSON.stringify(data, null, 2));
console.log('  [OK] domains.json создан (' + domains.length + ' доменов)');
"
fi

# ============================================================
# [5/7] Установка ru-proxy-api
# ============================================================
echo "[5/7] Установка ru-proxy-api..."

APP_DIR="/opt/ru-proxy-api"

# Копирование кода
mkdir -p "$APP_DIR"
cp -r "$RU_PROXY_SRC/"* "$APP_DIR/"
echo "  [OK] Код скопирован в $APP_DIR"

# Установка зависимостей
cd "$APP_DIR"
npm ci --omit=dev --silent 2>&1 | tail -1
echo "  [OK] npm зависимости установлены"

# ============================================================
# [6/7] Systemd units
# ============================================================
echo "[6/7] Настройка systemd..."

# Caddy уже имеет systemd unit из apt, но убедимся что конфиг указывает на наш Caddyfile
# Создаём override для Caddy
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/override.conf << EOF
[Service]
ExecStart=
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
EOF
echo "  [OK] Caddy override создан"

# ru-proxy-api systemd unit
cat > /etc/systemd/system/ru-proxy-api.service << EOF
[Unit]
Description=RU Proxy Management API
After=network.target caddy.service
Wants=caddy.service

[Service]
Type=simple
ExecStart=/usr/bin/node $APP_DIR/server.js
Restart=always
RestartSec=5
Environment=PORT=$API_PORT
Environment=DOMAINS_FILE=$DOMAINS_FILE
Environment=CADDYFILE_PATH=/etc/caddy/Caddyfile
Environment=AUTH_TOKEN_FILE=$AUTH_TOKEN_FILE
Environment=CONFIG_FILE=$CONFIG_DIR/config.json
WorkingDirectory=$APP_DIR
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
echo "  [OK] ru-proxy-api.service создан"

# Генерация начального Caddyfile
echo "  Генерация Caddyfile..."
PORT=$API_PORT \
DOMAINS_FILE=$DOMAINS_FILE \
CADDYFILE_PATH=/etc/caddy/Caddyfile \
AUTH_TOKEN_FILE=$AUTH_TOKEN_FILE \
CONFIG_FILE=$CONFIG_DIR/config.json \
node -e "
const server = require('$APP_DIR/server.js');
" 2>/dev/null || true

# Если Caddyfile не создался через API, генерируем вручную
if [ ! -f "/etc/caddy/Caddyfile" ] || [ ! -s "/etc/caddy/Caddyfile" ]; then
    echo "  Генерация Caddyfile вручную..."
    BACKEND="https://$CONTABO_IP"
    node -e "
const fs = require('fs');
const data = JSON.parse(fs.readFileSync('${DOMAINS_FILE}', 'utf8'));
const lines = ['{', '    admin localhost:2019', '}', ''];
for (const entry of data.domains) {
    if (!entry.enabled) continue;
    const backend = entry.backend || data.defaultBackend;
    if (!backend) continue;
    lines.push(entry.domain + ' {');
    lines.push('    reverse_proxy ' + backend + ' {');
    lines.push('        header_up Host {upstream_hostport}');
    lines.push('        header_up X-Real-IP {remote_host}');
    lines.push('        header_up X-Forwarded-For {remote_host}');
    lines.push('        header_up X-Forwarded-Proto {scheme}');
    if (backend.startsWith('https://')) {
        lines.push('        transport http {');
        lines.push('            tls_server_name ' + entry.domain);
        lines.push('        }');
    }
    lines.push('    }');
    lines.push('}');
    lines.push('');
}
fs.writeFileSync('/etc/caddy/Caddyfile', lines.join('\n'));
console.log('  [OK] Caddyfile создан (' + data.domains.filter(d => d.enabled).length + ' доменов)');
"
fi

# Перезагрузка systemd и запуск
systemctl daemon-reload
systemctl enable caddy ru-proxy-api
systemctl start caddy
sleep 2
systemctl start ru-proxy-api
sleep 2

# Проверка
CADDY_STATUS=$(systemctl is-active caddy 2>/dev/null)
API_STATUS=$(systemctl is-active ru-proxy-api 2>/dev/null)
echo "  Caddy:         $CADDY_STATUS"
echo "  ru-proxy-api:  $API_STATUS"

if [ "$CADDY_STATUS" != "active" ]; then
    echo "  [ПРЕДУПРЕЖДЕНИЕ] Caddy не запустился. Проверьте: journalctl -u caddy -n 20"
fi
if [ "$API_STATUS" != "active" ]; then
    echo "  [ПРЕДУПРЕЖДЕНИЕ] ru-proxy-api не запустился. Проверьте: journalctl -u ru-proxy-api -n 20"
fi

# ============================================================
# [7/7] Firewall
# ============================================================
echo "[7/7] Настройка firewall..."

if command -v ufw &>/dev/null; then
    ufw allow 80/tcp comment "HTTP (ACME challenge)" 2>/dev/null
    ufw allow 443/tcp comment "HTTPS" 2>/dev/null
    ufw allow from "$CONTABO_IP" to any port "$API_PORT" proto tcp comment "RU Proxy API (from Contabo)" 2>/dev/null
    echo "  [OK] Порты 80, 443 открыты; порт $API_PORT открыт для $CONTABO_IP"

    # Включаем ufw если не включён
    if ! ufw status | grep -q "Status: active"; then
        echo "  Включение ufw..."
        ufw --force enable
    fi
else
    echo "  [Пропуск] ufw не установлен"
    echo "  Откройте порты вручную: 80/tcp, 443/tcp, ${API_PORT}/tcp (только для $CONTABO_IP)"
fi

# Healthcheck
echo ""
echo "  Проверка healthcheck..."
sleep 2
HEALTH=$(curl -sf --max-time 5 "http://127.0.0.1:${API_PORT}/api/health" 2>/dev/null)
if [ -n "$HEALTH" ]; then
    echo "  [OK] API отвечает: $HEALTH"
else
    echo "  [ПРЕДУПРЕЖДЕНИЕ] API не отвечает на порту $API_PORT"
fi

# ============================================================
# Итоги
# ============================================================
CRED_DIR="/root/.borisovai-credentials"
mkdir -p "$CRED_DIR"
chmod 700 "$CRED_DIR"

RU_VPS_IP=$(curl -sf --max-time 5 https://ifconfig.me 2>/dev/null || hostname -I | awk '{print $1}')

cat > "$CRED_DIR/ru-proxy" << CRED_EOF
# RU Proxy credentials ($(date '+%Y-%m-%d %H:%M:%S'))
api_url=http://${RU_VPS_IP}:${API_PORT}
api_token=${AUTH_TOKEN}
contabo_ip=${CONTABO_IP}
ru_vps_ip=${RU_VPS_IP}
CRED_EOF
chmod 600 "$CRED_DIR/ru-proxy"

echo ""
echo "=== Установка RU Proxy завершена! ==="
echo ""
echo "  Caddy:            $(caddy version 2>/dev/null || echo 'н/д')"
echo "  Caddyfile:        /etc/caddy/Caddyfile"
echo "  Management API:   http://127.0.0.1:${API_PORT}"
echo "  Домены:           ${DOMAINS}"
echo "  Backend (Contabo): ${CONTABO_IP}"
echo ""
echo "  Секреты:          $CRED_DIR/ru-proxy"
echo ""
echo "  ──────────────────────────────────────────────"
echo "  Для подключения к Management UI на Contabo,"
echo "  добавьте в /etc/install-config.json:"
echo ""
echo "    \"ru_proxy_api_url\": \"http://${RU_VPS_IP}:${API_PORT}\","
echo "    \"ru_proxy_api_token\": \"${AUTH_TOKEN}\""
echo ""
echo "  ──────────────────────────────────────────────"
echo "  После проверки работоспособности:"
echo "  1. Смените A-записи .ru доменов на IP: ${RU_VPS_IP}"
echo "  2. Дождитесь пропагации DNS"
echo "  3. Caddy автоматически получит Let's Encrypt сертификаты"
echo ""
