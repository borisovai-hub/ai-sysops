#!/bin/bash
# Скрипт настройки DNS API для управления поддоменами
# Использование: sudo ./setup-dns-api.sh

set -e

echo "=== Настройка DNS API ==="
echo ""

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Выбор провайдера
echo "Выберите DNS провайдера:"
echo "1) Cloudflare (рекомендуется для интернета)"
echo "2) DigitalOcean"
echo "3) Локальный DNS API (для локальной сети)"
echo "4) Другое (настройка вручную)"
read -p "Ваш выбор (1-4): " PROVIDER_CHOICE

case $PROVIDER_CHOICE in
    1)
        PROVIDER="cloudflare"
        echo ""
        read -p "Введите Cloudflare API Token: " CF_API_TOKEN
        read -p "Введите Zone ID: " CF_ZONE_ID
        read -p "Введите домен (например, example.com): " DOMAIN
        
        if [ -z "$CF_API_TOKEN" ] || [ -z "$CF_ZONE_ID" ] || [ -z "$DOMAIN" ]; then
            echo "Ошибка: Все поля обязательны"
            exit 1
        fi
        
        # Создание конфигурации
        CONFIG_DIR="/etc/dns-api"
        mkdir -p "$CONFIG_DIR"
        
        cat > "$CONFIG_DIR/config.json" << EOF
{
  "provider": "cloudflare",
  "api_token": "$CF_API_TOKEN",
  "zone_id": "$CF_ZONE_ID",
  "domain": "$DOMAIN"
}
EOF
        chmod 600 "$CONFIG_DIR/config.json"
        ;;
    2)
        PROVIDER="digitalocean"
        echo ""
        read -p "Введите DigitalOcean API Token: " DO_API_TOKEN
        read -p "Введите домен (например, example.com): " DOMAIN
        
        if [ -z "$DO_API_TOKEN" ] || [ -z "$DOMAIN" ]; then
            echo "Ошибка: Все поля обязательны"
            exit 1
        fi
        
        CONFIG_DIR="/etc/dns-api"
        mkdir -p "$CONFIG_DIR"
        
        cat > "$CONFIG_DIR/config.json" << EOF
{
  "provider": "digitalocean",
  "api_token": "$DO_API_TOKEN",
  "domain": "$DOMAIN"
}
EOF
        chmod 600 "$CONFIG_DIR/config.json"
        ;;
    3)
        echo ""
        echo "Настройте DNS API вручную в /etc/dns-api/config.json"
        CONFIG_DIR="/etc/dns-api"
        mkdir -p "$CONFIG_DIR"
        exit 0
        ;;
    *)
        echo "Неверный выбор"
        exit 1
        ;;
esac

# Установка зависимостей для скрипта управления DNS
echo ""
echo "Установка зависимостей..."
apt update
apt install -y curl jq

# Создание скрипта управления DNS
echo ""
echo "Создание скрипта управления DNS..."
cat > /usr/local/bin/manage-dns << 'SCRIPT_EOF'
#!/bin/bash
# Скрипт управления DNS записями через API

CONFIG_FILE="/etc/dns-api/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Ошибка: Конфигурация не найдена: $CONFIG_FILE"
    exit 1
fi

PROVIDER=$(jq -r '.provider' "$CONFIG_FILE")
DOMAIN=$(jq -r '.domain' "$CONFIG_FILE")

case "$1" in
    create)
        SUBDOMAIN="$2"
        IP="$3"
        
        if [ -z "$SUBDOMAIN" ] || [ -z "$IP" ]; then
            echo "Использование: manage-dns create <subdomain> <ip>"
            exit 1
        fi
        
        case "$PROVIDER" in
            cloudflare)
                API_TOKEN=$(jq -r '.api_token' "$CONFIG_FILE")
                ZONE_ID=$(jq -r '.zone_id' "$CONFIG_FILE")
                
                # Проверка существования записи
                RECORD_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=A&name=$SUBDOMAIN.$DOMAIN" \
                    -H "Authorization: Bearer $API_TOKEN" \
                    -H "Content-Type: application/json" | jq -r '.result[0].id // empty')
                
                if [ -n "$RECORD_ID" ]; then
                    # Обновление существующей записи
                    curl -s -X PUT "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
                        -H "Authorization: Bearer $API_TOKEN" \
                        -H "Content-Type: application/json" \
                        --data "{\"type\":\"A\",\"name\":\"$SUBDOMAIN\",\"content\":\"$IP\",\"ttl\":300}" > /dev/null
                    echo "DNS запись обновлена: $SUBDOMAIN.$DOMAIN -> $IP"
                else
                    # Создание новой записи
                    curl -s -X POST "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records" \
                        -H "Authorization: Bearer $API_TOKEN" \
                        -H "Content-Type: application/json" \
                        --data "{\"type\":\"A\",\"name\":\"$SUBDOMAIN\",\"content\":\"$IP\",\"ttl\":300}" > /dev/null
                    echo "DNS запись создана: $SUBDOMAIN.$DOMAIN -> $IP"
                fi
                ;;
            digitalocean)
                API_TOKEN=$(jq -r '.api_token' "$CONFIG_FILE")
                
                # Создание/обновление записи
                curl -s -X POST "https://api.digitalocean.com/v2/domains/$DOMAIN/records" \
                    -H "Authorization: Bearer $API_TOKEN" \
                    -H "Content-Type: application/json" \
                    --data "{\"type\":\"A\",\"name\":\"$SUBDOMAIN\",\"data\":\"$IP\",\"ttl\":300}" > /dev/null
                echo "DNS запись создана: $SUBDOMAIN.$DOMAIN -> $IP"
                ;;
            *)
                echo "Неподдерживаемый провайдер: $PROVIDER"
                exit 1
                ;;
        esac
        ;;
    delete)
        SUBDOMAIN="$2"
        if [ -z "$SUBDOMAIN" ]; then
            echo "Использование: manage-dns delete <subdomain>"
            exit 1
        fi
        
        case "$PROVIDER" in
            local)
                # Использование локального DNS API
                RESPONSE=$(curl -s -X DELETE "http://127.0.0.1:5353/api/records/subdomain/$SUBDOMAIN")
                
                if echo "$RESPONSE" | jq -e '.message' > /dev/null 2>&1; then
                    echo "DNS запись удалена: $SUBDOMAIN.$DOMAIN"
                else
                    echo "Ошибка удаления DNS записи"
                    echo "$RESPONSE" | jq -r '.error // "Неизвестная ошибка"'
                    exit 1
                fi
                ;;
            cloudflare)
                API_TOKEN=$(jq -r '.api_token' "$CONFIG_FILE")
                ZONE_ID=$(jq -r '.zone_id' "$CONFIG_FILE")
                
                RECORD_ID=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records?type=A&name=$SUBDOMAIN.$DOMAIN" \
                    -H "Authorization: Bearer $API_TOKEN" \
                    -H "Content-Type: application/json" | jq -r '.result[0].id // empty')
                
                if [ -n "$RECORD_ID" ]; then
                    curl -s -X DELETE "https://api.cloudflare.com/client/v4/zones/$ZONE_ID/dns_records/$RECORD_ID" \
                        -H "Authorization: Bearer $API_TOKEN" > /dev/null
                    echo "DNS запись удалена: $SUBDOMAIN.$DOMAIN"
                else
                    echo "Запись не найдена"
                fi
                ;;
            *)
                echo "Удаление для $PROVIDER не реализовано"
                exit 1
                ;;
        esac
        ;;
    test)
        echo "Тестирование подключения к API..."
        case "$PROVIDER" in
            local)
                RESPONSE=$(curl -s -X GET "http://127.0.0.1:5353/api/health")
                
                if echo "$RESPONSE" | jq -e '.status' > /dev/null 2>&1; then
                    echo "Успешное подключение к локальному DNS API"
                else
                    echo "Ошибка подключения к локальному DNS API"
                    echo "Убедитесь, что сервис local-dns-api запущен: systemctl status local-dns-api"
                    exit 1
                fi
                ;;
            cloudflare)
                API_TOKEN=$(jq -r '.api_token' "$CONFIG_FILE")
                ZONE_ID=$(jq -r '.zone_id' "$CONFIG_FILE")
                
                RESPONSE=$(curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID" \
                    -H "Authorization: Bearer $API_TOKEN" \
                    -H "Content-Type: application/json")
                
                if echo "$RESPONSE" | jq -e '.success' > /dev/null 2>&1; then
                    echo "Успешное подключение к Cloudflare API"
                else
                    echo "Ошибка подключения к API"
                    echo "$RESPONSE" | jq '.'
                    exit 1
                fi
                ;;
            digitalocean)
                API_TOKEN=$(jq -r '.api_token' "$CONFIG_FILE")
                
                RESPONSE=$(curl -s -X GET "https://api.digitalocean.com/v2/domains" \
                    -H "Authorization: Bearer $API_TOKEN")
                
                if echo "$RESPONSE" | jq -e '.domains' > /dev/null 2>&1; then
                    echo "Успешное подключение к DigitalOcean API"
                else
                    echo "Ошибка подключения к API"
                    exit 1
                fi
                ;;
        esac
        ;;
    *)
        echo "Использование: manage-dns {create|delete|test} [параметры]"
        echo "  create <subdomain> <ip> - создать/обновить A-запись"
        echo "  delete <subdomain>      - удалить A-запись"
        echo "  test                     - проверить подключение к API"
        exit 1
        ;;
esac
SCRIPT_EOF

chmod +x /usr/local/bin/manage-dns

# Тестирование подключения
echo ""
echo "Тестирование подключения к API..."
if manage-dns test; then
    echo ""
    echo "=== Настройка DNS API завершена! ==="
    echo ""
    echo "Использование:"
    echo "  manage-dns create <subdomain> <ip>  - создать DNS запись"
    echo "  manage-dns delete <subdomain>      - удалить DNS запись"
    echo "  manage-dns test                    - проверить подключение"
    echo ""
else
    echo ""
    echo "Ошибка при тестировании API. Проверьте конфигурацию в $CONFIG_DIR/config.json"
    exit 1
fi
