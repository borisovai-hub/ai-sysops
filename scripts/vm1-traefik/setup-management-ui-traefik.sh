#!/bin/bash
# Скрипт настройки Traefik для веб-интерфейса управления
# Использование: sudo ./setup-management-ui-traefik.sh

set -e

if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

echo "=== Настройка Traefik для веб-интерфейса управления ==="
echo ""

read -p "Введите домен для веб-интерфейса (например, manage.example.com): " UI_DOMAIN
if [ -z "$UI_DOMAIN" ]; then
    echo "Ошибка: Домен обязателен"
    exit 1
fi

read -p "Email для Let's Encrypt: " LETSENCRYPT_EMAIL
if [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo "Ошибка: Email обязателен"
    exit 1
fi

DYNAMIC_DIR="/etc/traefik/dynamic"
CONFIG_FILE="$DYNAMIC_DIR/management-ui.yml"

echo ""
echo "Создание конфигурации Traefik для веб-интерфейса..."

cat > "$CONFIG_FILE" << EOF
http:
  routers:
    management-ui:
      rule: "Host(\`${UI_DOMAIN}\`)"
      service: management-ui
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

  services:
    management-ui:
      loadBalancer:
        servers:
          - url: "http://localhost:3000"
EOF

echo "Конфигурация создана: $CONFIG_FILE"

# Создание DNS записи
if [ -f "/usr/local/bin/manage-dns" ]; then
    echo ""
    read -p "Создать DNS запись для $UI_DOMAIN? (y/n): " CREATE_DNS
    if [ "$CREATE_DNS" = "y" ] || [ "$CREATE_DNS" = "Y" ]; then
        EXTERNAL_IP=$(curl -s ifconfig.me || curl -s ipinfo.io/ip)
        SUBDOMAIN=$(echo "$UI_DOMAIN" | cut -d'.' -f1)
        manage-dns create "$SUBDOMAIN" "$EXTERNAL_IP"
    fi
fi

# Перезагрузка Traefik
echo ""
echo "Перезагрузка Traefik..."
systemctl reload traefik

sleep 2
if systemctl is-active --quiet traefik; then
    echo ""
    echo "=== Настройка завершена! ==="
    echo ""
    echo "Веб-интерфейс будет доступен по адресу:"
    echo "  https://${UI_DOMAIN}"
    echo ""
    echo "Примечание: SSL сертификат будет получен автоматически в течение нескольких минут"
else
    echo ""
    echo "Ошибка: Traefik не запустился после перезагрузки"
    echo "Проверьте логи: journalctl -u traefik -n 50"
    exit 1
fi
