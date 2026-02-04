#!/bin/bash
# Скрипт установки GitLab CE на одну машину
# Использование: sudo ./install-gitlab.sh <domain> <letsencrypt-email> [--force] [--reconfigure]
#
# Параметры:
#   --force       - переустановить GitLab (удалить и установить заново)
#   --reconfigure - только переконфигурировать GitLab без переустановки
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

# Функции для проверки портов
check_port_in_use() {
    local port=$1
    if command -v netstat &> /dev/null; then
        netstat -tlnp 2>/dev/null | grep -q ":$port " && return 0
    elif command -v ss &> /dev/null; then
        ss -tlnp 2>/dev/null | grep -q ":$port " && return 0
    elif command -v lsof &> /dev/null; then
        lsof -i :$port 2>/dev/null | grep -q LISTEN && return 0
    fi
    return 1
}

find_process_on_port() {
    local port=$1
    if command -v netstat &> /dev/null; then
        netstat -tlnp 2>/dev/null | grep ":$port " | awk '{print $7}' | head -1 | cut -d'/' -f1
    elif command -v ss &> /dev/null; then
        ss -tlnp 2>/dev/null | grep ":$port " | grep -oP 'pid=\K[0-9]+' | head -1
    elif command -v lsof &> /dev/null; then
        lsof -ti :$port 2>/dev/null | head -1
    fi
}

get_process_name() {
    local pid=$1
    if [ -n "$pid" ] && [ -f "/proc/$pid/comm" ]; then
        cat "/proc/$pid/comm" 2>/dev/null
    elif command -v ps &> /dev/null; then
        ps -p "$pid" -o comm= 2>/dev/null | head -1
    fi
}

# Параметры
GITLAB_DOMAIN=""
LETSENCRYPT_EMAIL=""
FORCE_MODE=false
RECONFIGURE_MODE=false

# Обработка аргументов (--force и --reconfigure могут быть в любом месте)
for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
        --reconfigure)
            RECONFIGURE_MODE=true
            ;;
        *)
            # Если аргумент не --force, --reconfigure и не пустой, это домен или email
            if [ -z "$GITLAB_DOMAIN" ] && [ "$arg" != "--force" ] && [ "$arg" != "--reconfigure" ]; then
                GITLAB_DOMAIN="$arg"
            elif [ -z "$LETSENCRYPT_EMAIL" ] && [ "$arg" != "--force" ] && [ "$arg" != "--reconfigure" ] && [ "$arg" != "$GITLAB_DOMAIN" ]; then
                LETSENCRYPT_EMAIL="$arg"
            fi
            ;;
    esac
done

if [ -z "$GITLAB_DOMAIN" ]; then
    if [ -n "$(get_config_value "base_domains")" ]; then
        GITLAB_PREFIX=$(get_config_value "gitlab_prefix")
        [ -z "$GITLAB_PREFIX" ] && GITLAB_PREFIX="gitlab"
        save_config_value "gitlab_prefix" "$GITLAB_PREFIX"
        GITLAB_DOMAIN=$(build_service_domains "$GITLAB_PREFIX" | head -1)
        if [ -z "$GITLAB_DOMAIN" ]; then
            echo "Ошибка: Не удалось получить домен из base_domains"
            exit 1
        fi
        echo "Используются базовые домены, основной домен GitLab: $GITLAB_DOMAIN"
    else
        GITLAB_DOMAIN=$(get_config_value "gitlab_domain")
        if [ -z "$GITLAB_DOMAIN" ]; then
            GITLAB_DOMAIN=$(prompt_and_save "gitlab_domain" "Введите домен для GitLab (например, gitlab.example.com)")
            if [ -z "$GITLAB_DOMAIN" ]; then
                echo "Ошибка: Домен обязателен"
                exit 1
            fi
        else
            echo "Используется сохраненный домен GitLab: $GITLAB_DOMAIN"
        fi
    fi
fi

if [ -z "$LETSENCRYPT_EMAIL" ]; then
    # Пытаемся загрузить из сохраненной конфигурации
    LETSENCRYPT_EMAIL=$(get_config_value "letsencrypt_email")
    
    if [ -z "$LETSENCRYPT_EMAIL" ]; then
        LETSENCRYPT_EMAIL=$(prompt_and_save "letsencrypt_email" "Email для Let's Encrypt")
    else
        echo "Используется сохраненный email: $LETSENCRYPT_EMAIL"
    fi
fi

echo "=== Установка GitLab CE ==="
echo ""

# Режим переконфигурирования
if [ "$RECONFIGURE_MODE" = true ]; then
    if ! is_package_installed "gitlab-ce" && ! is_service_installed "gitlab-runsvdir"; then
        echo "Ошибка: GitLab не установлен. Используйте скрипт без --reconfigure для установки."
        exit 1
    fi
    
    echo "Режим: Переконфигурирование GitLab"
    echo "Будет обновлена только конфигурация, без переустановки пакета."
    echo ""
    
    # Переходим сразу к настройке конфигурации
    # Пропускаем установку пакета
    SKIP_INSTALL=true
else
    SKIP_INSTALL=false
fi

# Проверка существования GitLab
if [ "$FORCE_MODE" = true ] && [ "$RECONFIGURE_MODE" != true ]; then
    echo "  Режим полной переустановки: удаление GitLab..."
    if is_service_installed "gitlab-runsvdir" || is_service_running "gitlab-runsvdir"; then
        echo "  Остановка GitLab..."
        gitlab-ctl stop 2>/dev/null || systemctl stop gitlab-runsvdir 2>/dev/null || true
        sleep 5
    fi
    
    if is_package_installed "gitlab-ce"; then
        echo "  Удаление GitLab CE..."
        apt-get remove --purge -y gitlab-ce
        apt-get autoremove -y
    fi
    
    # Удаление данных GitLab (опционально, с подтверждением)
    if [ -d "/etc/gitlab" ] || [ -d "/var/opt/gitlab" ]; then
        echo ""
        echo "  ВНИМАНИЕ: Будут удалены все данные GitLab!"
        echo "  Это включает:"
        echo "    - /etc/gitlab (конфигурация)"
        echo "    - /var/opt/gitlab (данные приложения)"
        echo "    - /var/log/gitlab (логи)"
        read -p "  Удалить все данные GitLab? (y/n): " REMOVE_DATA
        if [ "$REMOVE_DATA" = "y" ] || [ "$REMOVE_DATA" = "Y" ]; then
            echo "  Удаление данных GitLab..."
            rm -rf /etc/gitlab
            rm -rf /var/opt/gitlab
            rm -rf /var/log/gitlab
            echo "  Данные удалены"
        else
            echo "  Данные сохранены, будет выполнена переустановка пакета"
        fi
    fi
    
    # Удаление репозитория если нужно
    if [ -f /etc/apt/sources.list.d/gitlab_gitlab-ce.list ]; then
        rm -f /etc/apt/sources.list.d/gitlab_gitlab-ce.list
    fi
    apt-get update
elif is_package_installed "gitlab-ce" || is_service_installed "gitlab-runsvdir"; then
    if [ "$RECONFIGURE_MODE" != true ]; then
        echo "  [Пропуск] GitLab уже установлен"
        if is_service_running "gitlab-runsvdir"; then
            echo "  [OK] GitLab запущен"
        else
            echo "  [Предупреждение] GitLab установлен, но не запущен"
            echo "  Запуск сервиса..."
            gitlab-ctl start 2>/dev/null || systemctl start gitlab-runsvdir 2>/dev/null || true
        fi
        echo ""
        echo "  Для переконфигурирования используйте: $0 <domain> <email> --reconfigure"
        exit 0
    fi
    # В режиме reconfigure продолжаем выполнение
fi

# Проверка системных требований
echo "[1/7] Проверка системных требований..."
TOTAL_RAM=$(free -g | awk '/^Mem:/{print $2}')
TOTAL_CPU=$(nproc)

echo "  RAM: ${TOTAL_RAM}GB (требуется минимум 4GB)"
echo "  CPU: ${TOTAL_CPU} (требуется минимум 4)"

# Примечание: GitLab CE не требует системного Node.js
# GitLab включает свою собственную версию Node.js для компиляции фронтенда
# Если на системе установлен Node.js 20.x (для n8n и management-ui), это не конфликтует с GitLab

if [ "$TOTAL_RAM" -lt 4 ]; then
    echo "Предупреждение: Рекомендуется минимум 4GB RAM для GitLab"
    read -p "Продолжить? (y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
        exit 1
    fi
fi

if [ "$SKIP_INSTALL" != true ]; then
    # Обновление системы
    echo ""
    echo "[2/7] Обновление системы..."
    export DEBIAN_FRONTEND=noninteractive
    apt-get update
    apt-get upgrade -y

    # Установка зависимостей
    echo ""
    echo "[3/7] Установка зависимостей..."
    apt-get install -y curl openssh-server ca-certificates tzdata perl

    # Настройка firewall (GitLab будет доступен только через Traefik на localhost)
    echo ""
    echo "[4/7] Настройка firewall..."
    if command -v ufw &> /dev/null; then
        ufw allow 22/tcp
        # GitLab доступен только на localhost
        ufw allow from 127.0.0.1 to any port 8888
        ufw --force enable
        echo "Firewall настроен: GitLab доступен только на localhost:8888"
    fi

    # Добавление репозитория GitLab
    echo ""
    echo "[5/7] Добавление репозитория GitLab..."
    if [ ! -f /etc/apt/sources.list.d/gitlab_gitlab-ce.list ] || [ "$FORCE_MODE" = true ]; then
        curl -sS https://packages.gitlab.com/install/repositories/gitlab/gitlab-ce/script.deb.sh | bash
    else
        echo "  [Пропуск] Репозиторий GitLab уже добавлен"
    fi

    # Установка GitLab
    echo ""
    echo "[6/7] Установка GitLab CE (это может занять несколько минут)..."
    if ! is_package_installed "gitlab-ce" || [ "$FORCE_MODE" = true ]; then
        apt-get install -y gitlab-ce
        if [ $? -ne 0 ]; then
            echo "Ошибка: Не удалось установить GitLab"
            exit 1
        fi
    else
        echo "  [Пропуск] GitLab уже установлен"
    fi
else
    echo ""
    echo "[Пропуск] Установка пакета (режим переконфигурирования)"
fi

# Настройка GitLab
echo ""
echo "[7/7] Настройка GitLab..."
GITLAB_CONFIG="/etc/gitlab/gitlab.rb"

# Создание резервной копии
if [ -f "$GITLAB_CONFIG" ]; then
    if [ "$FORCE_MODE" = true ] || [ ! -f "${GITLAB_CONFIG}.backup" ]; then
        cp "$GITLAB_CONFIG" "${GITLAB_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
    fi
else
    echo "Ошибка: Конфигурационный файл GitLab не найден: $GITLAB_CONFIG"
    exit 1
fi

# Настройка external_url
# Важно: используем https, так как Traefik предоставляет SSL
if grep -q "external_url" "$GITLAB_CONFIG"; then
    # Если external_url уже есть, заменяем его только если изменился домен
    CURRENT_URL=$(grep "^external_url" "$GITLAB_CONFIG" | head -1 | sed "s/.*'\(.*\)'.*/\1/")
    if [ "$CURRENT_URL" != "https://${GITLAB_DOMAIN}" ] || [ "$FORCE_MODE" = true ]; then
        sed -i "s|^external_url.*|external_url 'https://${GITLAB_DOMAIN}'|g" "$GITLAB_CONFIG"
    fi
else
    # Если external_url нет, добавляем в начало файла
    sed -i "1i external_url 'https://${GITLAB_DOMAIN}'" "$GITLAB_CONFIG"
fi

# Проверка портов перед настройкой
echo "Проверка доступности портов..."
# Используем порт 8090 для Puma вместо 8080, чтобы избежать конфликтов
PUMA_PORT=8090
NGINX_PORT=8888

# Проверка порта для Puma (8090)
if check_port_in_use "$PUMA_PORT"; then
    OCCUPYING_PID=$(find_process_on_port "$PUMA_PORT")
    if [ -n "$OCCUPYING_PID" ]; then
        PROCESS_NAME=$(get_process_name "$OCCUPYING_PID")
        echo "  [Предупреждение] Порт $PUMA_PORT занят процессом $PROCESS_NAME (PID: $OCCUPYING_PID)"
        if [ "$PROCESS_NAME" != "puma" ] && [ "$PROCESS_NAME" != "gitlab" ] && [ "$PROCESS_NAME" != "ruby" ]; then
            echo "  Это может быть другой процесс. GitLab puma будет использовать этот порт."
            echo "  Рекомендуется остановить процесс или использовать другой порт."
            read -p "  Остановить процесс $PROCESS_NAME (PID: $OCCUPYING_PID)? (y/n): " STOP_PROCESS
            if [ "$STOP_PROCESS" = "y" ] || [ "$STOP_PROCESS" = "Y" ]; then
                kill "$OCCUPYING_PID" 2>/dev/null || true
                sleep 2
                if check_port_in_use "$PUMA_PORT"; then
                    echo "  [ОШИБКА] Не удалось освободить порт $PUMA_PORT"
                    echo "  Попробуйте остановить процесс вручную: kill -9 $OCCUPYING_PID"
                    exit 1
                else
                    echo "  [OK] Порт $PUMA_PORT освобожден"
                fi
            fi
        else
            echo "  [OK] Порт $PUMA_PORT занят GitLab Puma (это нормально)"
        fi
    fi
else
    echo "  [OK] Порт $PUMA_PORT свободен"
fi

# Проверка порта 8888 (nginx)
if check_port_in_use "$NGINX_PORT"; then
    OCCUPYING_PID=$(find_process_on_port "$NGINX_PORT")
    if [ -n "$OCCUPYING_PID" ]; then
        PROCESS_NAME=$(get_process_name "$OCCUPYING_PID")
        if [ "$PROCESS_NAME" = "nginx" ] || [ "$PROCESS_NAME" = "gitlab" ]; then
            echo "  [OK] Порт $NGINX_PORT занят GitLab nginx (это нормально)"
        else
            echo "  [Предупреждение] Порт $NGINX_PORT занят процессом $PROCESS_NAME (PID: $OCCUPYING_PID)"
            echo "  Это может вызвать конфликт с GitLab nginx"
        fi
    fi
else
    echo "  [OK] Порт $NGINX_PORT свободен"
fi

# Настройка для работы за прокси (Traefik на localhost)
# Проверяем, не добавлены ли уже эти настройки
# В режиме reconfigure всегда обновляем конфигурацию
if ! grep -q "nginx\['listen_addresses'\]" "$GITLAB_CONFIG" || [ "$FORCE_MODE" = true ] || [ "$RECONFIGURE_MODE" = true ]; then
    # Удаляем старые настройки если есть
    sed -i '/# Настройки для работы за reverse proxy/,/letsencrypt\['\''enable'\''\] = false/d' "$GITLAB_CONFIG"
    cat >> "$GITLAB_CONFIG" << EOF

# Настройки для работы за reverse proxy (Traefik на localhost)
# Используем порт 8888 вместо 80, чтобы избежать конфликтов с другими сервисами
nginx['listen_port'] = 8888
nginx['listen_https'] = false
nginx['listen_addresses'] = ['127.0.0.1']

# Отключение SSL в nginx (SSL терминируется на Traefik)
nginx['ssl'] = false
nginx['redirect_http_to_https'] = false
nginx['proxy_set_headers'] = {
  "Host" => "\$http_host",
  "X-Real-IP" => "\$remote_addr",
  "X-Forwarded-For" => "\$proxy_add_x_forwarded_for",
  "X-Forwarded-Proto" => "https",
  "X-Forwarded-Ssl" => "on",
  "X-Forwarded-Host" => "\$http_host"
}

# Настройка Puma для работы за прокси
# Puma слушает на localhost:8090 для работы с nginx (изменено с 8080 для избежания конфликтов)
puma['port'] = $PUMA_PORT
puma['listen'] = '127.0.0.1'

# Доверенные прокси (Traefik на localhost)
gitlab_rails['trusted_proxies'] = ['127.0.0.1']

# Отключение встроенного Let's Encrypt (используется Traefik)
letsencrypt['enable'] = false

# Настройка GitLab Pages на отдельном поддомене
# Формируем домен pages: public.<base_domain> (например public.gitlab.dev.borisovai.ru)
gitlab_pages['enable'] = true

# Внутренний сервер GitLab (используем localhost для API запросов)
gitlab_pages['internal_gitlab_server'] = 'http://127.0.0.1:8888'
gitlab_pages['gitlab_server'] = 'https://${GITLAB_DOMAIN}'
pages_external_url 'https://public.${GITLAB_DOMAIN}'

# Pages за reverse proxy (Traefik) - используем listen_proxy
gitlab_pages['listen_proxy'] = '127.0.0.1:8889'
gitlab_pages['external_http'] = []
gitlab_pages['external_https'] = []

# Отключаем встроенный HTTPS и nginx для Pages (SSL на Traefik)
gitlab_pages['https'] = false
pages_nginx['enable'] = false
EOF
    echo "  [OK] Конфигурация GitLab обновлена с настройками для работы за прокси"
fi

# Включение и запуск runsvdir перед применением конфигурации
echo "Запуск GitLab supervisor (runsvdir)..."
if command -v systemctl &> /dev/null; then
    # Включаем автозапуск runsvdir
    systemctl enable gitlab-runsvdir 2>/dev/null || true
    # Запускаем runsvdir если не запущен
    if ! systemctl is-active --quiet gitlab-runsvdir 2>/dev/null; then
        systemctl start gitlab-runsvdir
        sleep 5
        if ! systemctl is-active --quiet gitlab-runsvdir 2>/dev/null; then
            echo "  [Предупреждение] Не удалось запустить gitlab-runsvdir через systemctl"
            echo "  Попытка запуска через gitlab-ctl..."
            /opt/gitlab/bin/gitlab-ctl start 2>/dev/null || true
            sleep 5
        else
            echo "  [OK] gitlab-runsvdir запущен"
        fi
    else
        echo "  [OK] gitlab-runsvdir уже запущен"
    fi
else
    # Если systemctl недоступен, используем gitlab-ctl напрямую
    /opt/gitlab/bin/gitlab-ctl start 2>/dev/null || true
    sleep 5
fi

# Применение конфигурации
echo "Применение конфигурации GitLab (это может занять несколько минут)..."
if [ "$FORCE_MODE" = true ] || [ "$RECONFIGURE_MODE" = true ] || ! grep -q "nginx\['listen_addresses'\]" "$GITLAB_CONFIG" 2>/dev/null; then
    # Применяем конфигурацию, но не выходим с ошибкой если есть проблемы с logrotate
    # Это известная проблема, когда runsvdir еще не полностью запущен
    if gitlab-ctl reconfigure 2>&1 | tee /tmp/gitlab-reconfigure.log; then
        echo "  [OK] Конфигурация GitLab применена успешно"
    else
        RECONFIGURE_EXIT_CODE=$?
        # Проверяем, была ли ошибка только из-за logrotate
        if grep -q "logrotate.*runsv not running" /tmp/gitlab-reconfigure.log || grep -q "runsv not running" /tmp/gitlab-reconfigure.log; then
            echo "  [Предупреждение] Ошибка при запуске некоторых сервисов (runsv не запущен)"
            echo "  Это не критично, GitLab должен работать. Попытка запуска всех сервисов GitLab..."
            /opt/gitlab/bin/gitlab-ctl start 2>/dev/null || true
            sleep 10
            # Повторная попытка запуска runsvdir через systemctl
            if command -v systemctl &> /dev/null; then
                systemctl start gitlab-runsvdir 2>/dev/null || true
                sleep 5
            fi
            echo "  [OK] GitLab сервисы запущены вручную"
        else
            echo "  [ОШИБКА] Не удалось применить конфигурацию GitLab"
            echo "  Проверьте логи: /tmp/gitlab-reconfigure.log"
            exit 1
        fi
    fi
    # Убеждаемся, что все сервисы GitLab запущены
    echo "  Запуск всех сервисов GitLab..."
    /opt/gitlab/bin/gitlab-ctl start 2>/dev/null || true
    sleep 5
else
    echo "  [Пропуск] Конфигурация уже применена"
fi

# Ожидание запуска GitLab
echo ""
echo "Проверка готовности GitLab..."
sleep 10

# Функция проверки статуса сервиса
check_service_status() {
    local service=$1
    gitlab-ctl status "$service" 2>/dev/null | grep -q "ok: run:" && return 0
    return 1
}

# Проверка критических сервисов
echo "  Проверка критических сервисов..."
CRITICAL_SERVICES=("puma" "nginx" "postgresql" "redis" "gitlab-workhorse" "gitlab-pages")
ALL_SERVICES_OK=true

for service in "${CRITICAL_SERVICES[@]}"; do
    if check_service_status "$service"; then
        echo "    [OK] $service запущен"
    else
        echo "    [ОШИБКА] $service не запущен"
        ALL_SERVICES_OK=false
    fi
done

if [ "$ALL_SERVICES_OK" = false ]; then
    echo "  [Предупреждение] Некоторые сервисы не запущены"
    echo "  Полный статус:"
    gitlab-ctl status
    echo ""
    echo "  Попытка запуска всех сервисов..."
    gitlab-ctl start
    sleep 10
    
    # Повторная проверка
    for service in "${CRITICAL_SERVICES[@]}"; do
        if check_service_status "$service"; then
            echo "    [OK] $service запущен после повторной попытки"
        else
            echo "    [ОШИБКА] $service все еще не запущен"
            echo "    Логи $service:"
            gitlab-ctl tail "$service" | tail -20
        fi
    done
fi

# Проверка доступности Puma на порту 8080
echo ""
echo "  Проверка доступности Puma на порту $PUMA_PORT..."
PUMA_READY=false
for i in {1..15}; do
    if check_port_in_use "$PUMA_PORT"; then
        OCCUPYING_PID=$(find_process_on_port "$PUMA_PORT")
        PROCESS_NAME=$(get_process_name "$OCCUPYING_PID")
        if [ "$PROCESS_NAME" = "puma" ] || [ "$PROCESS_NAME" = "ruby" ]; then
            echo "    [OK] Puma слушает на порту $PUMA_PORT"
            PUMA_READY=true
            break
        fi
    fi
    if [ $i -eq 5 ] || [ $i -eq 10 ]; then
        echo "    Ожидание запуска Puma... ($i/15)"
        if check_service_status "puma"; then
            echo "    Статус Puma: OK"
        else
            echo "    Статус Puma: не запущен"
            echo "    Последние логи Puma:"
            gitlab-ctl tail puma 2>/dev/null | tail -10 || true
        fi
    fi
    sleep 2
done

if [ "$PUMA_READY" = false ]; then
    echo "    [ОШИБКА] Puma не запустился на порту $PUMA_PORT"
    echo "    Проверьте логи: gitlab-ctl tail puma"
    echo "    Проверьте конфигурацию: grep -i puma /etc/gitlab/gitlab.rb"
fi

# Проверка доступности Nginx на порту 8888
echo ""
echo "  Проверка доступности Nginx на порту $NGINX_PORT..."
NGINX_READY=false
for i in {1..15}; do
    if check_port_in_use "$NGINX_PORT"; then
        OCCUPYING_PID=$(find_process_on_port "$NGINX_PORT")
        PROCESS_NAME=$(get_process_name "$OCCUPYING_PID")
        if [ "$PROCESS_NAME" = "nginx" ] || [ "$PROCESS_NAME" = "gitlab" ]; then
            echo "    [OK] Nginx слушает на порту $NGINX_PORT"
            NGINX_READY=true
            break
        fi
    fi
    if [ $i -eq 5 ] || [ $i -eq 10 ]; then
        echo "    Ожидание запуска Nginx... ($i/15)"
        if check_service_status "nginx"; then
            echo "    Статус Nginx: OK"
        else
            echo "    Статус Nginx: не запущен"
        fi
    fi
    sleep 2
done

if [ "$NGINX_READY" = false ]; then
    echo "    [ОШИБКА] Nginx не запустился на порту $NGINX_PORT"
    echo "    Проверьте логи: gitlab-ctl tail nginx"
fi

# Проверка доступности веб-интерфейса
echo ""
echo "  Проверка доступности веб-интерфейса GitLab..."
GITLAB_READY=false
for i in {1..30}; do
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8888 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "301" ]; then
        echo "    [OK] GitLab доступен на http://127.0.0.1:8888 (HTTP код: $HTTP_CODE)"
        GITLAB_READY=true
        break
    elif [ "$HTTP_CODE" = "502" ]; then
        if [ $i -eq 10 ] || [ $i -eq 20 ]; then
            echo "    [Предупреждение] Получен HTTP 502 (Bad Gateway) на попытке $i"
            echo "    Это означает, что Nginx не может подключиться к Puma"
            echo "    Проверка статуса сервисов:"
            gitlab-ctl status puma nginx | head -10
            echo "    Проверка портов:"
            echo "      Puma ($PUMA_PORT): $(check_port_in_use "$PUMA_PORT" && echo "занят" || echo "свободен")"
            echo "      Nginx ($NGINX_PORT): $(check_port_in_use "$NGINX_PORT" && echo "занят" || echo "свободен")"
        fi
    fi
    if [ $i -eq 10 ] || [ $i -eq 20 ]; then
        echo "    Ожидание... ($i/30, HTTP код: $HTTP_CODE)"
    fi
    sleep 2
done

if [ "$GITLAB_READY" = false ]; then
    echo "    [ОШИБКА] GitLab не отвечает на http://127.0.0.1:8888"
    echo ""
    echo "  Диагностика:"
    echo "    Статус всех сервисов:"
    gitlab-ctl status
    echo ""
    echo "    Проверка портов:"
    echo "      Puma ($PUMA_PORT): $(check_port_in_use "$PUMA_PORT" && echo "занят" || echo "свободен")"
    echo "      Nginx ($NGINX_PORT): $(check_port_in_use "$NGINX_PORT" && echo "занят" || echo "свободен")"
    echo ""
    echo "    Последние логи Puma:"
    gitlab-ctl tail puma 2>/dev/null | tail -20 || echo "      Не удалось получить логи Puma"
    echo ""
    echo "    Последние логи Nginx:"
    gitlab-ctl tail nginx 2>/dev/null | tail -20 || echo "      Не удалось получить логи Nginx"
    echo ""
    echo "  Попытка перезапуска GitLab..."
    gitlab-ctl restart
    sleep 15
    
    # Повторная проверка после перезапуска
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8888 2>/dev/null || echo "000")
    if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "302" ] || [ "$HTTP_CODE" = "301" ]; then
        echo "  [OK] GitLab доступен после перезапуска (HTTP код: $HTTP_CODE)"
        GITLAB_READY=true
    else
        echo "  [ОШИБКА] GitLab все еще недоступен после перезапуска (HTTP код: $HTTP_CODE)"
        echo "  Проверьте конфигурацию и логи вручную"
    fi
fi

# Создание DNS записей для GitLab
echo ""
echo "Создание DNS записей для GitLab..."
if [ -n "$GITLAB_DOMAIN" ]; then
    if [ -n "$(get_config_value "base_domains")" ]; then
        GITLAB_PREFIX=$(get_config_value "gitlab_prefix")
        [ -z "$GITLAB_PREFIX" ] && GITLAB_PREFIX="gitlab"
        create_dns_records_for_domains "$GITLAB_PREFIX"
    elif command -v manage-dns &> /dev/null; then
        SERVER_IP=$(curl -s ifconfig.me || curl -s ifconfig.co || hostname -I | awk '{print $1}')
        CLEAN_DOMAIN=$(echo "$GITLAB_DOMAIN" | sed 's|^https\?://||')
        if [ -n "$SERVER_IP" ] && echo "$CLEAN_DOMAIN" | grep -q '\.'; then
            SUBDOMAIN=$(echo "$CLEAN_DOMAIN" | cut -d'.' -f1)
            DOMAIN=$(echo "$CLEAN_DOMAIN" | cut -d'.' -f2-)
            if [ -n "$SUBDOMAIN" ] && [ -n "$DOMAIN" ]; then
                echo "  Создание DNS записи: $SUBDOMAIN.$DOMAIN -> $SERVER_IP"
                manage-dns create "$SUBDOMAIN" "$SERVER_IP" 2>/dev/null || echo "  [Предупреждение] Не удалось создать DNS запись"
            fi
        fi
    else
        echo "  [Предупреждение] Скрипт manage-dns не найден, создайте DNS запись вручную для $GITLAB_DOMAIN"
    fi
fi

# Получение начального пароля
echo ""
echo "=== Установка GitLab завершена! ==="
echo ""
INITIAL_PASSWORD=$(grep 'Password:' /etc/gitlab/initial_root_password 2>/dev/null | cut -d' ' -f2- || echo "Пароль не найден в /etc/gitlab/initial_root_password")

echo "Важная информация:"
echo "  - Домен: https://${GITLAB_DOMAIN}"
echo "  - Доступен на: http://127.0.0.1:8888 (только localhost)"
echo ""
echo "Начальный пароль root:"
echo "  ${INITIAL_PASSWORD}"
echo ""
echo "ВАЖНО: Сохраните этот пароль! Он понадобится при первом входе."
echo ""
echo "Проверка доступности GitLab:"
echo "  curl http://127.0.0.1:8888"
echo ""
echo "Проверка конфигурации Traefik:"
echo "  Убедитесь, что Traefik настроен для GitLab:"
echo "    sudo cat /etc/traefik/dynamic/gitlab.yml"
echo "  Если конфигурация отсутствует, запустите:"
if [ -n "$(get_config_value "base_domains")" ]; then
echo "    sudo $SCRIPT_DIR/configure-traefik.sh   # использует base_domains"
else
echo "    sudo $SCRIPT_DIR/configure-traefik.sh $GITLAB_DOMAIN <n8n-domain> <ui-domain>"
fi
echo ""
echo "Проверка DNS записи:"
echo "  nslookup ${GITLAB_DOMAIN}"
echo "  dig ${GITLAB_DOMAIN}"
echo ""
echo "Проверка статуса сервисов:"
echo "  gitlab-ctl status"
echo "  systemctl status traefik"
echo ""
echo "GitLab Pages:"
echo "  Pages включены и настроены на: https://public.${GITLAB_DOMAIN}"
echo "  Для использования Pages:"
echo "    1. Создайте репозиторий с .gitlab-ci.yml"
echo "    2. Добавьте job с артефактами в папку public/"
echo "    3. Страницы будут доступны по адресу: https://public.${GITLAB_DOMAIN}/<namespace>/<project>"
echo ""
echo "  Не забудьте:"
echo "    1. Добавить DNS запись для public.${GITLAB_DOMAIN}"
echo "    2. Настроить Traefik: sudo $SCRIPT_DIR/configure-traefik.sh --force"
echo ""
echo "  Если Pages не работают, проверьте:"
echo "    gitlab-ctl status gitlab-pages"
echo "    gitlab-ctl tail gitlab-pages"
echo ""
echo "  Для изменения домена Pages отредактируйте /etc/gitlab/gitlab.rb:"
echo "    pages_external_url 'https://pages.example.com'"
echo "  И выполните:"
echo "    sudo gitlab-ctl reconfigure"
echo "    sudo gitlab-ctl restart gitlab-pages"
echo ""