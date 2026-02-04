#!/bin/bash
# Скрипт для добавления SSL сертификатов для доменов через Traefik
# Использование: sudo ./add-ssl-domains.sh <domain1> [domain2] [domain3] ...
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

# Проверка установки Traefik
if ! is_service_installed "traefik.service"; then
    echo "Ошибка: Traefik не установлен"
    echo "Сначала запустите: sudo ./install-traefik.sh"
    exit 1
fi

DYNAMIC_DIR="/etc/traefik/dynamic"
mkdir -p "$DYNAMIC_DIR"

# Получение доменов из аргументов
DOMAINS=("$@")

if [ ${#DOMAINS[@]} -eq 0 ]; then
    echo "Использование: $0 <domain1> [domain2] [domain3] ..."
    echo ""
    echo "Пример:"
    echo "  $0 borisovai.ru api.borisovai.ru"
    exit 1
fi

echo "=== Добавление SSL сертификатов для доменов ==="
echo ""
echo "Домены:"
for domain in "${DOMAINS[@]}"; do
    echo "  - $domain"
done
echo ""

# Функция для создания конфигурации Traefik для домена
create_domain_config() {
    local domain="$1"
    local service_name=$(echo "$domain" | sed 's/[^a-zA-Z0-9]/-/g' | tr '[:upper:]' '[:lower:]')
    local config_file="$DYNAMIC_DIR/${service_name}.yml"
    
    # Проверка существования конфигурации
    if [ -f "$config_file" ]; then
        echo "  [Пропуск] Конфигурация для $domain уже существует: $config_file"
        echo "    Для обновления используйте --force или удалите файл"
        return 0
    fi
    
    # Определение порта на основе домена
    local port=80
    if echo "$domain" | grep -q "^api\."; then
        # Backend API обычно на порту 4002
        port=4002
        echo "  [Авто] Определён порт 4002 для API домена"
    elif echo "$domain" | grep -qE "^(www\.)?borisovai\.(ru|tech)$"; then
        # Frontend обычно на порту 4001
        port=4001
        echo "  [Авто] Определён порт 4001 для frontend домена"
    elif echo "$domain" | grep -qE "^(dns|ui)\."; then
        # management-ui (dns, ui) на порту 3000
        port=3000
        echo "  [Авто] Определён порт 3000 для management-ui (dns/ui)"
    else
        # Запрос порта для других доменов
        local port_input=$(prompt_and_save "domain_${service_name}_port" "Введите порт для $domain (по умолчанию 80)" "80")
        if [ -n "$port_input" ]; then
            port="$port_input"
        fi
    fi
    
    # Создание конфигурации
    cat > "$config_file" << EOF
http:
  routers:
    ${service_name}:
      rule: "Host(\`${domain}\`)"
      service: ${service_name}
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

  services:
    ${service_name}:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:${port}"
EOF
    
    echo "  [Создано] Конфигурация для $domain -> http://127.0.0.1:${port}"
    echo "    Файл: $config_file"
}

# Создание конфигураций для всех доменов
echo "Создание конфигураций Traefik..."
for domain in "${DOMAINS[@]}"; do
    create_domain_config "$domain"
done

# Перезагрузка Traefik
echo ""
echo "Перезагрузка Traefik для применения изменений..."
if systemctl is-active --quiet traefik; then
    systemctl reload traefik 2>/dev/null || systemctl restart traefik
    sleep 2
    
    if systemctl is-active --quiet traefik; then
        echo "  [OK] Traefik перезагружен"
    else
        echo "  [ОШИБКА] Traefik не запустился после перезагрузки"
        echo "  Проверьте логи: journalctl -u traefik -n 50"
        exit 1
    fi
else
    echo "  [Предупреждение] Traefik не запущен, запуск..."
    systemctl start traefik
    sleep 2
    
    if systemctl is-active --quiet traefik; then
        echo "  [OK] Traefik запущен"
    else
        echo "  [ОШИБКА] Traefik не запустился"
        echo "  Проверьте логи: journalctl -u traefik -n 50"
        exit 1
    fi
fi

echo ""
echo "=== SSL сертификаты добавлены! ==="
echo ""
echo "Домены будут доступны по HTTPS:"
for domain in "${DOMAINS[@]}"; do
    echo "  - https://${domain}"
done
echo ""
echo "Примечание:"
echo "  - SSL сертификаты будут получены автоматически через Let's Encrypt"
echo "  - Это может занять несколько минут"
echo "  - Убедитесь, что DNS записи настроены правильно"
echo "  - Проверьте логи Traefik для отслеживания получения сертификатов:"
echo "    journalctl -u traefik -f"
echo ""
echo "Проверка статуса сертификатов:"
echo "  - Traefik Dashboard: http://localhost:8080"
echo "  - Логи: journalctl -u traefik | grep -i acme"
echo ""
