#!/bin/bash
# Установка Mailu Mail Server (Traefik, systemd, UFW, DNS).
# Конфиг: при отсутствии docker-compose.yml и mailu.env создаётся из официальных шаблонов
#   (https://setup.mailu.io, setup/flavors/compose). Иначе используются файлы в /opt/mailu.
# Использование: sudo ./install-mailu.sh <mail-domain> <letsencrypt-email> [--force]
#   --force: переустановка (остановка сервиса, docker compose down, опционально удаление директории)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAILU_DIR="/opt/mailu"
MAILU_SERVICE="mailu.service"

if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Предупреждение: common.sh не найден"
fi

set +e

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите с правами root (sudo)"
    exit 1
fi

print_setup_mailu_instructions() {
    echo ""
    echo "Альтернатива: создайте конфиг через официальный мастер https://setup.mailu.io"
    echo "  (Webmail: Roundcube, за reverse proxy, порты 6555/6554), скачайте"
    echo "  docker-compose.yml и mailu.env, положите в $MAILU_DIR и запустите скрипт снова."
    echo ""
}

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

show_port_usage() {
    local port=$1
    if command -v ss &> /dev/null; then
        ss -tlnp 2>/dev/null | grep ":$port " || true
    elif command -v netstat &> /dev/null; then
        netstat -tlnp 2>/dev/null | grep ":$port " || true
    elif command -v lsof &> /dev/null; then
        lsof -i :$port 2>/dev/null | grep LISTEN || true
    fi
}

# Обработка аргументов
MAIL_DOMAIN=""
LETSENCRYPT_EMAIL=""
FORCE_MODE=false
CALENDAR_MODE=false
ADD_CALENDAR_MODE=false
ADD_CALENDAR_DIR=""

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
        --calendar)
            CALENDAR_MODE=true
            ;;
        --add-calendar)
            ADD_CALENDAR_MODE=true
            ;;
        --help|-h)
            echo "Использование: $0 <mail-domain> <letsencrypt-email> [--force] [--calendar] | $0 --add-calendar [mailu-dir]"
            echo ""
            echo "Конфиг: при отсутствии файлов создаётся из шаблонов Mailu; иначе — из /opt/mailu."
            echo ""
            echo "Параметры:"
            echo "  mail-domain       - Хост веб-интерфейса почты (например, mail.dev.borisovai.ru)"
            echo "  letsencrypt-email - Email для Let's Encrypt сертификатов"
            echo "  --force           - Переустановка (остановка, docker compose down, опционально удаление /opt/mailu)"
            echo "  --calendar        - При новой установке: включить CalDAV/CardDAV (календарь и контакты)"
            echo "  --add-calendar    - Добавить календарь в уже установленный Mailu (mailu-dir по умолчанию /opt/mailu)"
            echo ""
            echo "Примеры:"
            echo "  sudo $0 mail.dev.borisovai.ru admin@borisovai.ru"
            echo "  sudo $0 mail.dev.borisovai.ru admin@borisovai.ru --calendar  # Новая установка с календарём"
            echo "  sudo $0 --add-calendar   # Добавить календарь в установленный Mailu"
            echo "  sudo $0 --add-calendar /opt/mailu"
            echo "  sudo $0 mail.dev.borisovai.ru admin@borisovai.ru --force  # Переустановка"
            exit 0
            ;;
        *)
            if [ "$ADD_CALENDAR_MODE" = true ] && [ -z "$ADD_CALENDAR_DIR" ] && [ "$arg" != "--force" ] && [ "$arg" != "--calendar" ]; then
                ADD_CALENDAR_DIR="$arg"
            elif [ -z "$MAIL_DOMAIN" ]; then
                MAIL_DOMAIN="$arg"
            elif [ -z "$LETSENCRYPT_EMAIL" ]; then
                LETSENCRYPT_EMAIL="$arg"
            fi
            ;;
    esac
done

if [ "$ADD_CALENDAR_MODE" = true ]; then
    ADD_SCRIPT="$SCRIPT_DIR/add-mailu-calendar.sh"
    if [ ! -x "$ADD_SCRIPT" ]; then
        echo "Ошибка: не найден или не исполняем $ADD_SCRIPT"
        exit 1
    fi
    exec "$ADD_SCRIPT" "${ADD_CALENDAR_DIR:-/opt/mailu}"
fi

echo "=== Установка Mailu Mail Server ==="
echo ""

# Получение параметров если не переданы
MAIL_HOSTNAMES=""
if [ -z "$MAIL_DOMAIN" ]; then
    if [ -n "$(get_config_value "base_domains")" ]; then
        MAIL_PREFIX=$(get_config_value "mail_prefix")
        [ -z "$MAIL_PREFIX" ] && MAIL_PREFIX="mail"
        MAIL_MIDDLE=$(get_config_value "mail_middle")
        save_config_value "mail_prefix" "$MAIL_PREFIX"
        MAIL_DOMAIN=$(build_service_domains "$MAIL_PREFIX" "$MAIL_MIDDLE" | head -1)
        MAIL_HOSTNAMES=$(build_service_domains "$MAIL_PREFIX" "$MAIL_MIDDLE" | tr '\n' ',' | sed 's/,$//')
        if [ -z "$MAIL_DOMAIN" ]; then
            echo "Ошибка: Не удалось получить домен из base_domains"
            exit 1
        fi
        echo "Используются базовые домены, основной домен почты: $MAIL_DOMAIN"
    else
        MAIL_DOMAIN=$(get_config_value "mail_domain")
        if [ -z "$MAIL_DOMAIN" ]; then
            MAIL_DOMAIN=$(prompt_and_save "mail_domain" "Хост веб-интерфейса почты (например, mail.dev.borisovai.ru)" "mail.dev.borisovai.ru")
            if [ -z "$MAIL_DOMAIN" ]; then
                echo "Ошибка: Домен обязателен"
                exit 1
            fi
        else
            echo "Используется сохраненный домен: $MAIL_DOMAIN"
        fi
    fi
fi

# Проверка валидности домена
if [ "$MAIL_DOMAIN" = "--help" ] || [ "$MAIL_DOMAIN" = "-h" ] || [ "$MAIL_DOMAIN" = "--force" ]; then
    echo "Ошибка: Неверный домен: $MAIL_DOMAIN"
    echo "Использование: $0 <mail-domain> <letsencrypt-email> [--force]"
    exit 1
fi

# Базовая проверка формата домена
if ! echo "$MAIL_DOMAIN" | grep -qE '^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)+$'; then
    echo "Предупреждение: Домен '$MAIL_DOMAIN' может быть некорректным"
    read -p "Продолжить? (y/n): " CONTINUE_DOMAIN
    if [ "$CONTINUE_DOMAIN" != "y" ] && [ "$CONTINUE_DOMAIN" != "Y" ]; then
        exit 1
    fi
fi

if [ -z "$LETSENCRYPT_EMAIL" ]; then
    LETSENCRYPT_EMAIL=$(get_config_value "letsencrypt_email")
    if [ -z "$LETSENCRYPT_EMAIL" ]; then
        LETSENCRYPT_EMAIL=$(prompt_and_save "letsencrypt_email" "Email для Let's Encrypt")
        if [ -z "$LETSENCRYPT_EMAIL" ]; then
            echo "Ошибка: Email обязателен для Let's Encrypt"
            exit 1
        fi
    else
        echo "Используется сохраненный email: $LETSENCRYPT_EMAIL"
    fi
fi

# Почтовый домен (для адресов user@borisovai.ru). Хост веб-интерфейса = MAIL_DOMAIN (mail.dev.borisovai.ru)
if echo "$MAIL_DOMAIN" | grep -qE '^mail\.dev\.'; then
    BASE_DOMAIN=$(echo "$MAIL_DOMAIN" | sed 's/^mail\.dev\.//')
else
    BASE_DOMAIN=$(echo "$MAIL_DOMAIN" | sed 's/^[^.]*\.//')
fi
echo "  Почтовый домен (адреса): $BASE_DOMAIN, веб-интерфейс: https://$MAIL_DOMAIN"
MAILU_HTTP_PORT=6555
MAILU_HTTPS_PORT=6554

# Переустановка при --force (до проверки compose+env)
if [ "$FORCE_MODE" = true ]; then
    if [ -d "$MAILU_DIR" ] && is_service_installed "$MAILU_SERVICE"; then
        echo "  [Пропуск] Mailu уже установлен"
        if is_service_running "$MAILU_SERVICE"; then
            echo "  [OK] Mailu запущен"
        else
            echo "  [Предупреждение] Mailu установлен, но не запущен"
            echo "  Запуск сервиса..."
            systemctl start "$MAILU_SERVICE"
        fi
        exit 0
    fi
fi

# Переустановка при --force
if [ "$FORCE_MODE" = true ]; then
    if [ -d "$MAILU_DIR" ] || is_service_installed "$MAILU_SERVICE"; then
        echo ""
        echo "=== Режим переустановки (--force) ==="
        echo ""
        echo "Остановка и удаление существующей установки Mailu..."
        
        # Остановка сервиса
        if systemctl is-active --quiet "$MAILU_SERVICE" 2>/dev/null; then
            echo "  Остановка сервиса $MAILU_SERVICE..."
            systemctl stop "$MAILU_SERVICE" 2>/dev/null || true
            sleep 2
        fi
        
        # Отключение сервиса
        if systemctl is-enabled --quiet "$MAILU_SERVICE" 2>/dev/null; then
            echo "  Отключение сервиса $MAILU_SERVICE..."
            systemctl disable "$MAILU_SERVICE" 2>/dev/null || true
        fi
        
        # Удаление Docker контейнеров и volumes
        if [ -d "$MAILU_DIR" ] && [ -f "$MAILU_DIR/docker-compose.yml" ]; then
            echo "  Остановка Docker контейнеров..."
            (cd "$MAILU_DIR" && (docker compose -f docker-compose.yml --env-file mailu.env stop 2>/dev/null || docker-compose -f docker-compose.yml --env-file mailu.env stop 2>/dev/null || true))
            sleep 2
            (cd "$MAILU_DIR" && (docker compose -f docker-compose.yml --env-file mailu.env down -v --remove-orphans 2>/dev/null || docker-compose -f docker-compose.yml --env-file mailu.env down -v --remove-orphans 2>/dev/null || true))
            if docker network inspect mailu_default &>/dev/null; then
                _ids=$(docker ps -aq --filter network=mailu_default 2>/dev/null)
                [ -n "$_ids" ] && docker rm -f $_ids 2>/dev/null || true
                docker network rm mailu_default 2>/dev/null || true
            fi
        fi
        
        # Удаление systemd unit файла
        if [ -f "/etc/systemd/system/$MAILU_SERVICE" ]; then
            echo "  Удаление systemd unit файла..."
            rm -f "/etc/systemd/system/$MAILU_SERVICE" 2>/dev/null || true
            systemctl daemon-reload
        fi
        
        # Удаление директории (опционально)
        echo ""
        read -p "  Удалить директорию $MAILU_DIR? (y/n, по умолчанию n): " REMOVE_DIR
        if [ "$REMOVE_DIR" = "y" ] || [ "$REMOVE_DIR" = "Y" ]; then
            echo "  Удаление директории $MAILU_DIR..."
            rm -rf "$MAILU_DIR" 2>/dev/null || true
            echo "  [OK] Директория удалена"
            echo ""
            echo "Запустите скрипт снова — конфиг будет создан из официальных шаблонов Mailu."
            exit 1
        else
            echo "  [Пропуск] Директория сохранена"
        fi
        echo ""
        echo "  [OK] Старая установка удалена"
        echo ""
    fi
fi

# Генерация конфигурации из официальных шаблонов Mailu, если файлов нет
if [ ! -f "$MAILU_DIR/docker-compose.yml" ] || [ ! -f "$MAILU_DIR/mailu.env" ]; then
    echo "  [Генерация] docker-compose.yml и mailu.env отсутствуют — создаём из официальных шаблонов Mailu (setup.mailu.io)."
    if [ "$CALENDAR_MODE" != true ]; then
        read -p "  Включить календарь и контакты (CalDAV/CardDAV)? (y/n) [n]: " ENABLE_CALENDAR
        if [ "$ENABLE_CALENDAR" = "y" ] || [ "$ENABLE_CALENDAR" = "Y" ]; then
            CALENDAR_MODE=true
        fi
    fi
    mkdir -p "$MAILU_DIR"
    if ! command -v python3 &>/dev/null; then
        echo "  Установка python3..."
        export DEBIAN_FRONTEND=noninteractive
        apt-get update -qq && apt-get install -y -qq python3 python3-venv >/dev/null 2>&1
    fi
    if ! python3 -c "import jinja2" 2>/dev/null; then
        echo "  Установка python3-jinja2..."
        apt-get update -qq && apt-get install -y -qq python3-jinja2 >/dev/null 2>&1
    fi
    if ! python3 -c "import jinja2" 2>/dev/null; then
        echo "Ошибка: не удалось установить python3-jinja2. Установите вручную: apt-get install python3-jinja2"
        print_setup_mailu_instructions
        exit 1
    fi
    RENDERER="$SCRIPT_DIR/mailu-setup-render.py"
    if [ ! -f "$RENDERER" ]; then
        echo "Ошибка: не найден $RENDERER"
        print_setup_mailu_instructions
        exit 1
    fi
    HOSTNAMES_FOR_MAILU="${MAIL_HOSTNAMES:-$MAIL_DOMAIN}"
    RENDER_ARGS="--domain $BASE_DOMAIN --hostnames $HOSTNAMES_FOR_MAILU --postmaster admin --root $MAILU_DIR --tls-flavor mail-letsencrypt --http-port $MAILU_HTTP_PORT --https-port $MAILU_HTTPS_PORT --initial-admin-account admin"
    [ "$CALENDAR_MODE" = true ] && RENDER_ARGS="$RENDER_ARGS --webdav"
    if ! python3 "$RENDERER" $RENDER_ARGS; then
        echo "Ошибка генерации конфигурации Mailu"
        print_setup_mailu_instructions
        exit 1
    fi
    echo "  [OK] Конфигурация создана из официальных шаблонов"
    if [ "$CALENDAR_MODE" = true ]; then
        echo "  [OK] CalDAV/CardDAV (календарь и контакты) включены"
        if grep -q 'webdav:' "$MAILU_DIR/docker-compose.yml" && ! grep -A 25 '^  webdav:' "$MAILU_DIR/docker-compose.yml" | head -26 | grep -q 'depends_on:'; then
            awk 'BEGIN{added=0} /^  webdav:/{w=1;has_dep=0} w&&/depends_on:/{has_dep=1} w&&/^  [a-zA-Z][a-zA-Z0-9]*:/&&!/^  webdav/{w=0} w&&/dav:\/data/&&!has_dep&&!added{print;print "    depends_on:";print "      - front";added=1;next} {print}' "$MAILU_DIR/docker-compose.yml" > "$MAILU_DIR/docker-compose.yml.tmp" && mv "$MAILU_DIR/docker-compose.yml.tmp" "$MAILU_DIR/docker-compose.yml"
            echo "  [OK] Патч webdav (depends_on: front) применён"
        fi
    fi
fi

mkdir -p "$MAILU_DIR"/{data,dkim,certs,redis,filter,mail,mailqueue,webmail,dav}
mkdir -p "$MAILU_DIR/overrides"/{nginx,dovecot,postfix,rspamd,roundcube}

# Пропуск если уже установлен (и не --force)
if [ "$FORCE_MODE" != true ]; then
    if [ -d "$MAILU_DIR" ] && is_service_installed "$MAILU_SERVICE" 2>/dev/null; then
        echo "  [Пропуск] Mailu уже установлен"
        if is_service_running "$MAILU_SERVICE" 2>/dev/null; then
            echo "  [OK] Mailu запущен"
        else
            echo "  Запуск сервиса..."
            systemctl start "$MAILU_SERVICE" 2>/dev/null || true
        fi
        exit 0
    fi
fi

# Проверка конфликтов портов
echo "[Проверка] Проверка портов..."
MAIL_PORTS=(25 587 465 143 993)
CONFLICTS_FOUND=0

for port in "${MAIL_PORTS[@]}"; do
    if check_port_in_use "$port"; then
        echo "  [КОНФЛИКТ] Порт $port уже используется:"
        show_port_usage "$port" | sed 's/^/    /'
        CONFLICTS_FOUND=1
    fi
done

if [ $CONFLICTS_FOUND -eq 1 ]; then
    echo ""
    echo "ВНИМАНИЕ: Обнаружены конфликты портов!"
    echo "Возможно, уже установлен другой почтовый сервер"
    read -p "Продолжить установку? (y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
        exit 1
    fi
fi

# Проверка портов для HTTP/HTTPS (localhost, Traefik проксирует; админка и webmail на 6555/6554)
if check_port_in_use "$MAILU_HTTP_PORT"; then
    echo "  [КОНФЛИКТ] Порт $MAILU_HTTP_PORT уже используется:"
    show_port_usage "$MAILU_HTTP_PORT" | sed 's/^/    /'
    read -p "  Продолжить установку? (y/n): " CONTINUE_PORT
    if [ "$CONTINUE_PORT" != "y" ] && [ "$CONTINUE_PORT" != "Y" ]; then
        exit 1
    fi
else
    echo "  [OK] Порт $MAILU_HTTP_PORT свободен"
fi

# Обновление пакетов
echo ""
echo "[1/7] Обновление пакетов..."
export DEBIAN_FRONTEND=noninteractive
apt-get update

# Установка Docker
echo ""
echo "[2/7] Установка Docker..."
if ! command -v docker &> /dev/null; then
    echo "  Установка Docker..."
    curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
    sh /tmp/get-docker.sh
    systemctl enable docker
    systemctl start docker
    echo "  [OK] Docker установлен"
else
    echo "  [Пропуск] Docker уже установлен: $(docker --version)"
fi

# Установка Docker Compose
echo ""
echo "[3/7] Установка Docker Compose..."
if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
    echo "  Установка Docker Compose..."
    DOCKER_COMPOSE_VERSION="v2.24.0"
    curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    chmod +x /usr/local/bin/docker-compose
    echo "  [OK] Docker Compose установлен"
else
    if docker compose version &> /dev/null; then
        echo "  [Пропуск] Docker Compose уже установлен (плагин): $(docker compose version)"
    else
        echo "  [Пропуск] Docker Compose уже установлен: $(docker-compose --version)"
    fi
fi

# Патч портов front для Traefik (6555/6554) — только 80/443 на localhost
echo ""
echo "[4/7] Настройка портов front для Traefik..."
if grep -q "front:" "$MAILU_DIR/docker-compose.yml"; then
    if grep -q "127.0.0.1:$MAILU_HTTP_PORT:80\|127.0.0.1:$MAILU_HTTPS_PORT:443" "$MAILU_DIR/docker-compose.yml"; then
        echo "  [Пропуск] Порты уже 6555/6554"
    else
        sed -i 's|"\${BIND_ADDRESS4}:80:80"|"127.0.0.1:'"$MAILU_HTTP_PORT"':80"|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|"\${BIND_ADDRESS4}:443:443"|"127.0.0.1:'"$MAILU_HTTPS_PORT"':443"|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|"\${BIND_ADDRESS6}:80:80"|"[::1]:'"$MAILU_HTTP_PORT"':80"|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|"\${BIND_ADDRESS6}:443:443"|"[::1]:'"$MAILU_HTTPS_PORT"':443"|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|- "0\.0\.0\.0:80:80"|- "127.0.0.1:'"$MAILU_HTTP_PORT"':80"|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|- "\[::\]:80:80"|- "[::1]:'"$MAILU_HTTP_PORT"':80"|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|- "0\.0\.0\.0:443:443"|- "127.0.0.1:'"$MAILU_HTTPS_PORT"':443"|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|- "\[::\]:443:443"|- "[::1]:'"$MAILU_HTTPS_PORT"':443"|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|- "80:80"|- "127.0.0.1:'"$MAILU_HTTP_PORT"':80"|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|- "443:443"|- "127.0.0.1:'"$MAILU_HTTPS_PORT"':443"|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|- 80:80|- 127.0.0.1:'"$MAILU_HTTP_PORT"':80|g' "$MAILU_DIR/docker-compose.yml"
        sed -i 's|- 443:443|- 127.0.0.1:'"$MAILU_HTTPS_PORT"':443|g' "$MAILU_DIR/docker-compose.yml"
        echo "  [OK] Порты front: 127.0.0.1:$MAILU_HTTP_PORT (HTTP), $MAILU_HTTPS_PORT (HTTPS)"
    fi
else
    echo "  [Пропуск] Сервис front не найден в compose"
fi

# Создание systemd service
echo ""
echo "[5/7] Создание systemd service..."
if [ "$FORCE_MODE" = true ] || [ ! -f "/etc/systemd/system/$MAILU_SERVICE" ]; then
    COMPOSE_CMD='docker compose -f '"$MAILU_DIR"'/docker-compose.yml --env-file '"$MAILU_DIR"'/mailu.env'
    if command -v docker-compose &> /dev/null; then
        COMPOSE_CMD='docker-compose -f '"$MAILU_DIR"'/docker-compose.yml --env-file '"$MAILU_DIR"'/mailu.env'
    fi
    cat > "/etc/systemd/system/$MAILU_SERVICE" << EOF
[Unit]
Description=Mailu Mail Server
Requires=docker.service
After=docker.service network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$MAILU_DIR
TimeoutStartSec=600
ExecStartPre=/bin/sleep 5
ExecStart=/usr/bin/bash -c '${COMPOSE_CMD} up -d'
ExecStop=/usr/bin/bash -c '${COMPOSE_CMD} down'
ExecReload=/usr/bin/bash -c '${COMPOSE_CMD} restart'
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF
    
    systemctl daemon-reload
    systemctl enable "$MAILU_SERVICE"
    echo "  [OK] Systemd service создан"
else
    echo "  [Пропуск] Systemd service уже существует"
fi

# Настройка firewall
echo ""
echo "[6/7] Настройка firewall (UFW)..."
if command -v ufw &> /dev/null; then
    for port in "${MAIL_PORTS[@]}"; do
        ufw allow $port/tcp comment "Mailu Mail Server" 2>/dev/null || true
    done
    echo "  [OK] Порты открыты в firewall: ${MAIL_PORTS[*]}"
else
    echo "  [Пропуск] UFW не установлен, настройте firewall вручную"
fi

# Интеграция с Traefik
echo ""
echo "[7/7] Интеграция с Traefik..."
if is_service_installed "traefik.service" || [ -f "/opt/traefik/traefik" ]; then
    DYNAMIC_DIR="/etc/traefik/dynamic"
    mkdir -p "$DYNAMIC_DIR"
    
    MAILU_TRAEFIK_CONFIG="$DYNAMIC_DIR/mailu.yml"
    if [ -n "$(get_config_value "base_domains")" ]; then
        MAIL_PREFIX=$(get_config_value "mail_prefix")
        [ -z "$MAIL_PREFIX" ] && MAIL_PREFIX="mail"
        MAIL_MIDDLE=$(get_config_value "mail_middle")
        MAILU_HOST_RULE=""
        while IFS= read -r full; do
            [ -z "$full" ] && continue
            if [ -n "$MAILU_HOST_RULE" ]; then
                MAILU_HOST_RULE="${MAILU_HOST_RULE} || Host(\`${full}\`)"
            else
                MAILU_HOST_RULE="Host(\`${full}\`)"
            fi
        done < <(build_service_domains "$MAIL_PREFIX" "$MAIL_MIDDLE")
    else
        MAILU_HOST_RULE="Host(\`$MAIL_DOMAIN\`)"
    fi
    
    cat > "$MAILU_TRAEFIK_CONFIG" << EOF
http:
  middlewares:
    mailu-headers:
      headers:
        customRequestHeaders:
          X-Forwarded-Proto: "https"
          X-Forwarded-Port: "443"
          X-Forwarded-Host: "$MAIL_DOMAIN"
        customResponseHeaders:
          X-Forwarded-Proto: "https"
        hostsProxyHeaders:
          - "X-Forwarded-Host"
        sslRedirect: false
        forceSTSHeader: false

    mailu-compress:
      compress:
        excludedContentTypes:
          - "text/event-stream"

  routers:
    mailu-admin:
      rule: "(${MAILU_HOST_RULE}) && PathPrefix(\`/admin\`)"
      service: mailu-front
      entryPoints:
        - websecure
      middlewares:
        - mailu-headers
        - mailu-compress
      tls:
        certResolver: letsencrypt
      priority: 10
    
    mailu-webmail:
      rule: "(${MAILU_HOST_RULE}) && (Path(\`/\`) || PathPrefix(\`/webmail\`))"
      service: mailu-front
      entryPoints:
        - websecure
      middlewares:
        - mailu-headers
        - mailu-compress
      tls:
        certResolver: letsencrypt
      priority: 5

    mailu-catchall:
      rule: "${MAILU_HOST_RULE}"
      service: mailu-front
      entryPoints:
        - websecure
      middlewares:
        - mailu-headers
        - mailu-compress
      tls:
        certResolver: letsencrypt
      priority: 1

  services:
    mailu-front:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: "http://127.0.0.1:$MAILU_HTTP_PORT"
EOF
    
    chmod 644 "$MAILU_TRAEFIK_CONFIG"
    
    # Перезагрузка Traefik если он запущен
    if systemctl is-active --quiet traefik 2>/dev/null; then
        echo "  Перезагрузка Traefik..."
        systemctl reload traefik 2>/dev/null || systemctl restart traefik 2>/dev/null
        echo "  [OK] Traefik обновлен"
    else
        echo "  [Пропуск] Traefik не запущен"
    fi
    
    echo "  [OK] Интеграция с Traefik настроена"
else
    echo "  [Пропуск] Traefik не установлен, интеграция пропущена"
    echo "  После установки Traefik создайте конфигурацию вручную"
fi

# Создание DNS записей для Mailu
echo ""
echo "Создание DNS записей для Mailu..."
if [ -n "$MAIL_DOMAIN" ]; then
    if [ -n "$(get_config_value "base_domains")" ]; then
        MAIL_PREFIX=$(get_config_value "mail_prefix")
        [ -z "$MAIL_PREFIX" ] && MAIL_PREFIX="mail"
        create_dns_records_for_domains "$MAIL_PREFIX"
    elif command -v manage-dns &> /dev/null; then
        SERVER_IP=$(curl -s ifconfig.me || curl -s ifconfig.co || hostname -I | awk '{print $1}')
        CLEAN_DOMAIN=$(echo "$MAIL_DOMAIN" | sed 's|^https\?://||')
        if [ -n "$SERVER_IP" ] && echo "$CLEAN_DOMAIN" | grep -q '\.'; then
            SUBDOMAIN=$(echo "$CLEAN_DOMAIN" | cut -d'.' -f1)
            DOMAIN=$(echo "$CLEAN_DOMAIN" | cut -d'.' -f2-)
            if [ -n "$SUBDOMAIN" ] && [ -n "$DOMAIN" ]; then
                echo "  Создание DNS записи: $SUBDOMAIN.$DOMAIN -> $SERVER_IP"
                manage-dns create "$SUBDOMAIN" "$SERVER_IP" 2>/dev/null || echo "  [Предупреждение] Не удалось создать DNS запись"
            fi
        fi
    else
        echo "  [Предупреждение] Скрипт manage-dns не найден, создайте DNS запись вручную для $MAIL_DOMAIN"
    fi
fi

# Запуск Mailu
echo ""
echo "Запуск Mailu Mail Server..."
systemctl start "$MAILU_SERVICE"

sleep 15

# Проверка создания администратора
echo ""
echo "Проверка создания администратора..."
INITIAL_ADMIN_ACCOUNT=$(grep "^INITIAL_ADMIN_ACCOUNT=" "$MAILU_DIR/mailu.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "admin")
INITIAL_ADMIN_DOMAIN=$(grep "^INITIAL_ADMIN_DOMAIN=" "$MAILU_DIR/mailu.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "$BASE_DOMAIN")
INITIAL_ADMIN_PASSWORD=$(grep "^INITIAL_ADMIN_PASSWORD=" "$MAILU_DIR/mailu.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "")

if [ -n "$INITIAL_ADMIN_PASSWORD" ]; then
    ADMIN_EMAIL="${INITIAL_ADMIN_ACCOUNT}@${INITIAL_ADMIN_DOMAIN}"
    echo "  Проверка существования администратора: $ADMIN_EMAIL"
    
    # Проверка через CLI Mailu (если контейнер admin запущен)
    if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "mailu-admin"; then
        sleep 5
        ADMIN_EXISTS=$(docker exec mailu-admin flask mailu admin "$INITIAL_ADMIN_ACCOUNT" "$INITIAL_ADMIN_DOMAIN" 2>&1 | grep -q "already exists" && echo "yes" || echo "no")
        if [ "$ADMIN_EXISTS" != "yes" ]; then
            echo "  Создание администратора через CLI..."
            docker exec mailu-admin flask mailu admin "$INITIAL_ADMIN_ACCOUNT" "$INITIAL_ADMIN_DOMAIN" "$INITIAL_ADMIN_PASSWORD" 2>/dev/null || true
            sleep 3
        else
            echo "  [OK] Администратор уже существует"
        fi
    else
        echo "  [Предупреждение] Контейнер admin еще не запущен, администратор будет создан при первом запуске"
    fi
fi

if systemctl is-active --quiet "$MAILU_SERVICE"; then
    echo ""
    echo "=== Установка Mailu Mail Server завершена! ==="
    echo ""
    echo "╔════════════════════════════════════════════════════════════════╗"
    echo "║  ВАЖНО: Для доступа к панели управления доменами и           ║"
    echo "║  пользователями вы ДОЛЖНЫ войти как АДМИНИСТРАТОР!            ║"
    echo "║  Обычные пользователи видят только webmail, но не админку.   ║"
    echo "╚════════════════════════════════════════════════════════════════╝"
    echo ""
    echo "Mailu запущен и доступен:"
    echo "  - Веб-админка (локально): http://127.0.0.1:$MAILU_HTTP_PORT/admin"
    if is_service_installed "traefik.service" || [ -f "/opt/traefik/traefik" ]; then
        echo "  - Веб-админка (через Traefik): https://$MAIL_DOMAIN/admin"
        echo "  - Webmail (через Traefik): https://$MAIL_DOMAIN"
        if grep -q 'webdav:' "$MAILU_DIR/docker-compose.yml" 2>/dev/null; then
            echo "  - Календарь и контакты (CalDAV/CardDAV): https://$MAIL_DOMAIN/webdav/.web"
            echo "    (вход: полный email и пароль почтового ящика)"
            echo "  - Полноценный веб-календарь (InfCloud): sudo ./install-mailu-infcloud.sh  — затем https://calendar.$MAIL_DOMAIN"
        fi
    else
        echo "  - Webmail (локально): http://127.0.0.1:$MAILU_HTTP_PORT"
        echo "  Примечание: После установки Traefik настройте проксирование"
    fi
    echo ""
    echo "Почтовые порты:"
    echo "  - SMTP: 25, 587, 465"
    echo "  - IMAP: 143, 993"
    echo ""
    echo "Пароли Mailu:"
    echo "  - Админка: задаётся в mailu.env (INITIAL_ADMIN_ACCOUNT, INITIAL_ADMIN_DOMAIN, INITIAL_ADMIN_PASSWORD)."
    echo "    При автогенерации конфига пароль выведен выше; иначе: grep INITIAL_ADMIN_PASSWORD $MAILU_DIR/mailu.env"
    echo "  - Вход: https://$MAIL_DOMAIN/admin — email admin@$BASE_DOMAIN, пароль из INITIAL_ADMIN_PASSWORD."
    echo "  - Формы «создать админа» при первом входе нет; админ создаётся автоматически при первом старте."
    echo "  - Почтовые ящики: пароль при создании (Mailboxes > Add mailbox)."
    echo ""
    echo "ВАЖНО - Следующие шаги:"
    echo ""
    echo "  КРИТИЧЕСКИ ВАЖНО:"
    echo "  Для доступа к панели управления доменами и пользователями вы ДОЛЖНЫ войти"
    echo "  как АДМИНИСТРАТОР, а не как обычный пользователь!"
    echo ""
    echo "  1. Войдите в веб-админку как АДМИНИСТРАТОР:"
    echo "     URL: https://$MAIL_DOMAIN/admin"
    echo "     Email: admin@$BASE_DOMAIN (или из INITIAL_ADMIN_ACCOUNT@INITIAL_ADMIN_DOMAIN)"
    echo "     Пароль: $(grep "^INITIAL_ADMIN_PASSWORD=" "$MAILU_DIR/mailu.env" 2>/dev/null | cut -d'=' -f2 | tr -d '"' || echo "проверьте в $MAILU_DIR/mailu.env")"
    echo ""
    echo "     Если вы вошли как обычный пользователь, вы увидите только webmail,"
    echo "     но НЕ увидите панель управления доменами и пользователями!"
    echo ""
    echo "  2. Если администратор не создан автоматически, создайте его вручную:"
    echo "     docker exec -it mailu-admin flask mailu admin admin $BASE_DOMAIN 'ВашПароль123'"
    echo ""
    echo "  3. После входа как администратор вы увидите меню:"
    echo "     - Mail domains (управление доменами)"
    echo "     - Mailboxes (управление пользователями)"
    echo "     - Aliases, Resources и другие разделы"
    echo ""
    echo "  4. Создайте домен: Mail domains > Add domain"
    echo "  5. Создайте почтовые ящики: Mailboxes > Add mailbox"
    echo "  6. Добавьте DNS записи (MX, A, SPF, DKIM, DMARC — подсказки в админке):"
    echo "     MX: $BASE_DOMAIN. MX 10 $MAIL_DOMAIN. | A: $MAIL_DOMAIN -> <IP_сервера>"
    echo ""
    echo "Диагностика проблем с админкой:"
    echo "  Если админка не показывает панель управления доменами и пользователями:"
    echo ""
    echo "  1. ПРОВЕРЬТЕ, ЧТО ВЫ ВОШЛИ КАК АДМИНИСТРАТОР:"
    echo "     - Email должен быть: admin@$BASE_DOMAIN (или значение из INITIAL_ADMIN_ACCOUNT@INITIAL_ADMIN_DOMAIN)"
    echo "     - Проверьте пароль: grep INITIAL_ADMIN_PASSWORD $MAILU_DIR/mailu.env"
    echo "     - ВАЖНО: Если вы вошли как обычный пользователь, вы не увидите панель управления!"
    echo ""
    echo "  2. СОЗДАНИЕ АДМИНИСТРАТОРА ВРУЧНУЮ (если не создан автоматически):"
    echo "     docker exec -it mailu-admin flask mailu admin <username> <domain> <password>"
    echo "     Пример: docker exec -it mailu-admin flask mailu admin admin $BASE_DOMAIN 'ВашПароль123'"
    echo ""
    echo "  3. ПРОВЕРКА ПРАВ АДМИНИСТРАТОРА:"
    echo "     docker exec mailu-admin flask mailu admin <username> <domain>"
    echo "     Если пользователь существует, но не является админом, сделайте его админом:"
    echo "     docker exec mailu-admin flask mailu admin <username> <domain> <password> --mode update"
    echo ""
    echo "  4. ПРОВЕРКА КОНТЕЙНЕРОВ:"
    echo "     docker ps | grep mailu"
    echo "     Убедитесь, что контейнеры mailu-admin и mailu-front запущены"
    echo ""
    echo "  5. ПРОВЕРКА КОНФИГУРАЦИИ:"
    echo "     - grep ADMIN_ENABLED $MAILU_DIR/mailu.env (должно быть ADMIN_ENABLED=true)"
    echo "     - cat /etc/traefik/dynamic/mailu.yml"
    echo ""
    echo "  6. ПРОВЕРКА ЛОГОВ:"
    echo "     - docker compose -f $MAILU_DIR/docker-compose.yml logs admin"
    echo "     - docker compose -f $MAILU_DIR/docker-compose.yml logs front"
    echo ""
    echo "  7. ПРОВЕРКА ДОСТУПНОСТИ:"
    echo "     - curl -I http://127.0.0.1:$MAILU_HTTP_PORT/admin"
    echo ""
    echo "  8. ПЕРЕЗАПУСК (если ничего не помогло):"
    echo "     systemctl restart $MAILU_SERVICE"
    echo "     sleep 15"
    echo "     docker exec mailu-admin flask mailu admin admin $BASE_DOMAIN 'ВашПароль'"
    echo ""
    echo "Проверка статуса: systemctl status $MAILU_SERVICE"
    echo "Просмотр логов: docker compose -f $MAILU_DIR/docker-compose.yml logs -f"
    echo "Конфигурация: $MAILU_DIR/mailu.env"
    echo ""
    echo "Проверка администратора:"
    if [ -n "$INITIAL_ADMIN_ACCOUNT" ] && [ -n "$INITIAL_ADMIN_DOMAIN" ]; then
        echo "  docker exec mailu-admin flask mailu admin $INITIAL_ADMIN_ACCOUNT $INITIAL_ADMIN_DOMAIN 2>&1 | head -5"
        echo "  (Если команда выводит информацию о пользователе - администратор существует)"
    fi
else
    echo ""
    echo "Ошибка: Mailu не запустился"
    echo "Проверьте логи: docker compose -f $MAILU_DIR/docker-compose.yml logs"
    echo ""
    echo "Диагностика:"
    echo "  1. Проверьте systemd unit: cat /etc/systemd/system/$MAILU_SERVICE"
    echo "  2. Проверьте Docker: docker ps"
    echo "  3. Проверьте конфигурацию: cat $MAILU_DIR/mailu.env"
    echo "  4. Попробуйте запустить вручную: cd $MAILU_DIR && docker compose -f docker-compose.yml --env-file mailu.env up -d"
    exit 1
fi
