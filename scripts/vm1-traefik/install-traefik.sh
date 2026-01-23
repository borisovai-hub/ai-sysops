#!/bin/bash
# Скрипт установки Traefik на VM 1
# Использование: sudo ./install-traefik.sh

set -e

echo "=== Установка Traefik ==="
echo ""

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Запрос IP адреса GitLab VM
echo "Введите данные для настройки:"
read -p "Внутренний IP адрес GitLab VM (VM 2): " GITLAB_IP
if [ -z "$GITLAB_IP" ]; then
    echo "Ошибка: IP адрес GitLab VM обязателен"
    exit 1
fi

read -p "Домен для GitLab (например, gitlab.example.com): " GITLAB_DOMAIN
if [ -z "$GITLAB_DOMAIN" ]; then
    echo "Ошибка: Домен GitLab обязателен"
    exit 1
fi

read -p "Email для Let's Encrypt: " LETSENCRYPT_EMAIL
if [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo "Ошибка: Email обязателен для Let's Encrypt"
    exit 1
fi

# Определение IP адресов
EXTERNAL_IP=$(curl -s ifconfig.me || curl -s ipinfo.io/ip)
INTERNAL_IP=$(hostname -I | awk '{print $1}')

echo ""
echo "Конфигурация:"
echo "  Внешний IP: $EXTERNAL_IP"
echo "  Внутренний IP: $INTERNAL_IP"
echo "  GitLab IP: $GITLAB_IP"
echo "  GitLab домен: $GITLAB_DOMAIN"
echo "  Let's Encrypt email: $LETSENCRYPT_EMAIL"
echo ""
read -p "Продолжить установку? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    exit 1
fi

# Обновление системы
echo ""
echo "[1/6] Обновление системы..."
export DEBIAN_FRONTEND=noninteractive
apt update
apt upgrade -y

# Установка зависимостей
echo ""
echo "[2/6] Установка зависимостей..."
apt install -y curl wget unzip

# Настройка firewall
echo ""
echo "[3/6] Настройка firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp
    ufw allow 80/tcp
    ufw allow 443/tcp
    ufw --force enable
    echo "Firewall настроен: порты 80 и 443 открыты"
else
    echo "UFW не установлен, настройте firewall вручную"
fi

# Скачивание Traefik
echo ""
echo "[4/6] Скачивание Traefik..."
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

wget -q "https://github.com/traefik/traefik/releases/download/v${TRAEFIK_VERSION}/traefik_v${TRAEFIK_VERSION}_linux_${ARCH}.tar.gz"
tar -xzf "traefik_v${TRAEFIK_VERSION}_linux_${ARCH}.tar.gz"
rm "traefik_v${TRAEFIK_VERSION}_linux_${ARCH}.tar.gz"
chmod +x traefik

echo "Traefik версии $TRAEFIK_VERSION установлен"

# Создание директорий для конфигурации
echo ""
echo "[5/6] Создание структуры директорий..."
CONFIG_DIR="/etc/traefik"
DYNAMIC_DIR="$CONFIG_DIR/dynamic"
mkdir -p "$DYNAMIC_DIR"
mkdir -p "/var/log/traefik"
mkdir -p "/var/lib/traefik/acme"

# Создание systemd service
echo ""
echo "[6/6] Создание systemd service..."
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

# Создание базовой конфигурации Traefik
cat > "$CONFIG_DIR/traefik.yml" << EOF
global:
  checkNewVersion: true
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

# Создание конфигурации для GitLab
cat > "$DYNAMIC_DIR/gitlab.yml" << EOF
http:
  routers:
    gitlab:
      rule: "Host(\`$GITLAB_DOMAIN\`)"
      service: gitlab
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

  services:
    gitlab:
      loadBalancer:
        servers:
          - url: "http://$GITLAB_IP:80"
EOF

# Установка прав доступа
chmod 600 /var/lib/traefik/acme/acme.json 2>/dev/null || touch /var/lib/traefik/acme/acme.json && chmod 600 /var/lib/traefik/acme/acme.json

# Перезагрузка systemd и запуск Traefik
systemctl daemon-reload
systemctl enable traefik
systemctl start traefik

# Проверка статуса
sleep 3
if systemctl is-active --quiet traefik; then
    echo ""
    echo "=== Установка Traefik завершена! ==="
    echo ""
    echo "Traefik запущен и работает"
    echo "  Dashboard: http://$INTERNAL_IP:8080"
    echo "  GitLab будет доступен по: https://$GITLAB_DOMAIN"
    echo ""
    echo "Проверка статуса: systemctl status traefik"
    echo "Просмотр логов: journalctl -u traefik -f"
    echo ""
else
    echo ""
    echo "Ошибка: Traefik не запустился"
    echo "Проверьте логи: journalctl -u traefik -n 50"
    exit 1
fi
