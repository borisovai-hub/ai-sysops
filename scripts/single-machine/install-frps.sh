#!/bin/bash
# Скрипт установки frp server (self-hosted туннелирование)
# Использование: sudo ./install-frps.sh [--force]
#
# Устанавливает frps на сервер и настраивает:
# - Бинарник /usr/local/bin/frps
# - Конфиг /etc/frp/frps.toml
# - Systemd unit frps.service
# - DNS wildcard записи *.tunnel.<base_domain>
# - Firewall (ufw) для control channel
#
# Параметры:
#   --force  - переустановить даже если уже установлено

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
FRP_VERSION="0.66.0"

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
    if [ -f "/usr/local/bin/frps" ] && is_service_installed "frps.service" 2>/dev/null; then
        echo "  [Пропуск] frps уже установлен"
        if is_service_running "frps.service" 2>/dev/null; then
            echo "  [OK] frps запущен"
        else
            echo "  [Предупреждение] frps установлен, но не запущен"
            echo "  Запуск сервиса..."
            systemctl start frps
        fi
        exit 0
    fi
fi

echo ""
echo "=== Установка frp server (туннелирование) ==="
echo ""

# ============================================================
# [1/6] Скачивание frps с GitHub Releases
# ============================================================
echo "[1/6] Скачивание frps v${FRP_VERSION}..."

ARCH=$(uname -m)
case $ARCH in
    x86_64)  ARCH_NAME="amd64" ;;
    aarch64) ARCH_NAME="arm64" ;;
    armv7l)  ARCH_NAME="arm" ;;
    *)
        echo "  [ОШИБКА] Неподдерживаемая архитектура: $ARCH"
        exit 1
        ;;
esac

NEED_DOWNLOAD=false
if [ "$FORCE_MODE" = true ] || [ ! -f "/usr/local/bin/frps" ]; then
    NEED_DOWNLOAD=true
else
    INSTALLED_VERSION=$(/usr/local/bin/frps --version 2>/dev/null || echo "unknown")
    if [ "$INSTALLED_VERSION" = "$FRP_VERSION" ]; then
        echo "  [Пропуск] frps v${FRP_VERSION} уже установлен"
    else
        echo "  Обновление с v${INSTALLED_VERSION} до v${FRP_VERSION}..."
        NEED_DOWNLOAD=true
    fi
fi

if [ "$NEED_DOWNLOAD" = true ]; then
    TMP_DIR=$(mktemp -d)
    FRP_ARCHIVE="frp_${FRP_VERSION}_linux_${ARCH_NAME}.tar.gz"
    FRP_URL="https://github.com/fatedier/frp/releases/download/v${FRP_VERSION}/${FRP_ARCHIVE}"

    if ! curl -fsSL -o "${TMP_DIR}/${FRP_ARCHIVE}" "$FRP_URL"; then
        echo "  [ОШИБКА] Не удалось скачать ${FRP_URL}"
        rm -rf "$TMP_DIR"
        exit 1
    fi

    tar -xzf "${TMP_DIR}/${FRP_ARCHIVE}" -C "$TMP_DIR"
    cp "${TMP_DIR}/frp_${FRP_VERSION}_linux_${ARCH_NAME}/frps" /usr/local/bin/frps
    chmod +x /usr/local/bin/frps
    rm -rf "$TMP_DIR"
    echo "  [OK] frps v${FRP_VERSION} установлен в /usr/local/bin/frps"
fi

# ============================================================
# [2/6] Чтение/сохранение портов из install-config.json
# ============================================================
echo "[2/6] Настройка портов..."

FRP_CONTROL_PORT=$(get_config_value "frp_control_port")
[ -z "$FRP_CONTROL_PORT" ] && FRP_CONTROL_PORT="17420"
save_config_value "frp_control_port" "$FRP_CONTROL_PORT"

FRP_VHOST_PORT=$(get_config_value "frp_vhost_port")
[ -z "$FRP_VHOST_PORT" ] && FRP_VHOST_PORT="17480"
save_config_value "frp_vhost_port" "$FRP_VHOST_PORT"

FRP_DASHBOARD_PORT=$(get_config_value "frp_dashboard_port")
[ -z "$FRP_DASHBOARD_PORT" ] && FRP_DASHBOARD_PORT="17490"
save_config_value "frp_dashboard_port" "$FRP_DASHBOARD_PORT"

FRP_PREFIX=$(get_config_value "frp_prefix")
[ -z "$FRP_PREFIX" ] && FRP_PREFIX="tunnel"
save_config_value "frp_prefix" "$FRP_PREFIX"

echo "  Control port: ${FRP_CONTROL_PORT}"
echo "  vHost HTTP port: ${FRP_VHOST_PORT}"
echo "  Dashboard port: ${FRP_DASHBOARD_PORT}"
echo "  Prefix: ${FRP_PREFIX}"

# ============================================================
# [3/6] Генерация /etc/frp/frps.toml
# ============================================================
echo "[3/6] Генерация конфигурации /etc/frp/frps.toml..."

mkdir -p /etc/frp
FRP_CONFIG="/etc/frp/frps.toml"

# Auth token — генерируется один раз, сохраняется при переустановке
if [ -f "$FRP_CONFIG" ]; then
    FRP_AUTH_TOKEN=$(grep '^auth.token' "$FRP_CONFIG" | sed 's/.*= *"//;s/"$//')
    FRP_DASH_PASS=$(grep '^webServer.password' "$FRP_CONFIG" | sed 's/.*= *"//;s/"$//')
fi
if [ -z "$FRP_AUTH_TOKEN" ]; then
    FRP_AUTH_TOKEN=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-32)
fi
if [ -z "$FRP_DASH_PASS" ]; then
    FRP_DASH_PASS=$(openssl rand -base64 12 | tr -d "=+/" | cut -c1-16)
fi

# subdomainHost — первый base_domain с prefix
FIRST_BASE=$(get_base_domains | head -1)
if [ -z "$FIRST_BASE" ]; then
    echo "  [ОШИБКА] Базовые домены не настроены (base_domains пуст)"
    exit 1
fi
SUBDOMAIN_HOST="${FRP_PREFIX}.${FIRST_BASE}"

# Backup существующего конфига
if [ -f "$FRP_CONFIG" ]; then
    cp "$FRP_CONFIG" "${FRP_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
fi

cat > "$FRP_CONFIG" << EOF
# frps configuration — self-hosted туннелирование
# Документация: https://gofrp.org/en/docs/

bindPort = ${FRP_CONTROL_PORT}
vhostHTTPPort = ${FRP_VHOST_PORT}
subdomainHost = "${SUBDOMAIN_HOST}"

auth.method = "token"
auth.token = "${FRP_AUTH_TOKEN}"

webServer.addr = "127.0.0.1"
webServer.port = ${FRP_DASHBOARD_PORT}
webServer.user = "admin"
webServer.password = "${FRP_DASH_PASS}"

# Разрешённые порты для TCP туннелей
# 11434-11436 — Ollama (main + second machine tier1/tier23)
# 17500-17599 — резерв для других TCP туннелей
allowPorts = [
  { start = 11434, end = 11436 },
  { start = 17500, end = 17599 }
]
EOF

chmod 600 "$FRP_CONFIG"
echo "  [OK] Конфиг создан: ${FRP_CONFIG}"
echo "  subdomainHost: ${SUBDOMAIN_HOST}"

# ============================================================
# [4/6] Systemd unit frps.service
# ============================================================
echo "[4/6] Настройка systemd..."

SYSTEMD_UNIT="/etc/systemd/system/frps.service"

if [ "$FORCE_MODE" = true ] || [ ! -f "$SYSTEMD_UNIT" ]; then
    # Создание резервной копии если файл существует
    if [ -f "$SYSTEMD_UNIT" ]; then
        cp "$SYSTEMD_UNIT" "${SYSTEMD_UNIT}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    cat > "$SYSTEMD_UNIT" << 'EOF'
[Unit]
Description=frp server (туннелирование)
After=network.target traefik.service

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=always
RestartSec=5
StartLimitBurst=5
StartLimitIntervalSec=60
LimitNOFILE=1048576
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/etc/frp /var/log
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
    echo "  [OK] Создан ${SYSTEMD_UNIT}"
else
    echo "  [Пропуск] Systemd service уже существует"
fi

# Запуск сервиса
systemctl daemon-reload
systemctl enable frps

# Остановка перед запуском если уже запущен
if systemctl is-active --quiet frps 2>/dev/null; then
    echo "  Остановка существующего сервиса..."
    systemctl stop frps
fi

systemctl start frps

sleep 2
if systemctl is-active --quiet frps; then
    echo "  [OK] frps запущен"
else
    echo ""
    echo "Ошибка: frps не запустился"
    echo "Проверьте логи: journalctl -u frps -n 50"
    exit 1
fi

# ============================================================
# [5/6] DNS wildcard записи
# ============================================================
echo "[5/6] Создание DNS записей..."

# Определение IP сервера (аналогично create_dns_records_for_domains из common.sh)
SERVER_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ifconfig.co 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
if [ -z "$SERVER_IP" ]; then
    echo "  [Предупреждение] Не удалось определить IP для DNS записей"
    echo "  Создайте вручную: *.${FRP_PREFIX}.<domain> → A → <server-ip>"
else
    DNS_API="http://127.0.0.1:5353/api/records"

    # Сначала пробуем bulk API (как в common.sh create_dns_records_for_domains)
    RECORDS_JSON=""
    while IFS= read -r base; do
        [ -z "$base" ] && continue
        # Wildcard запись (*.tunnel.domain)
        if [ -n "$RECORDS_JSON" ]; then RECORDS_JSON="${RECORDS_JSON},"; fi
        RECORDS_JSON="${RECORDS_JSON}{\"subdomain\":\"*.${FRP_PREFIX}\",\"domain\":\"${base}\",\"ip\":\"${SERVER_IP}\"}"
        # Точная запись (tunnel.domain)
        RECORDS_JSON="${RECORDS_JSON},{\"subdomain\":\"${FRP_PREFIX}\",\"domain\":\"${base}\",\"ip\":\"${SERVER_IP}\"}"
    done < <(get_base_domains)

    if [ -n "$RECORDS_JSON" ]; then
        if curl -s -X POST -H "Content-Type: application/json" \
            -d "{\"records\":[${RECORDS_JSON}]}" \
            "${DNS_API}/bulk" 2>/dev/null | grep -q '"records"'; then
            echo "  [OK] DNS записи созданы для *.${FRP_PREFIX} (через bulk API)"
        else
            # Fallback: по одной записи (как в common.sh)
            while IFS= read -r base; do
                [ -z "$base" ] && continue
                # Wildcard
                curl -s -X POST -H "Content-Type: application/json" \
                    -d "{\"subdomain\":\"*.${FRP_PREFIX}\",\"domain\":\"${base}\",\"ip\":\"${SERVER_IP}\"}" \
                    "$DNS_API" 2>/dev/null
                echo "  [OK] *.${FRP_PREFIX}.${base} → ${SERVER_IP}"
                # Точная
                curl -s -X POST -H "Content-Type: application/json" \
                    -d "{\"subdomain\":\"${FRP_PREFIX}\",\"domain\":\"${base}\",\"ip\":\"${SERVER_IP}\"}" \
                    "$DNS_API" 2>/dev/null
                echo "  [OK] ${FRP_PREFIX}.${base} → ${SERVER_IP}"
            done < <(get_base_domains)
        fi
    fi
fi

# ============================================================
# [6/6] Firewall
# ============================================================
echo "[6/6] Настройка firewall..."

if command -v ufw &>/dev/null; then
    ufw allow "${FRP_CONTROL_PORT}/tcp" comment "frp control channel" 2>/dev/null
    echo "  [OK] Порт ${FRP_CONTROL_PORT}/tcp открыт (ufw)"
else
    echo "  [Пропуск] ufw не установлен. Откройте порт ${FRP_CONTROL_PORT}/tcp вручную."
fi

# ============================================================
# Итоги
# ============================================================
# Сохранение секретов в файл (не в stdout)
CRED_DIR="/root/.borisovai-credentials"
mkdir -p "$CRED_DIR"
chmod 700 "$CRED_DIR"
cat > "$CRED_DIR/frps" << CRED_EOF
# frps credentials ($(date '+%Y-%m-%d %H:%M:%S'))
auth_token=${FRP_AUTH_TOKEN}
dashboard_login=admin
dashboard_password=${FRP_DASH_PASS}
CRED_EOF
chmod 600 "$CRED_DIR/frps"

echo ""
echo "=== Установка frps завершена! ==="
echo ""
echo "  Бинарник:       /usr/local/bin/frps (v${FRP_VERSION})"
echo "  Конфиг:         /etc/frp/frps.toml"
echo "  Systemd:        systemctl status frps"
echo "  Логи:           journalctl -u frps -f"
echo ""
echo "  Control порт:   ${FRP_CONTROL_PORT} (открыт в firewall)"
echo "  vHost HTTP:     ${FRP_VHOST_PORT} (за Traefik)"
echo "  Dashboard:      http://127.0.0.1:${FRP_DASHBOARD_PORT}"
echo "  subdomainHost:  ${SUBDOMAIN_HOST}"
echo ""
echo "  Секреты сохранены в: $CRED_DIR/frps"
echo "  (auth token, dashboard password)"
echo ""
# Резолвим IP сервера однократно — клиентам НЕ нужно держать hostname,
# при переподключении системный DNS может не ответить (no such host /
# i/o timeout), что увеличивает downtime туннеля с секунд до минут.
SERVER_IP="$(getent hosts "${FIRST_BASE}" | awk 'NR==1 {print $1}')"
if [[ -z "$SERVER_IP" ]]; then
    SERVER_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi

echo "  Для клиента (Windows):"
echo "    1. Скачайте frpc: https://github.com/fatedier/frp/releases (frp_*_windows_amd64.zip)"
echo "    2. Создайте frpc.toml (auth.token — из $CRED_DIR/frps):"
echo "       # IP, не hostname — иначе клиент зависает при DNS-сбое"
echo "       serverAddr = \"${SERVER_IP:-144.91.108.139}\""
echo "       serverPort = ${FRP_CONTROL_PORT}"
echo "       auth.token = \"<см. $CRED_DIR/frps>\""
echo "       loginFailExit = false"
echo "       dnsServer = \"1.1.1.1\""
echo "       [[proxies]]"
echo "       name = \"my-project\""
echo "       type = \"http\""
echo "       localPort = 3000"
echo "       subdomain = \"my-project\""
echo "    3. Запустите: frpc.exe -c frpc.toml"
echo "    4. Откройте: https://my-project.${SUBDOMAIN_HOST}"
echo ""
