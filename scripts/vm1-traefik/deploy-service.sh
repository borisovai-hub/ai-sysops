#!/bin/bash
# Скрипт развертывания нового сервиса
# Использование: sudo ./deploy-service.sh <service-name> <internal-ip> <port> [domain]

set -e

if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

if [ $# -lt 3 ]; then
    echo "Использование: $0 <service-name> <internal-ip> <port> [domain]"
    echo "  service-name - имя сервиса (например, app1)"
    echo "  internal-ip  - внутренний IP адрес сервиса"
    echo "  port         - порт сервиса"
    echo "  domain       - домен (опционально, будет создан поддомен)"
    exit 1
fi

SERVICE_NAME="$1"
INTERNAL_IP="$2"
PORT="$3"
DOMAIN="${4:-}"

# Загрузка конфигурации DNS
CONFIG_FILE="/etc/dns-api/config.json"
if [ ! -f "$CONFIG_FILE" ]; then
    echo "Ошибка: DNS API не настроен. Запустите setup-dns-api.sh"
    exit 1
fi

BASE_DOMAIN=$(jq -r '.domain' "$CONFIG_FILE")
EXTERNAL_IP=$(curl -s ifconfig.me || curl -s ipinfo.io/ip)

# Определение домена
if [ -z "$DOMAIN" ]; then
    DOMAIN="${SERVICE_NAME}.${BASE_DOMAIN}"
else
    # Проверка, что домен содержит базовый домен
    if [[ ! "$DOMAIN" == *"$BASE_DOMAIN" ]]; then
        DOMAIN="${DOMAIN}.${BASE_DOMAIN}"
    fi
fi

echo "=== Развертывание сервиса ==="
echo ""
echo "Имя сервиса: $SERVICE_NAME"
echo "Внутренний IP: $INTERNAL_IP"
echo "Порт: $PORT"
echo "Домен: $DOMAIN"
echo "Внешний IP: $EXTERNAL_IP"
echo ""
read -p "Продолжить? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    exit 1
fi

# Создание DNS записи
echo ""
echo "[1/4] Создание DNS записи..."
if manage-dns create "$SERVICE_NAME" "$EXTERNAL_IP"; then
    echo "DNS запись создана"
else
    echo "Ошибка при создании DNS записи"
    exit 1
fi

# Создание конфигурации Traefik
echo ""
echo "[2/4] Создание конфигурации Traefik..."
DYNAMIC_DIR="/etc/traefik/dynamic"
SERVICE_CONFIG="$DYNAMIC_DIR/${SERVICE_NAME}.yml"

cat > "$SERVICE_CONFIG" << EOF
http:
  routers:
    ${SERVICE_NAME}:
      rule: "Host(\`${DOMAIN}\`)"
      service: ${SERVICE_NAME}
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

  services:
    ${SERVICE_NAME}:
      loadBalancer:
        servers:
          - url: "http://${INTERNAL_IP}:${PORT}"
EOF

echo "Конфигурация Traefik создана: $SERVICE_CONFIG"

# Перезагрузка Traefik
echo ""
echo "[3/4] Перезагрузка Traefik..."
systemctl reload traefik
sleep 2

if systemctl is-active --quiet traefik; then
    echo "Traefik перезагружен успешно"
else
    echo "Ошибка: Traefik не запустился после перезагрузки"
    echo "Проверьте логи: journalctl -u traefik -n 50"
    exit 1
fi

# Проверка доступности
echo ""
echo "[4/4] Проверка доступности..."
sleep 5

HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://${INTERNAL_IP}:${PORT}" || echo "000")

if [ "$HTTP_CODE" != "000" ]; then
    echo "Сервис доступен по внутреннему IP (HTTP код: $HTTP_CODE)"
else
    echo "Предупреждение: не удалось проверить доступность по внутреннему IP"
fi

echo ""
echo "=== Развертывание завершено! ==="
echo ""
echo "Сервис будет доступен по адресу:"
echo "  https://${DOMAIN}"
echo ""
echo "Примечание: SSL сертификат будет получен автоматически в течение нескольких минут"
echo ""
echo "Проверка статуса:"
echo "  systemctl status traefik"
echo "  journalctl -u traefik -f"
echo ""
