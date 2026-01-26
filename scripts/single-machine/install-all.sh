#!/bin/bash
# Главный скрипт установки всех инструментов на одну машину
# Использование: sudo ./install-all.sh [--continue] [--force] [--ask] [--new-only]
# 
# Параметры:
#   --continue  - продолжить установку с места остановки
#   --force     - переустановить все компоненты
#   --ask       - интерактивный режим (спрашивать о переустановке каждого компонента)
#   --new-only  - установить только новые компоненты (по умолчанию)
# 
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение и найдет все необходимые файлы.

# Определение директории скрипта (абсолютный путь)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Загрузка общих функций
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Ошибка: common.sh не найден"
    exit 1
fi

# Параметры командной строки
CONTINUE_MODE=false
FORCE_MODE=false
INSTALL_MODE="auto"  # По умолчанию: автоматический пропуск установленных

for arg in "$@"; do
    case $arg in
        --continue)
            CONTINUE_MODE=true
            ;;
        --force)
            FORCE_MODE=true
            INSTALL_MODE="force"
            ;;
        --ask)
            INSTALL_MODE="ask"
            ;;
        --new-only)
            INSTALL_MODE="auto"
            ;;
        *)
            echo "Неизвестный параметр: $arg"
            echo "Использование: $0 [--continue] [--force] [--ask] [--new-only]"
            exit 1
            ;;
    esac
done

# Отключаем немедленный выход при ошибке для лучшей обработки
set +e
ERROR_OCCURRED=false

# Настройка обработки ошибок
trap 'ERROR_OCCURRED=true; handle_error $? $LINENO' ERR

echo "=========================================="
echo "  Установка всех инструментов на одну машину"
echo "=========================================="
echo ""
echo "Этот скрипт установит:"
echo "  - Traefik (reverse proxy с SSL)"
echo "  - GitLab CE (Git сервер)"
echo "  - n8n (автоматизация workflow)"
echo "  - Веб-интерфейс управления"
echo "  - DNS API интеграция (опционально)"
echo "  - Stalwart Mail Server (опционально)"
echo ""

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Функция для проверки и запроса переустановки отдельного сервиса
check_and_ask_reinstall() {
    local service_name="$1"
    local check_command="$2"
    local install_mode="${3:-auto}"  # По умолчанию auto
    
    if [ "$install_mode" = "force" ] || [ "$FORCE_MODE" = true ]; then
        return 0  # Переустановка принудительно включена
    fi
    
    if eval "$check_command" 2>/dev/null; then
        if [ "$install_mode" = "ask" ]; then
            echo ""
            read -p "  Сервис $service_name уже установлен. Переустановить? (y/n): " REINSTALL
            if [ "$REINSTALL" = "y" ] || [ "$REINSTALL" = "Y" ]; then
                return 0  # Переустановить
            else
                return 1  # Пропустить
            fi
        else
            # Режим auto: автоматически пропускаем
            return 1  # Пропустить
        fi
    fi
    return 0  # Не установлен, можно устанавливать
}

# Проверка системных требований
echo "[Проверка] Системные требования..."
TOTAL_RAM=$(free -g | awk '/^Mem:/{print $2}')
TOTAL_CPU=$(nproc)
TOTAL_DISK=$(df -h / | awk 'NR==2 {print $2}' | sed 's/G//' | sed 's/[^0-9]//g')

echo "  RAM: ${TOTAL_RAM}GB (требуется минимум 8GB)"
echo "  CPU: ${TOTAL_CPU} (требуется минимум 4)"
echo "  Диск: ${TOTAL_DISK}GB (требуется минимум 100GB)"

# Проверка доступности портов на конфликты
echo ""
echo "[Проверка] Проверка портов на конфликты..."
CONFLICTS_FOUND=0

check_port() {
    local port=$1
    local service=$2
    local in_use=0
    
    if command -v ss &> /dev/null; then
        in_use=$(ss -tuln 2>/dev/null | grep -c ":${port} " || echo "0")
    elif command -v netstat &> /dev/null; then
        in_use=$(netstat -tuln 2>/dev/null | grep -c ":${port} " || echo "0")
    else
        return 0
    fi
    
    if [ "$in_use" -gt 0 ]; then
        echo "  [КОНФЛИКТ] Порт $port используется другим процессом (для $service)"
        if command -v ss &> /dev/null; then
            ss -tulnp 2>/dev/null | grep ":${port} " | head -3 || true
        elif command -v netstat &> /dev/null; then
            netstat -tulnp 2>/dev/null | grep ":${port} " | head -3 || true
        fi
        CONFLICTS_FOUND=1
    else
        echo "  [OK] Порт $port свободен (для $service)"
    fi
}

if command -v ss &> /dev/null || command -v netstat &> /dev/null; then
    echo "Проверка портов сервисов:"
    check_port 80 "Traefik (HTTP)"
    check_port 443 "Traefik (HTTPS)"
    check_port 8080 "Traefik (Dashboard)"
    check_port 8888 "GitLab"
    check_port 5678 "n8n"
    check_port 3000 "Management UI"
    check_port 5353 "Local DNS API"
    check_port 53 "dnsmasq (DNS)"
    
    if [ "$CONFLICTS_FOUND" -eq 1 ]; then
        echo ""
        echo "  ВНИМАНИЕ: Обнаружены конфликты портов!"
        echo "  Рекомендуется освободить занятые порты перед установкой"
        read -p "  Продолжить установку? (y/n): " CONTINUE_PORT
        if [ "$CONTINUE_PORT" != "y" ] && [ "$CONTINUE_PORT" != "Y" ]; then
            exit 1
        fi
    else
        echo ""
        echo "  [OK] Конфликтов портов не обнаружено"
    fi
else
    echo "  [Пропуск] Утилиты ss или netstat не найдены, проверка портов пропущена"
fi

if [ "$TOTAL_RAM" -lt 8 ]; then
    echo ""
    echo "ПРЕДУПРЕЖДЕНИЕ: Рекомендуется минимум 8GB RAM"
    echo "Текущая конфигурация может работать медленно"
    read -p "Продолжить? (y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
        exit 1
    fi
fi

# Определение корневой директории установки (где находится management-ui)
# Ожидается структура: ~/install/scripts/single-machine/install-all.sh
#                     ~/install/management-ui/
INSTALL_ROOT="$(dirname "$SCRIPT_DIR")"

# Инициализация состояния установки
init_install_state

# Вывод информации о режиме
if [ "$CONTINUE_MODE" = true ]; then
    echo "Режим: Продолжение установки"
    echo "Пропущенные шаги будут выполнены"
    echo ""
elif [ "$FORCE_MODE" = true ]; then
    echo "Режим: Принудительная переустановка"
    echo "Все компоненты будут переустановлены"
    echo ""
elif [ "$INSTALL_MODE" = "ask" ]; then
    echo "Режим: Интерактивный"
    echo "Будут запрошены подтверждения для уже установленных компонентов"
    echo ""
else
    echo "Режим: Автоматический (только новые компоненты)"
    echo "Уже установленные компоненты будут пропущены"
    echo ""
fi

# Сбор конфигурации
echo ""
echo "=== Конфигурация ==="
echo ""

GITLAB_DOMAIN=$(prompt_and_save "gitlab_domain" "Домен для GitLab (например, gitlab.example.com)")
if [ -z "$GITLAB_DOMAIN" ]; then
    echo "Ошибка: Домен GitLab обязателен"
    exit 1
fi

N8N_DOMAIN=$(prompt_and_save "n8n_domain" "Домен для n8n (например, n8n.example.com)")
if [ -z "$N8N_DOMAIN" ]; then
    echo "Ошибка: Домен n8n обязателен"
    exit 1
fi

UI_DOMAIN=$(prompt_and_save "ui_domain" "Домен для веб-интерфейса управления (например, manage.example.com)")
if [ -z "$UI_DOMAIN" ]; then
    echo "Ошибка: Домен веб-интерфейса обязателен"
    exit 1
fi

LETSENCRYPT_EMAIL=$(prompt_and_save "letsencrypt_email" "Email для Let's Encrypt")
if [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo "Ошибка: Email обязателен для Let's Encrypt"
    exit 1
fi

echo ""
SETUP_DNS_CHOICE=$(prompt_choice_and_save "setup_dns_choice" "Настроить DNS API? (y/n)")
DNS_PROVIDER=""
if [ "$SETUP_DNS_CHOICE" = "y" ] || [ "$SETUP_DNS_CHOICE" = "Y" ]; then
    echo ""
    echo "Выберите DNS провайдера:"
    echo "1) Cloudflare"
    echo "2) DigitalOcean"
    echo "3) Локальный DNS API"
    DNS_CHOICE=$(prompt_choice_and_save "dns_provider_choice" "Ваш выбор (1-3)")
    case $DNS_CHOICE in
        1) DNS_PROVIDER="cloudflare" ;;
        2) DNS_PROVIDER="digitalocean" ;;
        3) DNS_PROVIDER="local" ;;
        *) DNS_PROVIDER="" ;;
    esac
    if [ -n "$DNS_PROVIDER" ]; then
        save_config_value "dns_provider" "$DNS_PROVIDER"
    fi
fi

echo ""
SETUP_MAIL_CHOICE=$(prompt_choice_and_save "setup_mail_choice" "Установить Stalwart Mail Server? (y/n)")
MAIL_DOMAIN=""
if [ "$SETUP_MAIL_CHOICE" = "y" ] || [ "$SETUP_MAIL_CHOICE" = "Y" ]; then
    MAIL_DOMAIN=$(prompt_and_save "mail_domain" "Домен для почты (например, mail.example.com)")
    if [ -z "$MAIL_DOMAIN" ]; then
        echo "Ошибка: Домен для почты обязателен"
        exit 1
    fi
fi

# Вывод конфигурации
echo ""
echo "=== Конфигурация ==="
echo "  GitLab домен: $GITLAB_DOMAIN"
echo "  n8n домен: $N8N_DOMAIN"
echo "  Веб-интерфейс домен: $UI_DOMAIN"
echo "  Let's Encrypt email: $LETSENCRYPT_EMAIL"
if [ -n "$DNS_PROVIDER" ]; then
    echo "  DNS API: будет настроен"
fi
if [ -n "$MAIL_DOMAIN" ]; then
    echo "  Stalwart Mail Server: будет установлен ($MAIL_DOMAIN)"
fi
echo ""
read -p "Продолжить установку? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    exit 1
fi

# Сохранение конфигурации
CONFIG_FILE="/tmp/install-config.env"
cat > "$CONFIG_FILE" << EOF
GITLAB_DOMAIN=$GITLAB_DOMAIN
N8N_DOMAIN=$N8N_DOMAIN
UI_DOMAIN=$UI_DOMAIN
LETSENCRYPT_EMAIL=$LETSENCRYPT_EMAIL
DNS_PROVIDER=$DNS_PROVIDER
EOF

# Обновление системы
echo ""
echo "=== [1/10] Обновление системы ==="
STEP_NAME="system_update"
if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME"; then
    echo "  [Пропуск] Обновление системы уже выполнено"
else
    save_install_state "$STEP_NAME" "in_progress"
    export DEBIAN_FRONTEND=noninteractive
    if safe_execute "$STEP_NAME" "apt update && apt upgrade -y"; then
        echo "  [OK] Система обновлена"
    else
        echo "  [ОШИБКА] Не удалось обновить систему"
        if [ "$CONTINUE_MODE" != true ]; then
            echo "Используйте --continue для продолжения"
            exit 1
        fi
    fi
fi

# Установка базовых пакетов
echo ""
echo "=== [2/10] Установка базовых пакетов ==="
STEP_NAME="base_packages"
if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME"; then
    echo "  [Пропуск] Базовые пакеты уже установлены"
else
    save_install_state "$STEP_NAME" "in_progress"
    if safe_execute "$STEP_NAME" "apt install -y curl wget git unzip jq ufw"; then
        echo "  [OK] Базовые пакеты установлены"
    else
        echo "  [ОШИБКА] Не удалось установить базовые пакеты"
        if [ "$CONTINUE_MODE" != true ]; then
            echo "Используйте --continue для продолжения"
            exit 1
        fi
    fi
fi

# Настройка firewall
echo ""
echo "=== [3/10] Настройка firewall ==="
STEP_NAME="firewall"
if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME"; then
    echo "  [Пропуск] Firewall уже настроен"
else
    save_install_state "$STEP_NAME" "in_progress"
    if command -v ufw &> /dev/null; then
        if safe_execute "$STEP_NAME" "ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable"; then
            echo "  [OK] Firewall настроен: порты 22, 80, 443 открыты"
        else
            echo "  [ОШИБКА] Не удалось настроить firewall"
            if [ "$CONTINUE_MODE" != true ]; then
                echo "Используйте --continue для продолжения"
                exit 1
            fi
        fi
    else
        echo "  [Пропуск] UFW не установлен, настройте firewall вручную"
        save_install_state "$STEP_NAME" "completed"
    fi
fi

# Установка Traefik
echo ""
echo "=== [4/10] Установка Traefik ==="
STEP_NAME="traefik"
SERVICE_FORCE_MODE=false
if check_and_ask_reinstall "Traefik" "is_service_installed traefik.service" "$INSTALL_MODE"; then
    SERVICE_FORCE_MODE=true
fi

if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$SERVICE_FORCE_MODE" != true ]; then
    echo "  [Пропуск] Traefik уже установлен"
else
    if [ "$SERVICE_FORCE_MODE" = true ]; then
        save_install_state "$STEP_NAME" "in_progress"
        if [ -f "$SCRIPT_DIR/install-traefik.sh" ]; then
            bash "$SCRIPT_DIR/install-traefik.sh" "$LETSENCRYPT_EMAIL" --force
            if [ $? -eq 0 ]; then
                save_install_state "$STEP_NAME" "completed"
                echo "  [OK] Traefik установлен"
            else
                echo "  [ОШИБКА] Не удалось установить Traefik"
                if [ "$CONTINUE_MODE" != true ]; then
                    echo "Используйте --continue для продолжения"
                    exit 1
                fi
            fi
        else
            echo "  [ОШИБКА] Скрипт install-traefik.sh не найден"
            exit 1
        fi
    else
        if [ "$INSTALL_MODE" = "ask" ]; then
            echo "  [Пропуск] Traefik уже установлен (пользователь отказался от переустановки)"
        else
            echo "  [Пропуск] Traefik уже установлен"
        fi
    fi
fi

# Настройка DNS API (если нужно)
echo ""
echo "=== [5/10] Настройка DNS API ==="
STEP_NAME="dns_api"
if [ -n "$DNS_PROVIDER" ]; then
    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$FORCE_MODE" != true ]; then
        echo "  [Пропуск] DNS API уже настроен"
    else
        save_install_state "$STEP_NAME" "in_progress"
        if [ -f "$SCRIPT_DIR/setup-dns-api.sh" ]; then
            bash "$SCRIPT_DIR/setup-dns-api.sh" "$DNS_PROVIDER"
            if [ $? -eq 0 ]; then
                save_install_state "$STEP_NAME" "completed"
                echo "  [OK] DNS API настроен"
            else
                echo "  [ОШИБКА] Не удалось настроить DNS API"
                if [ "$CONTINUE_MODE" != true ]; then
                    echo "Используйте --continue для продолжения"
                    exit 1
                fi
            fi
        else
            echo "  [Предупреждение] Скрипт setup-dns-api.sh не найден, пропускаем"
            save_install_state "$STEP_NAME" "completed"
        fi
    fi
else
    echo "  [Пропуск] DNS API не выбран"
    save_install_state "$STEP_NAME" "completed"
fi

# Установка GitLab
echo ""
echo "=== [6/10] Установка GitLab ==="
STEP_NAME="gitlab"
SERVICE_FORCE_MODE=false
if check_and_ask_reinstall "GitLab" "is_package_installed gitlab-ce || is_service_installed gitlab-runsvdir" "$INSTALL_MODE"; then
    SERVICE_FORCE_MODE=true
fi

if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$SERVICE_FORCE_MODE" != true ]; then
    echo "  [Пропуск] GitLab уже установлен"
else
    # Формирование аргументов для install-gitlab.sh
    # Передаем только непустые значения, чтобы избежать проблем с парсингом
    GITLAB_ARGS=()
    [ -n "$GITLAB_DOMAIN" ] && GITLAB_ARGS+=("$GITLAB_DOMAIN")
    [ -n "$LETSENCRYPT_EMAIL" ] && GITLAB_ARGS+=("$LETSENCRYPT_EMAIL")
    [ "$SERVICE_FORCE_MODE" = true ] && GITLAB_ARGS+=("--force")
    
    save_install_state "$STEP_NAME" "in_progress"
    if [ -f "$SCRIPT_DIR/install-gitlab.sh" ]; then
        bash "$SCRIPT_DIR/install-gitlab.sh" "${GITLAB_ARGS[@]}"
        if [ $? -eq 0 ]; then
            save_install_state "$STEP_NAME" "completed"
            echo "  [OK] GitLab установлен"
        else
            echo "  [ОШИБКА] Не удалось установить GitLab"
            if [ "$CONTINUE_MODE" != true ]; then
                echo "Используйте --continue для продолжения"
                exit 1
            fi
        fi
    else
        echo "  [ОШИБКА] Скрипт install-gitlab.sh не найден"
        exit 1
    fi
fi

# Установка n8n
echo ""
echo "=== [7/10] Установка n8n ==="
STEP_NAME="n8n"
SERVICE_FORCE_MODE=false
if check_and_ask_reinstall "n8n" "is_service_installed n8n.service" "$INSTALL_MODE"; then
    SERVICE_FORCE_MODE=true
fi

if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$SERVICE_FORCE_MODE" != true ]; then
    echo "  [Пропуск] n8n уже установлен"
else
    if [ "$SERVICE_FORCE_MODE" = true ]; then
        save_install_state "$STEP_NAME" "in_progress"
        if [ -f "$SCRIPT_DIR/install-n8n.sh" ]; then
            bash "$SCRIPT_DIR/install-n8n.sh" "$N8N_DOMAIN" --force
            if [ $? -eq 0 ]; then
                save_install_state "$STEP_NAME" "completed"
                echo "  [OK] n8n установлен"
            else
                echo "  [ОШИБКА] Не удалось установить n8n"
                if [ "$CONTINUE_MODE" != true ]; then
                    echo "Используйте --continue для продолжения"
                    exit 1
                fi
            fi
        else
            echo "  [ОШИБКА] Скрипт install-n8n.sh не найден"
            exit 1
        fi
    else
        if [ "$INSTALL_MODE" = "ask" ]; then
            echo "  [Пропуск] n8n уже установлен (пользователь отказался от переустановки)"
        else
            echo "  [Пропуск] n8n уже установлен"
        fi
    fi
fi

# Установка веб-интерфейса
echo ""
echo "=== [8/10] Установка веб-интерфейса управления ==="
STEP_NAME="management_ui"
SERVICE_FORCE_MODE=false
if check_and_ask_reinstall "Management UI" "is_service_installed management-ui.service" "$INSTALL_MODE"; then
    SERVICE_FORCE_MODE=true
fi

if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$SERVICE_FORCE_MODE" != true ]; then
    echo "  [Пропуск] Веб-интерфейс уже установлен"
else
    if [ "$SERVICE_FORCE_MODE" = true ]; then
        save_install_state "$STEP_NAME" "in_progress"
        if [ -f "$SCRIPT_DIR/install-management-ui.sh" ]; then
            # Передаем путь к корневой директории установки для поиска management-ui
            bash "$SCRIPT_DIR/install-management-ui.sh" "$INSTALL_ROOT" --force
            if [ $? -eq 0 ]; then
                save_install_state "$STEP_NAME" "completed"
                echo "  [OK] Веб-интерфейс установлен"
            else
                echo "  [ОШИБКА] Не удалось установить веб-интерфейс управления"
                echo "Убедитесь, что директория management-ui загружена на сервер"
                echo "Ожидаемое расположение: $INSTALL_ROOT/management-ui"
                if [ "$CONTINUE_MODE" != true ]; then
                    echo "Используйте --continue для продолжения"
                    exit 1
                fi
            fi
        else
            echo "  [ОШИБКА] Скрипт install-management-ui.sh не найден"
            exit 1
        fi
    else
        if [ "$INSTALL_MODE" = "ask" ]; then
            echo "  [Пропуск] Веб-интерфейс уже установлен (пользователь отказался от переустановки)"
        else
            echo "  [Пропуск] Веб-интерфейс уже установлен"
        fi
    fi
fi

# Установка Stalwart Mail Server (если выбрано)
echo ""
echo "=== [9/10] Установка Stalwart Mail Server ==="
STEP_NAME="stalwart"
if [ -n "$MAIL_DOMAIN" ]; then
    SERVICE_FORCE_MODE=false
    if check_and_ask_reinstall "Stalwart Mail Server" "is_service_installed stalwart-mail.service" "$INSTALL_MODE"; then
        SERVICE_FORCE_MODE=true
    fi

    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$SERVICE_FORCE_MODE" != true ]; then
        echo "  [Пропуск] Stalwart уже установлен"
    else
        if [ "$SERVICE_FORCE_MODE" = true ]; then
            save_install_state "$STEP_NAME" "in_progress"
            if [ -f "$SCRIPT_DIR/install-stalwart.sh" ]; then
                STALWART_ARGS=()
                [ -n "$MAIL_DOMAIN" ] && STALWART_ARGS+=("$MAIL_DOMAIN")
                [ -n "$LETSENCRYPT_EMAIL" ] && STALWART_ARGS+=("$LETSENCRYPT_EMAIL")
                [ "$SERVICE_FORCE_MODE" = true ] && STALWART_ARGS+=("--force")
                
                bash "$SCRIPT_DIR/install-stalwart.sh" "${STALWART_ARGS[@]}"
                if [ $? -eq 0 ]; then
                    save_install_state "$STEP_NAME" "completed"
                    echo "  [OK] Stalwart установлен"
                else
                    echo "  [ОШИБКА] Не удалось установить Stalwart"
                    if [ "$CONTINUE_MODE" != true ]; then
                        echo "Используйте --continue для продолжения"
                        exit 1
                    fi
                fi
            else
                echo "  [ОШИБКА] Скрипт install-stalwart.sh не найден"
                exit 1
            fi
        else
            if [ "$INSTALL_MODE" = "ask" ]; then
                echo "  [Пропуск] Stalwart уже установлен (пользователь отказался от переустановки)"
            else
                echo "  [Пропуск] Stalwart уже установлен"
            fi
        fi
    fi
else
    echo "  [Пропуск] Stalwart Mail Server не выбран"
    save_install_state "$STEP_NAME" "completed"
fi

# Конфигурация Traefik для всех сервисов
echo ""
echo "=== [10/10] Конфигурация Traefik для всех сервисов ==="
STEP_NAME="configure_traefik"
if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$FORCE_MODE" != true ]; then
    echo "  [Пропуск] Traefik уже настроен"
else
    save_install_state "$STEP_NAME" "in_progress"
    if [ -f "$SCRIPT_DIR/configure-traefik.sh" ]; then
        bash "$SCRIPT_DIR/configure-traefik.sh" "$GITLAB_DOMAIN" "$N8N_DOMAIN" "$UI_DOMAIN"
        if [ $? -eq 0 ]; then
            save_install_state "$STEP_NAME" "completed"
            echo "  [OK] Traefik настроен"
        else
            echo "  [ОШИБКА] Не удалось настроить Traefik"
            if [ "$CONTINUE_MODE" != true ]; then
                echo "Используйте --continue для продолжения"
                exit 1
            fi
        fi
    else
        echo "  [ОШИБКА] Скрипт configure-traefik.sh не найден"
        exit 1
    fi
fi

# Финальная проверка
echo ""
echo "=== Проверка установленных сервисов ==="
echo "Ожидание запуска всех сервисов..."
sleep 10

echo ""
echo "Статус сервисов:"
TRAEFIK_OK=false
GITLAB_OK=false
N8N_OK=false
UI_OK=false
STALWART_OK=false

if systemctl is-active --quiet traefik; then
    echo "  ✓ Traefik - запущен"
    TRAEFIK_OK=true
else
    echo "  ✗ Traefik - не запущен (проверьте: systemctl status traefik)"
fi

if systemctl is-active --quiet gitlab-runsvdir; then
    echo "  ✓ GitLab - запущен"
    GITLAB_OK=true
else
    echo "  ✗ GitLab - не запущен (проверьте: gitlab-ctl status)"
fi

if systemctl is-active --quiet n8n; then
    echo "  ✓ n8n - запущен"
    N8N_OK=true
else
    echo "  ✗ n8n - не запущен (проверьте: systemctl status n8n)"
fi

if systemctl is-active --quiet management-ui; then
    echo "  ✓ Веб-интерфейс - запущен"
    UI_OK=true
else
    echo "  ✗ Веб-интерфейс - не запущен (проверьте: systemctl status management-ui)"
fi

if [ -n "$MAIL_DOMAIN" ]; then
    if systemctl is-active --quiet stalwart-mail; then
        echo "  ✓ Stalwart Mail Server - запущен"
        STALWART_OK=true
    else
        echo "  ✗ Stalwart Mail Server - не запущен (проверьте: systemctl status stalwart-mail)"
    fi
fi

if [ "$TRAEFIK_OK" = false ] || [ "$GITLAB_OK" = false ] || [ "$N8N_OK" = false ] || [ "$UI_OK" = false ] || ([ -n "$MAIL_DOMAIN" ] && [ "$STALWART_OK" = false ]); then
    echo ""
    echo "ВНИМАНИЕ: Некоторые сервисы не запущены!"
    echo "Проверьте логи и статус сервисов перед использованием."
fi

echo ""
echo "=========================================="
if [ "$ERROR_OCCURRED" = true ]; then
    echo "  Установка завершена с ошибками"
    echo "=========================================="
    echo ""
    echo "Используйте --continue для продолжения установки"
    echo ""
    exit 1
else
    echo "  Установка завершена!"
    echo "=========================================="
    echo ""
fi
echo "Доступ к сервисам:"
echo "  - GitLab: https://$GITLAB_DOMAIN"
echo "  - n8n: https://$N8N_DOMAIN"
echo "  - Веб-интерфейс управления: https://$UI_DOMAIN"
if [ -n "$MAIL_DOMAIN" ]; then
    BASE_DOMAIN=$(echo "$MAIL_DOMAIN" | sed 's/^[^.]*\.//')
    ADMIN_DOMAIN="mail-admin.$BASE_DOMAIN"
    echo "  - Stalwart Mail Server: https://$ADMIN_DOMAIN"
fi
echo "  - Traefik Dashboard: http://localhost:8080"
echo ""
echo "Порты сервисов (внутренние, только localhost):"
echo "  - Traefik:"
echo "    * HTTP: 80 (внешний)"
echo "    * HTTPS: 443 (внешний)"
echo "    * Dashboard: http://localhost:8080"
echo "  - GitLab: http://127.0.0.1:8888"
echo "  - n8n: http://127.0.0.1:5678"
echo "  - Management UI: http://127.0.0.1:3000"
echo "  - Local DNS API: http://127.0.0.1:5353"
echo "  - dnsmasq: 53 (UDP, DNS)"
if [ -n "$MAIL_DOMAIN" ]; then
    echo "  - Stalwart Mail Server:"
    echo "    * Веб-админка: http://127.0.0.1:8081"
    echo "    * SMTP: 25, 587, 465 (внешние)"
    echo "    * IMAP: 143, 993 (внешние)"
fi
echo ""
echo "Все порты уникальны и не конфликтуют между собой."
echo ""
echo "ВАЖНО:"
echo "  1. Сохраните начальный пароль GitLab root (проверьте /etc/gitlab/initial_root_password)"
echo "  2. SSL сертификаты будут получены автоматически в течение нескольких минут"
echo "  3. Проверьте DNS записи для всех доменов"
if [ -n "$MAIL_DOMAIN" ]; then
    echo "  4. Stalwart Mail Server:"
    echo "     - Войдите в веб-админку и создайте домен"
    echo "     - Добавьте DNS записи (MX, SPF, DKIM, DMARC) - см. веб-админку"
    echo "     - Сохраните admin credentials (если они были выведены при установке)"
fi
echo ""
echo "Полезные команды:"
echo "  systemctl status traefik"
echo "  systemctl status gitlab-runsvdir"
echo "  systemctl status n8n"
echo "  systemctl status management-ui"
if [ -n "$MAIL_DOMAIN" ]; then
    echo "  systemctl status stalwart-mail"
fi
echo ""
