#!/bin/bash
# Скрипт конфигурации Traefik для всех сервисов
# Использование: sudo ./configure-traefik.sh <gitlab-domain> <n8n-domain> <ui-domain> [--force]
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

GITLAB_DOMAIN="${1:-}"
N8N_DOMAIN="${2:-}"
UI_DOMAIN="${3:-}"

if [ -z "$GITLAB_DOMAIN" ] || [ -z "$N8N_DOMAIN" ] || [ -z "$UI_DOMAIN" ]; then
    echo "Использование: $0 <gitlab-domain> <n8n-domain> <ui-domain>"
    exit 1
fi

echo "=== Конфигурация Traefik для всех сервисов ==="
echo ""

DYNAMIC_DIR="/etc/traefik/dynamic"
mkdir -p "$DYNAMIC_DIR"

# Функция для обновления конфигурации
update_config() {
    local config_file="$1"
    local service_name="$2"
    local domain="$3"
    local backend_url="$4"
    
    if [ "$FORCE_MODE" = true ] || [ ! -f "$config_file" ]; then
        # Создание новой конфигурации
        # Для GitLab добавляем middleware для правильной передачи заголовков
        if [ "$service_name" = "gitlab" ]; then
            cat > "$config_file" << EOF
http:
  middlewares:
    gitlab-headers:
      headers:
        customRequestHeaders:
          X-Forwarded-Proto: "https"
          X-Forwarded-Ssl: "on"
  
  routers:
    ${service_name}:
      rule: "Host(\`${domain}\`)"
      service: ${service_name}
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - gitlab-headers

  services:
    ${service_name}:
      loadBalancer:
        servers:
          - url: "${backend_url}"
EOF
        else
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
        fi
        echo "  [Создано] Конфигурация для $service_name"
    else
        # Обновление существующей конфигурации
        # Создание резервной копии
        cp "$config_file" "${config_file}.backup.$(date +%Y%m%d_%H%M%S)"
        
        # Обновление домена если изменился
        CURRENT_DOMAIN=$(grep -o "Host(\`[^\`]*\`)" "$config_file" | sed "s/Host(\`\(.*\)\`)/\1/" | head -1)
        if [ "$CURRENT_DOMAIN" != "$domain" ]; then
            sed -i "s|Host(\`[^\`]*\`)|Host(\`${domain}\`)|" "$config_file"
            echo "  [Обновлено] Домен для $service_name: $CURRENT_DOMAIN -> $domain"
        fi
        
        # Обновление backend URL если изменился
        CURRENT_URL=$(grep -o "url: \"[^\"]*\"" "$config_file" | sed 's/url: "\(.*\)"/\1/' | head -1)
        if [ "$CURRENT_URL" != "$backend_url" ]; then
            sed -i "s|url: \"[^\"]*\"|url: \"${backend_url}\"|" "$config_file"
            echo "  [Обновлено] Backend URL для $service_name: $CURRENT_URL -> $backend_url"
        fi
        
        if [ "$CURRENT_DOMAIN" = "$domain" ] && [ "$CURRENT_URL" = "$backend_url" ]; then
            echo "  [Пропуск] Конфигурация для $service_name уже актуальна"
        fi
    fi
}

# Конфигурация для GitLab
echo "[1/4] Создание/обновление конфигурации для GitLab..."
update_config "$DYNAMIC_DIR/gitlab.yml" "gitlab" "$GITLAB_DOMAIN" "http://127.0.0.1:8888"
# Конфигурация для n8n
echo "[2/4] Создание/обновление конфигурации для n8n..."
update_config "$DYNAMIC_DIR/n8n.yml" "n8n" "$N8N_DOMAIN" "http://127.0.0.1:5678"

# Конфигурация для веб-интерфейса управления
echo "[3/4] Создание/обновление конфигурации для веб-интерфейса управления..."
update_config "$DYNAMIC_DIR/management-ui.yml" "management-ui" "$UI_DOMAIN" "http://127.0.0.1:3000"

# Перезагрузка Traefik
echo "[4/4] Перезагрузка Traefik..."
if systemctl is-active --quiet traefik; then
    systemctl reload traefik 2>/dev/null || systemctl restart traefik
else
    echo "  [Предупреждение] Traefik не запущен, запуск..."
    systemctl start traefik
fi

sleep 2
if systemctl is-active --quiet traefik; then
    echo ""
    echo "=== Конфигурация Traefik завершена! ==="
    echo ""
    echo "Сервисы будут доступны по адресам:"
    echo "  - GitLab: https://${GITLAB_DOMAIN}"
    echo "  - n8n: https://${N8N_DOMAIN}"
    echo "  - Веб-интерфейс: https://${UI_DOMAIN}"
    
    # Проверка наличия Mailu
    if [ -f "/etc/traefik/dynamic/mailu.yml" ]; then
        MAILU_ADMIN_DOMAIN=$(grep -A 5 "mailu-admin:" /etc/traefik/dynamic/mailu.yml | grep -o "Host(\`[^\`]*\`)" | sed "s/Host(\`\(.*\)\`)/\1/" | head -1)
        if [ -n "$MAILU_ADMIN_DOMAIN" ]; then
            echo "  - Mailu Mail Server (Admin): https://${MAILU_ADMIN_DOMAIN}/admin"
            echo "  - Mailu Mail Server (Webmail): https://${MAILU_ADMIN_DOMAIN}"
        fi
    fi
    
    echo ""
    echo "Примечание: SSL сертификаты будут получены автоматически в течение нескольких минут"
else
    echo ""
    echo "Ошибка: Traefik не запустился после перезагрузки"
    echo "Проверьте логи: journalctl -u traefik -n 50"
    exit 1
fi
