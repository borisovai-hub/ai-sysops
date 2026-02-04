#!/bin/bash
# Скрипт установки Traefik на одну машину
# Использование: sudo ./install-traefik.sh <letsencrypt-email> [--force]
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение.

# Определение директории скрипта (абсолютный путь)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Загрузка общих функций
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Предупреждение: common.sh не найден, некоторые функции могут быть недоступны"
fi

set +e

if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Параметры
LETSENCRYPT_EMAIL="${1:-}"
FORCE_MODE=false

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
    esac
done

if [ -z "$LETSENCRYPT_EMAIL" ]; then
    # Пытаемся загрузить из сохраненной конфигурации
    LETSENCRYPT_EMAIL=$(get_config_value "letsencrypt_email")
    
    if [ -z "$LETSENCRYPT_EMAIL" ]; then
        LETSENCRYPT_EMAIL=$(prompt_and_save "letsencrypt_email" "Email для Let's Encrypt")
        if [ -z "$LETSENCRYPT_EMAIL" ]; then
            echo "Ошибка: Email обязателен"
            exit 1
        fi
    else
        echo "Используется сохраненный email: $LETSENCRYPT_EMAIL"
    fi
fi

echo "=== Установка Traefik ==="
echo ""

# Проверка существования Traefik
TRAEFIK_DIR="/opt/traefik"
TRAEFIK_BIN="$TRAEFIK_DIR/traefik"
TRAEFIK_SERVICE="traefik.service"

if [ "$FORCE_MODE" != true ]; then
    if is_service_installed "$TRAEFIK_SERVICE" && is_file_exists "$TRAEFIK_BIN"; then
        echo "  [Пропуск] Traefik уже установлен"
        if is_service_running "$TRAEFIK_SERVICE"; then
            echo "  [OK] Traefik запущен"
        else
            echo "  [Предупреждение] Traefik установлен, но не запущен"
            echo "  Запуск сервиса..."
            systemctl start traefik
        fi
        exit 0
    fi
fi

# Определение IP адресов
EXTERNAL_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ipinfo.io/ip 2>/dev/null || echo "не определен")

echo "Конфигурация:"
echo "  Внешний IP: $EXTERNAL_IP"
echo "  Let's Encrypt email: $LETSENCRYPT_EMAIL"
if [ "$FORCE_MODE" = true ]; then
    echo "  Режим: Принудительная переустановка"
fi
echo ""

# Установка wget если не установлен
if ! command -v wget &> /dev/null; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get install -y wget
fi

# Остановка существующего Traefik если переустанавливаем
if [ "$FORCE_MODE" = true ] && is_service_installed "$TRAEFIK_SERVICE"; then
    echo "[0/5] Остановка существующего Traefik..."
    systemctl stop traefik 2>/dev/null || true
    systemctl disable traefik 2>/dev/null || true
fi

# Скачивание Traefik
echo "[1/5] Скачивание Traefik..."
TRAEFIK_VERSION=$(curl -s https://api.github.com/repos/traefik/traefik/releases/latest | grep tag_name | cut -d '"' -f 4 | sed 's/v//')
TRAEFIK_DIR="/opt/traefik"
TRAEFIK_BIN="$TRAEFIK_DIR/traefik"

mkdir -p "$TRAEFIK_DIR"
cd "$TRAEFIK_DIR"

# Определение архитектуры
ARCH=$(uname -m)
case $ARCH in
    x86_64) ARCH="amd64" ;;
    aarch64) ARCH="arm64" ;;
    *) echo "Неподдерживаемая архитектура: $ARCH"; exit 1 ;;
esac

TRAEFIK_TAR="traefik_v${TRAEFIK_VERSION}_linux_${ARCH}.tar.gz"
if [ ! -f "$TRAEFIK_TAR" ] || [ "$FORCE_MODE" = true ]; then
    wget -q "https://github.com/traefik/traefik/releases/download/v${TRAEFIK_VERSION}/${TRAEFIK_TAR}"
    if [ $? -ne 0 ]; then
        echo "Ошибка: Не удалось скачать Traefik"
        exit 1
    fi
fi

if [ -f "$TRAEFIK_TAR" ]; then
    tar -xzf "$TRAEFIK_TAR"
    rm "$TRAEFIK_TAR"
    chmod +x traefik
    echo "Traefik версии $TRAEFIK_VERSION установлен"
else
    echo "Ошибка: Файл Traefik не найден"
    exit 1
fi

# Создание директорий
echo ""
echo "[2/5] Создание структуры директорий..."
CONFIG_DIR="/etc/traefik"
DYNAMIC_DIR="$CONFIG_DIR/dynamic"
mkdir -p "$DYNAMIC_DIR"
mkdir -p "/var/log/traefik"
mkdir -p "/var/lib/traefik/acme"

# Создание systemd service
echo ""
echo "[3/5] Создание systemd service..."
CONFIG_DIR="/etc/traefik"
if [ "$FORCE_MODE" = true ] || [ ! -f "/etc/systemd/system/traefik.service" ]; then
    cat > /etc/systemd/system/traefik.service << EOF
[Unit]
Description=Traefik
Documentation=https://traefik.io
After=network.target

[Service]
Type=simple
User=root
ExecStart=$TRAEFIK_BIN --configfile=$CONFIG_DIR/traefik.yml
Restart=on-failure
RestartSec=5
LimitNOFILE=65536

[Install]
WantedBy=multi-user.target
EOF
else
    echo "  [Пропуск] Systemd service уже существует"
fi

# Создание базовой конфигурации Traefik
echo ""
echo "[4/5] Создание конфигурации Traefik..."
CONFIG_DIR="/etc/traefik"
if [ "$FORCE_MODE" = true ] || [ ! -f "$CONFIG_DIR/traefik.yml" ]; then
    # Создание резервной копии если файл существует
    if [ -f "$CONFIG_DIR/traefik.yml" ]; then
        cp "$CONFIG_DIR/traefik.yml" "$CONFIG_DIR/traefik.yml.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    cat > "$CONFIG_DIR/traefik.yml" << EOF
# Логи INF про "Stats collection is disabled" и "data-collection" — нормальны, телеметрия отключена
global:
  checkNewVersion: false
  sendAnonymousUsage: false

api:
  dashboard: true
  insecure: true
  debug: false

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true
  websecure:
    address: ":443"

providers:
  file:
    directory: $DYNAMIC_DIR
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: $LETSENCRYPT_EMAIL
      storage: /var/lib/traefik/acme/acme.json
      httpChallenge:
        entryPoint: web

log:
  level: INFO
  filePath: /var/log/traefik/traefik.log

accessLog:
  filePath: /var/log/traefik/access.log
EOF
else
    echo "  [Пропуск] Конфигурация уже существует (используйте --force для перезаписи)"
fi

# Установка прав доступа
mkdir -p /var/lib/traefik/acme
if [ ! -f /var/lib/traefik/acme/acme.json ]; then
    touch /var/lib/traefik/acme/acme.json
    chmod 600 /var/lib/traefik/acme/acme.json
fi

# Запуск Traefik
echo ""
echo "[5/5] Запуск Traefik..."
systemctl daemon-reload
systemctl enable traefik

# Проверка конфигурации перед запуском
if [ ! -f "$CONFIG_DIR/traefik.yml" ]; then
    echo "Ошибка: Конфигурационный файл не найден: $CONFIG_DIR/traefik.yml"
    exit 1
fi

# Остановка перед запуском если уже запущен
if systemctl is-active --quiet traefik 2>/dev/null; then
    echo "  Остановка существующего Traefik..."
    systemctl stop traefik
fi

systemctl start traefik

sleep 5
if systemctl is-active --quiet traefik; then
    echo ""
    echo "✓ Traefik успешно установлен и запущен"
    echo "  Dashboard: http://localhost:8080"
    exit 0
else
    echo ""
    echo "Ошибка: Traefik не запустился"
    echo "Проверьте логи: journalctl -u traefik -n 50"
    echo "Проверьте конфигурацию: $CONFIG_DIR/traefik.yml"
    exit 1
fi
