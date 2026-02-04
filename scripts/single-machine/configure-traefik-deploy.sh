#!/bin/bash
# Скрипт конфигурации Traefik для frontend и backend деплоя
# Использование: sudo ./configure-traefik-deploy.sh <frontend-domain> <backend-domain> [--force]
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
FORCE_MODE=false
for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
    esac
done

FRONTEND_DOMAIN="${1:-}"
BACKEND_DOMAIN="${2:-}"

# Получение доменов из конфигурации или запрос
if [ -z "$FRONTEND_DOMAIN" ]; then
    FRONTEND_DOMAIN=$(get_config_value "frontend_domain")
    if [ -z "$FRONTEND_DOMAIN" ]; then
        FRONTEND_DOMAIN=$(prompt_and_save "frontend_domain" "Введите домен для frontend (например, borisovai.ru)" "borisovai.ru")
    fi
fi

if [ -z "$BACKEND_DOMAIN" ]; then
    BACKEND_DOMAIN=$(get_config_value "backend_domain")
    if [ -z "$BACKEND_DOMAIN" ]; then
        BACKEND_DOMAIN=$(prompt_and_save "backend_domain" "Введите домен для backend API (например, api.borisovai.ru)" "api.borisovai.ru")
    fi
fi

if [ -z "$FRONTEND_DOMAIN" ] || [ -z "$BACKEND_DOMAIN" ]; then
    echo "Ошибка: Домены обязательны"
    echo "Использование: $0 <frontend-domain> <backend-domain> [--force]"
    exit 1
fi

echo "=== Конфигурация Traefik для деплоя ==="
echo ""
echo "Frontend домен: $FRONTEND_DOMAIN"
echo "Backend домен: $BACKEND_DOMAIN"
echo ""

# Проверка установки Traefik
if ! is_service_installed "traefik.service"; then
    echo "Ошибка: Traefik не установлен"
    echo "Сначала запустите: sudo ./install-traefik.sh"
    exit 1
fi

DYNAMIC_DIR="/etc/traefik/dynamic"
mkdir -p "$DYNAMIC_DIR"

DEPLOY_PATH="/var/www/borisovai-site"

# Определение портов для frontend и backend (можно настроить через PM2)
# По умолчанию используем порты 4001 и 4002
FRONTEND_PORT=4001
BACKEND_PORT=4002

# Проверка PM2 процессов для определения портов
if command -v pm2 &> /dev/null; then
    FRONTEND_PM2=$(pm2 list | grep -i frontend | head -1)
    BACKEND_PM2=$(pm2 list | grep -i backend | head -1)
    
    # Попытка определить порты из PM2 (если настроены)
    if [ -n "$FRONTEND_PM2" ]; then
        # PM2 может хранить порт в ecosystem файле или переменных окружения
        # Здесь используем значения по умолчанию, можно расширить логику
        echo "  [Информация] Frontend процесс найден в PM2"
    fi
    if [ -n "$BACKEND_PM2" ]; then
        echo "  [Информация] Backend процесс найден в PM2"
    fi
fi

# Функция для создания/обновления конфигурации
# Traefik принимает HTTPS (websecure entryPoint с TLS), но проксирует на HTTP backend
update_deploy_config() {
    local config_file="$1"
    local service_name="$2"
    local domain="$3"
    local backend_url="$4"
    
    if [ "$FORCE_MODE" = true ] || [ ! -f "$config_file" ]; then
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
          - url: "${backend_url}"
EOF
        echo "  [Создано] Конфигурация для $service_name ($domain)"
    else
        # Обновление существующей конфигурации
        cp "$config_file" "${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
        
        CURRENT_DOMAIN=$(grep -o "Host(\`[^\`]*\`)" "$config_file" | sed "s/Host(\`\(.*\)\`)/\1/" | head -1)
        CURRENT_URL=$(grep -o "url: \"[^\"]*\"" "$config_file" | sed 's/url: "\(.*\)"/\1/' | head -1)
        
        if [ "$CURRENT_DOMAIN" != "$domain" ] || [ "$CURRENT_URL" != "$backend_url" ]; then
            # Пересоздаём конфигурацию если изменился домен или URL
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
          - url: "${backend_url}"
EOF
            echo "  [Обновлено] Конфигурация для $service_name"
            if [ "$CURRENT_DOMAIN" != "$domain" ]; then
                echo "    Домен: $CURRENT_DOMAIN -> $domain"
            fi
            if [ "$CURRENT_URL" != "$backend_url" ]; then
                echo "    URL: $CURRENT_URL -> $backend_url"
            fi
        else
            echo "  [Пропуск] Конфигурация для $service_name уже актуальна"
        fi
    fi
}

# Конфигурация для frontend
echo "[1/3] Создание/обновление конфигурации для frontend..."
update_deploy_config "$DYNAMIC_DIR/borisovai-frontend.yml" "borisovai-frontend" "$FRONTEND_DOMAIN" "http://127.0.0.1:${FRONTEND_PORT}"

# Конфигурация для backend
echo "[2/3] Создание/обновление конфигурации для backend..."
update_deploy_config "$DYNAMIC_DIR/borisovai-backend.yml" "borisovai-backend" "$BACKEND_DOMAIN" "http://127.0.0.1:${BACKEND_PORT}"

# Создание DNS записей (если доступен manage-dns)
echo "[3/3] Создание DNS записей..."
if command -v manage-dns &> /dev/null; then
    SERVER_IP=$(curl -s ifconfig.me || curl -s ifconfig.co || hostname -I | awk '{print $1}')
    
    if [ -n "$SERVER_IP" ]; then
        # Извлечение поддомена и домена
        # Извлечение поддомена и базового домена
        # Для доменов типа "borisovai.ru" поддомен будет пустым, базовый домен - "borisovai.ru"
        # Для доменов типа "api.borisovai.ru" поддомен - "api", базовый домен - "borisovai.ru"
        extract_subdomain() {
            local domain="$1"
            local clean_domain=$(echo "$domain" | sed 's|^https\?://||')
            # Подсчитываем количество точек
            local dot_count=$(echo "$clean_domain" | tr -cd '.' | wc -c)
            if [ "$dot_count" -ge 2 ]; then
                # Есть поддомен (например, api.borisovai.ru)
                echo "$clean_domain" | cut -d'.' -f1
            else
                # Нет поддомена (например, borisovai.ru)
                echo ""
            fi
        }
        
        extract_base_domain() {
            local domain="$1"
            local clean_domain=$(echo "$domain" | sed 's|^https\?://||')
            # Подсчитываем количество точек
            local dot_count=$(echo "$clean_domain" | tr -cd '.' | wc -c)
            if [ "$dot_count" -ge 2 ]; then
                # Есть поддомен, берём всё после первой точки
                echo "$clean_domain" | cut -d'.' -f2-
            else
                # Нет поддомена, это и есть базовый домен
                echo "$clean_domain"
            fi
        }
        
        FRONTEND_SUBDOMAIN=$(extract_subdomain "$FRONTEND_DOMAIN")
        FRONTEND_BASE=$(extract_base_domain "$FRONTEND_DOMAIN")
        BACKEND_SUBDOMAIN=$(extract_subdomain "$BACKEND_DOMAIN")
        BACKEND_BASE=$(extract_base_domain "$BACKEND_DOMAIN")
        
        # Создание DNS записей
        # Если есть поддомен - создаём запись для поддомена, иначе для корневого домена
        if [ -n "$FRONTEND_BASE" ]; then
            if [ -n "$FRONTEND_SUBDOMAIN" ]; then
                echo "  Создание DNS записи для frontend: $FRONTEND_SUBDOMAIN.$FRONTEND_BASE -> $SERVER_IP"
                if manage-dns create "$FRONTEND_SUBDOMAIN" "$SERVER_IP" 2>/dev/null; then
                    echo "    [OK] DNS запись для frontend создана"
                else
                    echo "    [Предупреждение] Не удалось создать DNS запись для frontend автоматически"
                fi
            else
                echo "  Создание DNS записи для frontend: $FRONTEND_BASE -> $SERVER_IP"
                if manage-dns create "@" "$SERVER_IP" 2>/dev/null || manage-dns create "$FRONTEND_BASE" "$SERVER_IP" 2>/dev/null; then
                    echo "    [OK] DNS запись для frontend создана"
                else
                    echo "    [Предупреждение] Не удалось создать DNS запись для frontend автоматически"
                    echo "    Создайте A-запись для $FRONTEND_BASE -> $SERVER_IP вручную"
                fi
            fi
        fi
        
        if [ -n "$BACKEND_BASE" ]; then
            if [ -n "$BACKEND_SUBDOMAIN" ]; then
                echo "  Создание DNS записи для backend: $BACKEND_SUBDOMAIN.$BACKEND_BASE -> $SERVER_IP"
                if manage-dns create "$BACKEND_SUBDOMAIN" "$SERVER_IP" 2>/dev/null; then
                    echo "    [OK] DNS запись для backend создана"
                else
                    echo "    [Предупреждение] Не удалось создать DNS запись для backend автоматически"
                fi
            else
                echo "  Создание DNS записи для backend: $BACKEND_BASE -> $SERVER_IP"
                if manage-dns create "@" "$SERVER_IP" 2>/dev/null || manage-dns create "$BACKEND_BASE" "$SERVER_IP" 2>/dev/null; then
                    echo "    [OK] DNS запись для backend создана"
                else
                    echo "    [Предупреждение] Не удалось создать DNS запись для backend автоматически"
                    echo "    Создайте A-запись для $BACKEND_BASE -> $SERVER_IP вручную"
                fi
            fi
        fi
    else
        echo "  [Предупреждение] Не удалось определить IP адрес сервера"
    fi
else
    echo "  [Предупреждение] Скрипт manage-dns не найден"
    echo "  Создайте DNS записи вручную:"
    echo "    $FRONTEND_DOMAIN -> <SERVER_IP>"
    echo "    $BACKEND_DOMAIN -> <SERVER_IP>"
fi

# Перезагрузка Traefik
echo ""
echo "Перезагрузка Traefik..."
if systemctl is-active --quiet traefik; then
    systemctl reload traefik 2>/dev/null || systemctl restart traefik
else
    echo "  [Предупреждение] Traefik не запущен, запуск..."
    systemctl start traefik
fi

sleep 2
if systemctl is-active --quiet traefik; then
    echo ""
    echo "=== Конфигурация Traefik для деплоя завершена! ==="
    echo ""
    echo "Сервисы будут доступны по адресам:"
    echo "  - Frontend: https://${FRONTEND_DOMAIN}"
    echo "  - Backend API: https://${BACKEND_DOMAIN}"
    echo ""
    echo "Примечание:"
    echo "  - SSL сертификаты будут получены автоматически в течение нескольких минут"
    echo "  - Убедитесь, что frontend и backend запущены через PM2 на портах ${FRONTEND_PORT} и ${BACKEND_PORT}"
    echo "  - Проверьте DNS записи для доменов"
    echo ""
    echo "Проверка PM2 процессов:"
    if command -v pm2 &> /dev/null; then
        pm2 list
    else
        echo "  PM2 не установлен"
    fi
else
    echo ""
    echo "Ошибка: Traefik не запустился после перезагрузки"
    echo "Проверьте логи: journalctl -u traefik -n 50"
    exit 1
fi
