#!/bin/bash
# Скрипт настройки DNS API для одной машины
# Использование: sudo ./setup-dns-api.sh [provider] [--force]
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
PROVIDER_INPUT="${1:-}"
FORCE_MODE=false

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
    esac
done

CONFIG_DIR="/etc/dns-api"
CONFIG_FILE="$CONFIG_DIR/config.json"

# Преобразование названия провайдера в число (если передан как название)
# Делаем это ДО проверки существующей конфигурации, чтобы сохранить значение
PROVIDER_CHOICE=""
if [ -n "$PROVIDER_INPUT" ]; then
    # Удаляем пробелы из входного значения
    PROVIDER_INPUT_CLEAN=$(echo "$PROVIDER_INPUT" | tr -d '[:space:]')
    case $PROVIDER_INPUT_CLEAN in
        cloudflare|1)
            PROVIDER_CHOICE="1"
            ;;
        digitalocean|2)
            PROVIDER_CHOICE="2"
            ;;
        local|3)
            PROVIDER_CHOICE="3"
            ;;
        *)
            # Если не распознано, используем как есть (может быть число)
            PROVIDER_CHOICE="$PROVIDER_INPUT_CLEAN"
            ;;
    esac
    if [ -n "$PROVIDER_CHOICE" ]; then
        echo "  Используется провайдер: '$PROVIDER_INPUT' -> '$PROVIDER_CHOICE'"
    fi
fi

# Проверка существующей конфигурации
if [ "$FORCE_MODE" != true ] && is_file_exists "$CONFIG_FILE"; then
    echo "  [Найдена] Существующая конфигурация DNS API: $CONFIG_FILE"
    CURRENT_PROVIDER=$(grep -o '"provider": "[^"]*"' "$CONFIG_FILE" 2>/dev/null | cut -d'"' -f4 || echo "")
    if [ -n "$CURRENT_PROVIDER" ]; then
        echo "  Текущий провайдер: $CURRENT_PROVIDER"
    fi
    read -p "Перезаписать существующую конфигурацию? (y/n): " OVERWRITE
    if [ "$OVERWRITE" != "y" ] && [ "$OVERWRITE" != "Y" ]; then
        echo "  [Пропуск] Конфигурация не изменена"
        exit 0
    fi
    # Создание резервной копии
    cp "$CONFIG_FILE" "${CONFIG_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
    echo "  Резервная копия создана"
    # После подтверждения перезаписи, убеждаемся что PROVIDER_CHOICE установлен
    if [ -z "$PROVIDER_CHOICE" ] && [ -n "$PROVIDER_INPUT" ]; then
        # Повторное преобразование на случай если оно было потеряно
        PROVIDER_INPUT_CLEAN=$(echo "$PROVIDER_INPUT" | tr -d '[:space:]')
        case $PROVIDER_INPUT_CLEAN in
            cloudflare|1) 
                PROVIDER_CHOICE="1"
                ;;
            digitalocean|2) 
                PROVIDER_CHOICE="2"
                ;;
            local|3) 
                PROVIDER_CHOICE="3"
                ;;
            *) 
                PROVIDER_CHOICE="$PROVIDER_INPUT_CLEAN"
                ;;
        esac
        echo "  Восстановлен провайдер: '$PROVIDER_INPUT' -> '$PROVIDER_CHOICE'"
    fi
fi

# Выбор провайдера
if [ -z "$PROVIDER_CHOICE" ]; then
    # Пытаемся загрузить из сохраненной конфигурации
    SAVED_CHOICE=$(get_config_value "dns_provider_choice")
    
    if [ -n "$SAVED_CHOICE" ]; then
        # Удаляем пробелы и переносы строк из сохраненного значения
        PROVIDER_CHOICE=$(echo "$SAVED_CHOICE" | tr -d '[:space:]')
        echo "Используется сохраненный выбор DNS провайдера: '$PROVIDER_CHOICE'"
    else
        echo "Выберите DNS провайдера:"
        echo "1) Cloudflare (рекомендуется для интернета)"
        echo "2) DigitalOcean"
        echo "3) Локальный DNS API (для локальной сети)"
        PROVIDER_CHOICE=$(prompt_choice_and_save "dns_provider_choice" "Ваш выбор (1-3)")
        # Удаляем пробелы и переносы строк из введенного значения
        PROVIDER_CHOICE=$(echo "$PROVIDER_CHOICE" | tr -d '[:space:]')
    fi
fi

# Проверка что PROVIDER_CHOICE установлен
if [ -z "$PROVIDER_CHOICE" ]; then
    echo "Ошибка: Провайдер DNS не выбран"
    echo "  Переданный аргумент: '$PROVIDER_INPUT'"
    echo "  FORCE_MODE: $FORCE_MODE"
    exit 1
fi

echo "  Выбранный провайдер: '$PROVIDER_CHOICE' (длина: ${#PROVIDER_CHOICE})"

# Отладочная информация
if [ -n "$PROVIDER_INPUT" ]; then
    echo "  Отладка: PROVIDER_INPUT='$PROVIDER_INPUT', PROVIDER_CHOICE='$PROVIDER_CHOICE'"
fi

case $PROVIDER_CHOICE in
    1)
        PROVIDER="cloudflare"
        echo ""
        CF_API_TOKEN=$(prompt_and_save "cloudflare_api_token" "Введите Cloudflare API Token" "$(get_config_value "cloudflare_api_token")")
        CF_ZONE_ID=$(prompt_and_save "cloudflare_zone_id" "Введите Zone ID" "$(get_config_value "cloudflare_zone_id")")
        DOMAIN=$(prompt_and_save "dns_domain" "Введите домен (например, example.com)" "$(get_config_value "dns_domain")")
        
        if [ -z "$CF_API_TOKEN" ] || [ -z "$CF_ZONE_ID" ] || [ -z "$DOMAIN" ]; then
            echo "Ошибка: Все поля обязательны"
            exit 1
        fi
        
        mkdir -p "$CONFIG_DIR"
        
        cat > "$CONFIG_FILE" << EOF
{
  "provider": "cloudflare",
  "api_token": "$CF_API_TOKEN",
  "zone_id": "$CF_ZONE_ID",
  "domain": "$DOMAIN"
}
EOF
        chmod 600 "$CONFIG_FILE"
        ;;
    2)
        PROVIDER="digitalocean"
        echo ""
        DO_API_TOKEN=$(prompt_and_save "digitalocean_api_token" "Введите DigitalOcean API Token" "$(get_config_value "digitalocean_api_token")")
        DOMAIN=$(prompt_and_save "dns_domain" "Введите домен (например, example.com)" "$(get_config_value "dns_domain")")
        
        if [ -z "$DO_API_TOKEN" ] || [ -z "$DOMAIN" ]; then
            echo "Ошибка: Все поля обязательны"
            exit 1
        fi
        
        mkdir -p "$CONFIG_DIR"
        
        cat > "$CONFIG_FILE" << EOF
{
  "provider": "digitalocean",
  "api_token": "$DO_API_TOKEN",
  "domain": "$DOMAIN"
}
EOF
        chmod 600 "$CONFIG_FILE"
        ;;
    3)
        PROVIDER="local"
        echo ""
        echo "Настройка локального DNS API..."
        
        mkdir -p "$CONFIG_DIR"
        
        cat > "$CONFIG_FILE" << EOF
{
  "provider": "local",
  "api_url": "http://127.0.0.1:5353"
}
EOF
        chmod 600 "$CONFIG_FILE"
        
        # Создание файла авторизации для локального DNS API
        AUTH_DIR="/etc/dns-api"
        AUTH_FILE="$AUTH_DIR/auth.json"
        mkdir -p "$AUTH_DIR"
        
        if [ ! -f "$AUTH_FILE" ] || [ "$FORCE_MODE" = true ]; then
            # Генерация безопасного случайного пароля
            if command -v openssl &> /dev/null; then
                DEFAULT_PASSWORD=$(openssl rand -base64 18 | tr -d "=+/" | cut -c1-24)
            elif [ -c /dev/urandom ]; then
                DEFAULT_PASSWORD=$(cat /dev/urandom | tr -dc 'a-zA-Z0-9!@#$%^&*' | fold -w 24 | head -n 1)
            else
                DEFAULT_PASSWORD=$(date +%s | sha256sum | base64 | head -c 24)
            fi
            
            DEFAULT_USERNAME="admin"
            
            # Создание резервной копии если файл существует
            if [ -f "$AUTH_FILE" ]; then
                cp "$AUTH_FILE" "${AUTH_FILE}.backup.$(date +%Y%m%d_%H%M%S)"
            fi
            
            # Создание файла авторизации
            cat > "$AUTH_FILE" << AUTH_EOF
{
  "username": "$DEFAULT_USERNAME",
  "password": "$DEFAULT_PASSWORD"
}
AUTH_EOF
            chmod 600 "$AUTH_FILE"
            echo "  Файл авторизации создан: $AUTH_FILE"
            echo ""
            echo "  =========================================="
            echo "  УЧЕТНЫЕ ДАННЫЕ DNS API:"
            echo "  =========================================="
            echo "  Логин: $DEFAULT_USERNAME"
            echo "  Пароль: $DEFAULT_PASSWORD"
            echo "  =========================================="
            echo ""
            echo "  ВАЖНО: Сохраните эти данные!"
            echo "  Файл авторизации: $AUTH_FILE"
        else
            echo "  [Пропуск] Файл авторизации уже существует: $AUTH_FILE"
        fi
        
        # Установка локального DNS API сервера
        # Пробуем несколько возможных путей
        DNS_API_SCRIPT_DIR=""
        POSSIBLE_PATHS=(
            "$(dirname "$SCRIPT_DIR")/dns-api"
            "$SCRIPT_DIR/../dns-api"
            "/root/install/scripts/dns-api"
            "$(dirname "$(dirname "$SCRIPT_DIR")")/scripts/dns-api"
        )
        
        for path in "${POSSIBLE_PATHS[@]}"; do
            if [ -f "$path/install-local-dns-api.sh" ]; then
                DNS_API_SCRIPT_DIR="$path"
                break
            fi
        done
        
        if [ -n "$DNS_API_SCRIPT_DIR" ] && [ -f "$DNS_API_SCRIPT_DIR/install-local-dns-api.sh" ]; then
            echo "  Установка локального DNS API сервера..."
            echo "  Найден скрипт: $DNS_API_SCRIPT_DIR/install-local-dns-api.sh"
            bash "$DNS_API_SCRIPT_DIR/install-local-dns-api.sh"
            if [ -f "$DNS_API_SCRIPT_DIR/update-dnsmasq.sh" ]; then
                cp "$DNS_API_SCRIPT_DIR/update-dnsmasq.sh" /usr/local/bin/update-dnsmasq.sh
                chmod +x /usr/local/bin/update-dnsmasq.sh
                echo "  update-dnsmasq.sh установлен в /usr/local/bin (для обновления dnsmasq при создании записей через API)"
            fi
        else
            echo "  Предупреждение: Скрипт установки локального DNS API не найден"
            echo "  Проверенные пути:"
            for path in "${POSSIBLE_PATHS[@]}"; do
                echo "    - $path/install-local-dns-api.sh"
            done
            echo "  Локальный DNS API будет настроен, но сервер не установлен"
            echo "  Убедитесь, что директория scripts/dns-api/ загружена на сервер"
        fi
        ;;
    *)
        echo "Ошибка: Неверный выбор провайдера: '$PROVIDER_CHOICE'"
        echo "Допустимые значения: 1 (cloudflare), 2 (digitalocean), 3 (local)"
        echo "Или названия: cloudflare, digitalocean, local"
        echo "Переданный аргумент: '$PROVIDER_INPUT'"
        exit 1
        ;;
esac

# Установка зависимостей
echo ""
echo "Установка зависимостей..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y curl jq

# Создание простого скрипта управления DNS
echo ""
echo "Создание скрипта управления DNS..."
cat > /usr/local/bin/manage-dns << 'MANAGE_DNS_EOF'
#!/bin/bash
# Простой скрипт управления DNS через API
CONFIG_FILE="/etc/dns-api/config.json"

if [ ! -f "$CONFIG_FILE" ]; then
    echo "Ошибка: Конфигурация DNS API не найдена в $CONFIG_FILE"
    exit 1
fi

PROVIDER=$(jq -r '.provider' "$CONFIG_FILE")
DOMAIN=$(jq -r '.domain' "$CONFIG_FILE")

case "$1" in
    test)
        if [ "$PROVIDER" = "cloudflare" ]; then
            API_TOKEN=$(jq -r '.api_token' "$CONFIG_FILE")
            ZONE_ID=$(jq -r '.zone_id' "$CONFIG_FILE")
            curl -s -X GET "https://api.cloudflare.com/client/v4/zones/$ZONE_ID" \
                -H "Authorization: Bearer $API_TOKEN" \
                -H "Content-Type: application/json" | jq -r '.success' | grep -q "true" && echo "OK" || echo "FAIL"
        elif [ "$PROVIDER" = "digitalocean" ]; then
            API_TOKEN=$(jq -r '.api_token' "$CONFIG_FILE")
            curl -s -X GET "https://api.digitalocean.com/v2/domains/$DOMAIN" \
                -H "Authorization: Bearer $API_TOKEN" | jq -r '.domain.name' | grep -q "$DOMAIN" && echo "OK" || echo "FAIL"
        fi
        ;;
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
            local)
                API_URL=$(jq -r '.api_url // "http://127.0.0.1:5353"' "$CONFIG_FILE")
                AUTH_FILE="/etc/dns-api/auth.json"
                if [ -f "$AUTH_FILE" ]; then
                    USERNAME=$(jq -r '.username' "$AUTH_FILE")
                    PASSWORD=$(jq -r '.password' "$AUTH_FILE")
                    curl -s -X POST "$API_URL/api/dns/create" \
                        -u "$USERNAME:$PASSWORD" \
                        -H "Content-Type: application/json" \
                        --data "{\"subdomain\":\"$SUBDOMAIN\",\"ip\":\"$IP\"}" > /dev/null
                    echo "DNS запись создана: $SUBDOMAIN.$DOMAIN -> $IP"
                else
                    echo "Ошибка: Файл авторизации не найден: $AUTH_FILE"
                    exit 1
                fi
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
    *)
        echo "Использование: manage-dns {test|create|delete}"
        exit 1
        ;;
esac
MANAGE_DNS_EOF

chmod +x /usr/local/bin/manage-dns

# Тестирование подключения
echo ""
echo "Тестирование подключения к API..."
if manage-dns test | grep -q "OK"; then
    echo ""
    echo "=== Настройка DNS API завершена! ==="
    echo ""
    echo "Использование:"
    echo "  manage-dns create <subdomain> <ip>  - создать DNS запись"
    echo "  manage-dns delete <subdomain>      - удалить DNS запись"
    echo "  manage-dns test                    - проверить подключение"
else
    echo ""
    echo "Предупреждение: Не удалось подключиться к API"
    echo "Проверьте конфигурацию в $CONFIG_DIR/config.json"
    echo ""
    echo "Конфигурация сохранена, но API тест не прошел"
    echo "Проверьте правильность токенов и домена"
fi
