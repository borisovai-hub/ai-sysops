#!/bin/bash
# Скрипт обновления конфигурации dnsmasq из записей DNS API
# Использование: sudo ./update-dnsmasq.sh

set -e

RECORDS_FILE="/etc/dns-api/records.json"
DNSMASQ_CONFIG="/etc/dnsmasq.d/local-domains.conf"
DNS_CONFIG_FILE="/etc/dns-api/config.json"

if [ ! -f "$RECORDS_FILE" ]; then
    echo "Ошибка: Файл записей не найден: $RECORDS_FILE"
    exit 1
fi

# Загрузка домена из конфигурации
DOMAIN=""
if [ -f "$DNS_CONFIG_FILE" ]; then
    DOMAIN=$(jq -r '.domain' "$DNS_CONFIG_FILE" 2>/dev/null || echo "")
fi

if [ -z "$DOMAIN" ]; then
    echo "Ошибка: Домен не настроен в $DNS_CONFIG_FILE"
    exit 1
fi

# Создание директории если не существует
mkdir -p "$(dirname "$DNSMASQ_CONFIG")"

# Генерация конфигурации dnsmasq
echo "# Автоматически сгенерировано из $RECORDS_FILE" > "$DNSMASQ_CONFIG"
echo "# Не редактируйте вручную!" >> "$DNSMASQ_CONFIG"
echo "" >> "$DNSMASQ_CONFIG"

# Чтение записей и генерация конфигурации
if command -v jq &> /dev/null; then
    jq -r '.records[] | "address=/\(.full_domain)/\(.ip)"' "$RECORDS_FILE" >> "$DNSMASQ_CONFIG"
else
    # Простой парсинг без jq (если jq не установлен)
    echo "Предупреждение: jq не установлен, используется простой парсинг"
    grep -o '"full_domain":"[^"]*"' "$RECORDS_FILE" | while read -r line; do
        FULL_DOMAIN=$(echo "$line" | cut -d'"' -f4)
        IP=$(grep -A 5 "$line" "$RECORDS_FILE" | grep '"ip"' | cut -d'"' -f4)
        if [ -n "$FULL_DOMAIN" ] && [ -n "$IP" ]; then
            echo "address=/$FULL_DOMAIN/$IP" >> "$DNSMASQ_CONFIG"
        fi
    done
fi

# Перезагрузка dnsmasq если запущен
if systemctl is-active --quiet dnsmasq; then
    systemctl reload dnsmasq
    echo "Конфигурация dnsmasq обновлена и перезагружена"
else
    echo "Конфигурация dnsmasq обновлена (сервис не запущен)"
fi
