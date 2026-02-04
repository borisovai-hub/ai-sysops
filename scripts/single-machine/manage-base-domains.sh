#!/bin/bash
# Управление списком базовых доменов (несколько DNS адресов для сервисов)
# Использование:
#   sudo ./manage-base-domains.sh list
#   sudo ./manage-base-domains.sh add <domain>
#   sudo ./manage-base-domains.sh remove <domain>
#   sudo ./manage-base-domains.sh site [port] [prefix]  # Next.js на всех доменах
#   sudo ./manage-base-domains.sh apply

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Ошибка: common.sh не найден"
    exit 1
fi

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите с правами root (sudo)"
    exit 1
fi

cmd="${1:-}"
domain="${2:-}"

case "$cmd" in
    list)
        echo "Базовые домены:"
        if [ -z "$(get_config_value "base_domains")" ]; then
            echo "  (не настроены)"
            echo ""
            echo "Добавьте домены: $0 add borisovai.ru"
            exit 0
        fi
        get_base_domains | while IFS= read -r d; do
            [ -n "$d" ] && echo "  - $d"
        done
        ;;
    add)
        if [ -z "$domain" ]; then
            echo "Использование: $0 add <domain>"
            exit 1
        fi
        current=$(get_config_value "base_domains")
        if [ -n "$current" ]; then
            if echo ",$current," | grep -q ",$domain,"; then
                echo "Домен $domain уже в списке"
                exit 0
            fi
            new_domains="$current,$domain"
        else
            new_domains="$domain"
        fi
        save_base_domains "$new_domains"
        echo "Добавлен базовый домен: $domain"
        echo "Текущий список: $new_domains"
        echo "Примените к сервисам: $0 apply"
        ;;
    remove)
        if [ -z "$domain" ]; then
            echo "Использование: $0 remove <domain>"
            exit 1
        fi
        current=$(get_config_value "base_domains")
        if [ -z "$current" ]; then
            echo "Список базовых доменов пуст"
            exit 0
        fi
        new_domains=$(echo "$current" | tr ',' '\n' | grep -v "^${domain}$" | tr '\n' ',' | sed 's/,$//')
        if [ "$new_domains" = "$current" ]; then
            echo "Домен $domain не найден в списке"
            exit 0
        fi
        save_base_domains "$new_domains"
        echo "Удалён базовый домен: $domain"
        echo "Текущий список: $new_domains"
        echo "Примените к сервисам: $0 apply"
        ;;
    site)
        if [ -z "$(get_config_value "base_domains")" ]; then
            echo "Сначала добавьте базовые домены: $0 add borisovai.ru"
            exit 1
        fi
        frontend_port="${2:-4001}"
        api_port="${3:-4002}"
        prefix="${4:-}"
        save_config_value "site_port" "$frontend_port"
        save_config_value "site_api_port" "$api_port"
        save_config_value "site_prefix" "$prefix"
        echo "Сайт (Next.js): frontend порт $frontend_port, API порт $api_port."
        echo "Фронт (apex): borisovai.ru, borisovai.tech → порт $frontend_port"
        echo "API: api.borisovai.ru, api.borisovai.tech → порт $api_port"
        echo "Применяю конфигурацию Traefik..."
        "$SCRIPT_DIR/configure-traefik.sh"
        echo ""
        echo "Создание DNS записей для api..."
        create_dns_records_for_domains "api"
        echo ""
        echo "Запустите frontend на порту $frontend_port, backend API на порту $api_port"
        ;;
    apply)
        if [ ! -f "$SCRIPT_DIR/configure-traefik.sh" ]; then
            echo "Ошибка: configure-traefik.sh не найден"
            exit 1
        fi
        echo "Применение базовых доменов к Traefik и сервисам..."
        "$SCRIPT_DIR/configure-traefik.sh"
        echo ""
        echo "Готово. Проверьте DNS записи (manage-dns или DNS API)."
        ;;
    *)
        echo "Использование: $0 {list|add|remove|site|apply}"
        echo "  list           - показать базовые домены"
        echo "  add <domain>   - добавить базовый домен"
        echo "  remove <domain> - удалить базовый домен"
        echo "  site [frontend_port] [api_port] - включить сайт: apex→frontend, api→backend (по умолчанию 4001 4002)"
        echo "  apply          - обновить Traefik и DNS для всех сервисов"
        exit 1
        ;;
esac
