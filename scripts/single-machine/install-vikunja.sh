#!/bin/bash
# Скрипт установки Vikunja (Docker Compose + SQLite)
# Использование: sudo ./install-vikunja.sh [--force]
#
# Устанавливает Vikunja (task planner) на сервер и настраивает:
# - Docker контейнер vikunja (vikunja/vikunja:latest)
# - Конфиг /etc/vikunja/docker-compose.yml
# - Переменные окружения /etc/vikunja/.env
# - SQLite БД в Docker volume vikunja-db
# - Authelia OIDC авторизация
# - SMTP уведомления через Mailu
# - DNS записи tasks.<middle>.<base_domain>
# - Traefik dynamic конфиг vikunja.yml
#
# Параметры:
#   --force  - переустановить даже если уже установлено

# Определение директории скрипта (абсолютный путь)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Загрузка общих функций
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Предупреждение: common.sh не найден, некоторые функции могут быть недоступны"
fi

set +e

# Параметры
FORCE_MODE=false

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
    esac
done

# Загрузка конфигурации из vikunja.config.json (единый источник правды)
VIKUNJA_CONFIG="${SCRIPT_DIR}/../../config/single-machine/vikunja.config.json"
if [ -f "$VIKUNJA_CONFIG" ] && command -v python3 &>/dev/null; then
    VIKUNJA_PORT=$(python3 -c "import json; c=json.load(open('$VIKUNJA_CONFIG')); print(c.get('port', 3456))")
    TASKS_PREFIX=$(python3 -c "import json; c=json.load(open('$VIKUNJA_CONFIG')); print(c.get('prefix', 'tasks'))")
    TASKS_MIDDLE=$(python3 -c "import json; c=json.load(open('$VIKUNJA_CONFIG')); print(c.get('middle', 'dev'))")
    VIKUNJA_IMAGE=$(python3 -c "import json; c=json.load(open('$VIKUNJA_CONFIG')); print(c.get('image', 'vikunja/vikunja:latest'))")
    VIKUNJA_TZ=$(python3 -c "import json; c=json.load(open('$VIKUNJA_CONFIG')); print(c.get('timezone', 'Europe/Moscow'))")
    SMTP_HOST=$(python3 -c "import json; c=json.load(open('$VIKUNJA_CONFIG')); print(c['smtp']['host'])")
    SMTP_PORT=$(python3 -c "import json; c=json.load(open('$VIKUNJA_CONFIG')); print(c['smtp']['port'])")
    OIDC_CLIENT_ID=$(python3 -c "import json; c=json.load(open('$VIKUNJA_CONFIG')); print(c['oidc']['client_id'])")
    HEALTHCHECK_ENDPOINT=$(python3 -c "import json; c=json.load(open('$VIKUNJA_CONFIG')); print(c['healthcheck']['endpoint'])")
    echo "  Конфигурация загружена из vikunja.config.json"
else
    # Fallback: дефолтные значения
    VIKUNJA_PORT=3456
    TASKS_PREFIX="tasks"
    TASKS_MIDDLE="dev"
    VIKUNJA_IMAGE="vikunja/vikunja:latest"
    VIKUNJA_TZ="Europe/Moscow"
    SMTP_HOST="127.0.0.1"
    SMTP_PORT=587
    OIDC_CLIENT_ID="vikunja"
    HEALTHCHECK_ENDPOINT="/api/v1/info"
    echo "  Предупреждение: vikunja.config.json не найден, используются дефолтные значения"
fi

# Проверка root
if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# ============================================================
# [1/7] Проверка Docker и Docker Compose
# ============================================================
echo ""
echo "=== Установка Vikunja (Task Planner) ==="
echo ""

echo "[1/7] Проверка Docker и Docker Compose..."

if ! command -v docker &>/dev/null; then
    echo "  [ОШИБКА] Docker не установлен"
    echo "  Установите Docker: curl -fsSL https://get.docker.com | sh"
    exit 1
fi

if ! docker compose version &>/dev/null; then
    echo "  [ОШИБКА] Docker Compose v2 не установлен"
    echo "  Установите Docker Compose v2 плагин"
    exit 1
fi

# Проверка запуска Docker daemon
if ! docker ps &>/dev/null; then
    echo "  [ОШИБКА] Docker daemon не запущен"
    echo "  Запустите: systemctl start docker"
    exit 1
fi

echo "  [OK] Docker $(docker --version | grep -oP '\d+\.\d+\.\d+') и Compose $(docker compose version --short) установлены"

# Проверка идемпотентности (docker ps -a ловит и остановленные контейнеры)
if [ "$FORCE_MODE" != true ]; then
    if docker ps -a --filter name='^vikunja$' --format "{{.Names}}" | grep -q "^vikunja$"; then
        echo "  [Пропуск] Vikunja уже установлен"
        if docker ps --filter name='^vikunja$' --format "{{.Status}}" | grep -q "Up"; then
            echo "  [OK] Vikunja работает"
        else
            echo "  [Предупреждение] Контейнер vikunja существует, но не запущен"
            echo "  Запуск контейнера..."
            cd /etc/vikunja && docker compose up -d
        fi
        exit 0
    fi
fi

# ============================================================
# [2/7] Создание директорий
# ============================================================
echo "[2/7] Создание директорий..."

if [ ! -d "/etc/vikunja" ]; then
    mkdir -p /etc/vikunja
    chmod 700 /etc/vikunja
    echo "  [OK] Директория /etc/vikunja создана"
else
    echo "  [Пропуск] Директория /etc/vikunja уже существует"
fi

# ============================================================
# [3/7] Генерация .env файла (однократно)
# ============================================================
echo "[3/7] Генерация .env файла..."

ENV_FILE="/etc/vikunja/.env"

# Получаем параметры Mailu для SMTP
MAILU_DOMAIN=$(get_config_value "mailu_domain" 2>/dev/null)
[ -z "$MAILU_DOMAIN" ] && MAILU_DOMAIN="borisovai.ru"

# Получаем base domains для формирования frontend URL
FIRST_BASE_DOMAIN=""
while IFS= read -r base; do
    [ -z "$base" ] && continue
    FIRST_BASE_DOMAIN="$base"
    break
done < <(get_base_domains 2>/dev/null)
[ -z "$FIRST_BASE_DOMAIN" ] && FIRST_BASE_DOMAIN="borisovai.ru"

VIKUNJA_FRONTEND_URL="https://${TASKS_PREFIX}.${TASKS_MIDDLE}.${FIRST_BASE_DOMAIN}"

# Генерация JWT secret
VIKUNJA_JWT_SECRET=$(openssl rand -hex 32 2>/dev/null || head -c 64 /dev/urandom | sha256sum | cut -d' ' -f1)

# Authelia OIDC параметры
AUTH_DOMAIN="auth.${FIRST_BASE_DOMAIN}"
VIKUNJA_CLIENT_SECRET=""
if [ -f "/etc/authelia/secrets/vikunja_client_secret" ]; then
    VIKUNJA_CLIENT_SECRET=$(cat /etc/authelia/secrets/vikunja_client_secret)
fi

if [ -f "$ENV_FILE" ] && [ -s "$ENV_FILE" ] && [ "$FORCE_MODE" != true ]; then
    echo "  [Пропуск] .env файл уже существует (не перезаписывается, --force для пересоздания)"
else
    cat > "$ENV_FILE" << EOF
# Vikunja — переменные окружения
# Параметры загружены из config/single-machine/vikunja.config.json

# Основные настройки
VIKUNJA_SERVICE_TIMEZONE=${VIKUNJA_TZ}
VIKUNJA_SERVICE_PUBLICURL=${VIKUNJA_FRONTEND_URL}
VIKUNJA_SERVICE_JWTSECRET=${VIKUNJA_JWT_SECRET}
VIKUNJA_SERVICE_ENABLEREGISTRATION=false

# База данных: SQLite (volume /db монтируется отдельно от /app/vikunja)
VIKUNJA_DATABASE_TYPE=sqlite
VIKUNJA_DATABASE_PATH=/db/vikunja.db

# SMTP уведомления через Mailu
VIKUNJA_MAILER_ENABLED=true
VIKUNJA_MAILER_HOST=${SMTP_HOST}
VIKUNJA_MAILER_PORT=${SMTP_PORT}
VIKUNJA_MAILER_USERNAME=tasks@${MAILU_DOMAIN}
VIKUNJA_MAILER_PASSWORD=CHANGE_ME
VIKUNJA_MAILER_FROMEMAIL=tasks@${MAILU_DOMAIN}
VIKUNJA_MAILER_FORCESSL=false
VIKUNJA_MAILER_SKIPTLSVERIFY=true

# Authelia OIDC
VIKUNJA_AUTH_OPENID_ENABLED=true
VIKUNJA_AUTH_OPENID_REDIRECTURL=${VIKUNJA_FRONTEND_URL}/auth/openid/authelia
VIKUNJA_AUTH_OPENID_PROVIDERS_0_NAME=Authelia
VIKUNJA_AUTH_OPENID_PROVIDERS_0_AUTHURL=https://${AUTH_DOMAIN}
VIKUNJA_AUTH_OPENID_PROVIDERS_0_CLIENTID=${OIDC_CLIENT_ID}
VIKUNJA_AUTH_OPENID_PROVIDERS_0_CLIENTSECRET=${VIKUNJA_CLIENT_SECRET}
EOF

    chmod 600 "$ENV_FILE"
    echo "  [OK] .env файл создан (chmod 600)"
    if [ -z "$VIKUNJA_CLIENT_SECRET" ]; then
        echo "  [Предупреждение] OIDC client secret не найден"
        echo "  Установите Authelia с поддержкой Vikunja и обновите .env"
    fi
fi

# ============================================================
# [4/7] Копирование docker-compose.yml
# ============================================================
echo "[4/7] Копирование docker-compose.yml..."

COMPOSE_SOURCE="${SCRIPT_DIR}/../../config/single-machine/vikunja-docker-compose.yml"
COMPOSE_DEST="/etc/vikunja/docker-compose.yml"

if [ ! -f "$COMPOSE_SOURCE" ]; then
    echo "  [ОШИБКА] Файл $COMPOSE_SOURCE не найден"
    exit 1
fi

cp "$COMPOSE_SOURCE" "$COMPOSE_DEST"
chmod 644 "$COMPOSE_DEST"
echo "  [OK] docker-compose.yml скопирован в /etc/vikunja/"

# ============================================================
# [5/7] Запуск контейнеров
# ============================================================
echo "[5/7] Запуск контейнеров..."

cd /etc/vikunja

# Создаём volumes и выставляем права ДО запуска контейнера
# Vikunja может работать как non-root, нужны права на запись
docker volume create vikunja-files 2>/dev/null || true
docker volume create vikunja-db 2>/dev/null || true
# Определяем uid из образа
VIKUNJA_UID=$(docker run --rm --entrypoint='' "${VIKUNJA_IMAGE}" id -u 2>/dev/null || echo "1000")
chown -R "${VIKUNJA_UID}:${VIKUNJA_UID}" /var/lib/docker/volumes/vikunja-files/_data/ 2>/dev/null || true
chown -R "${VIKUNJA_UID}:${VIKUNJA_UID}" /var/lib/docker/volumes/vikunja-db/_data/ 2>/dev/null || true
echo "  [OK] Права volume установлены (uid=${VIKUNJA_UID})"

if ! docker compose up -d; then
    echo "  [ОШИБКА] Не удалось запустить контейнеры"
    docker compose logs
    exit 1
fi

echo "  [OK] Контейнер vikunja запущен"

# Ожидание готовности (healthcheck)
echo -n "  Ожидание готовности Vikunja"
for i in {1..12}; do
    sleep 5
    echo -n "."
    if curl -sf --max-time 3 http://127.0.0.1:${VIKUNJA_PORT}${HEALTHCHECK_ENDPOINT} >/dev/null 2>&1; then
        echo ""
        echo "  [OK] Vikunja готов к работе (порт ${VIKUNJA_PORT})"
        break
    fi
    if [ $i -eq 12 ]; then
        echo ""
        echo "  [Предупреждение] Vikunja не ответил за 60 секунд"
        echo "  Проверьте логи: docker logs vikunja"
    fi
done

# ============================================================
# [6/7] DNS записи
# ============================================================
echo "[6/7] Создание DNS записей..."

# Получение IP сервера
SERVER_IP=$(get_config_value "server_ip" 2>/dev/null)
if [ -z "$SERVER_IP" ]; then
    SERVER_IP=$(hostname -I | awk '{print $1}')
fi

if [ -z "$SERVER_IP" ]; then
    echo "  [Предупреждение] Не удалось определить IP сервера"
    echo "  Создайте DNS записи вручную: tasks.dev.<base_domain> → IP"
else
    echo "  IP сервера: $SERVER_IP"

    DNS_API_BASE="http://127.0.0.1:5353"
    EXISTING_RECORDS=$(curl -sf "${DNS_API_BASE}/api/records" 2>/dev/null || echo '{"records":[]}')

    if command -v get_base_domains &>/dev/null; then
        while IFS= read -r base; do
            [ -z "$base" ] && continue
            FULL_DOMAIN="${TASKS_PREFIX}.${TASKS_MIDDLE}.${base}"

            if echo "$EXISTING_RECORDS" | grep -q "\"${FULL_DOMAIN}\""; then
                echo "  [Пропуск] DNS запись ${FULL_DOMAIN} уже существует"
            else
                if curl -sf -X POST "${DNS_API_BASE}/api/records" \
                    -H "Content-Type: application/json" \
                    -d "{\"domain\":\"${FULL_DOMAIN}\",\"type\":\"A\",\"value\":\"${SERVER_IP}\"}" \
                    >/dev/null 2>&1; then
                    echo "  [OK] DNS запись создана: ${FULL_DOMAIN} → ${SERVER_IP}"
                else
                    echo "  [Предупреждение] Не удалось создать DNS запись для ${FULL_DOMAIN}"
                fi
            fi
        done < <(get_base_domains 2>/dev/null)
    else
        echo "  [Пропуск] Функция get_base_domains не найдена"
        echo "  Создайте DNS записи вручную: tasks.dev.<base_domain> → $SERVER_IP"
    fi
fi

# Сохранение конфигурации
if command -v save_config_value &>/dev/null; then
    save_config_value "tasks_prefix" "$TASKS_PREFIX" 2>/dev/null
    save_config_value "tasks_middle" "$TASKS_MIDDLE" 2>/dev/null
    save_config_value "vikunja_port" "$VIKUNJA_PORT" 2>/dev/null
fi

# ============================================================
# [7/7] Traefik dynamic конфиг
# ============================================================
echo "[7/7] Создание Traefik конфигурации..."

TRAEFIK_DYNAMIC_DIR="/etc/traefik/dynamic"
VIKUNJA_YML="${TRAEFIK_DYNAMIC_DIR}/vikunja.yml"

if [ ! -d "$TRAEFIK_DYNAMIC_DIR" ]; then
    echo "  [Предупреждение] Директория $TRAEFIK_DYNAMIC_DIR не найдена"
    echo "  Traefik конфиг не создан — создайте вручную"
else
    # Генерация vikunja.yml через Python (безопасная работа с backticks)
    DOMAINS_LIST=""
    while IFS= read -r base; do
        [ -z "$base" ] && continue
        [ -n "$DOMAINS_LIST" ] && DOMAINS_LIST="${DOMAINS_LIST},"
        DOMAINS_LIST="${DOMAINS_LIST}${base}"
    done < <(get_base_domains 2>/dev/null)

    if [ -n "$DOMAINS_LIST" ]; then
        python3 -c "
import sys
bt = chr(96)
domains = '${DOMAINS_LIST}'.split(',')
prefix = '${TASKS_PREFIX}'
middle = '${TASKS_MIDDLE}'
vikunja_port = '${VIKUNJA_PORT}'

routers = ''
for d in domains:
    suffix = d.split('.')[-1]
    full = f'{prefix}.{middle}.{d}'
    routers += f'''    vikunja-{suffix}:
      rule: \"Host({bt}{full}{bt})\"
      service: vikunja
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - authelia@file
'''

content = f'''# Vikunja Task Planner - Traefik dynamic config
# Авторизация через Authelia (ForwardAuth + OIDC)
http:
  routers:
{routers}
  services:
    vikunja:
      loadBalancer:
        servers:
          - url: 'http://127.0.0.1:{vikunja_port}'
'''
with open('${VIKUNJA_YML}', 'w') as f:
    f.write(content)
"
        chmod 644 "$VIKUNJA_YML"
        echo "  [OK] vikunja.yml создан в $TRAEFIK_DYNAMIC_DIR (с Authelia middleware)"
    else
        echo "  [Предупреждение] Не удалось получить base_domains"
        echo "  Создайте vikunja.yml вручную"
    fi
fi

# ============================================================
# Итоги установки
# ============================================================
echo ""
echo "=== Vikunja Task Planner установлен ==="
echo ""
echo "  Контейнер:  docker ps | grep vikunja"
echo "  Логи:       docker logs -f vikunja"
echo "  Управление: cd /etc/vikunja && docker compose [up|down|restart]"
echo ""
echo "  Веб-интерфейс:"
while IFS= read -r base; do
    [ -z "$base" ] && continue
    echo "    https://${TASKS_PREFIX}.${TASKS_MIDDLE}.${base}"
done < <(get_base_domains 2>/dev/null)
echo ""
echo "  Авторизация: через Authelia SSO (OpenID Connect)"
echo "  Уведомления: SMTP через Mailu (tasks@${MAILU_DOMAIN})"
echo ""
echo "  Бэкап БД:"
echo "    docker exec vikunja sqlite3 /app/vikunja/vikunja.db \".backup /app/vikunja/vikunja-backup.db\""
echo "    docker cp vikunja:/app/vikunja/vikunja-backup.db /root/backups/"
echo ""
