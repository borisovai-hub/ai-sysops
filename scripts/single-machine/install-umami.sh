#!/bin/bash
# Скрипт установки Umami Analytics (Docker Compose + SQLite)
# Использование: sudo ./install-umami.sh [--force]
#
# Устанавливает Umami на сервер и настраивает:
# - Docker контейнер umami (ghcr.io/maxime-j/umami-sqlite:latest)
# - Конфиг /etc/umami/docker-compose.yml
# - Переменные окружения /etc/umami/.env
# - SQLite БД в Docker volume umami-data
# - DNS записи analytics.<base_domain>
# - Traefik dynamic конфиг analytics.yml
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
UMAMI_PORT=3001
ANALYTICS_PREFIX="analytics"
ANALYTICS_MIDDLE="dev"
TRACKER_SCRIPT_NAME="stats"  # Обход AdBlock

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
    esac
done

# Проверка root
if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# ============================================================
# [1/7] Проверка Docker и Docker Compose
# ============================================================
echo ""
echo "=== Установка Umami Analytics ==="
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
    if docker ps -a --filter name='^umami$' --format "{{.Names}}" | grep -q "^umami$"; then
        echo "  [Пропуск] Umami уже установлен"
        if docker ps --filter name='^umami$' --format "{{.Status}}" | grep -q "Up"; then
            echo "  [OK] Umami работает"
        else
            echo "  [Предупреждение] Контейнер umami существует, но не запущен"
            echo "  Запуск контейнера..."
            cd /etc/umami && docker compose up -d
        fi
        exit 0
    fi
fi

# ============================================================
# [2/7] Создание директорий
# ============================================================
echo "[2/7] Создание директорий..."

if [ ! -d "/etc/umami" ]; then
    mkdir -p /etc/umami
    chmod 700 /etc/umami
    echo "  [OK] Директория /etc/umami создана"
else
    echo "  [Пропуск] Директория /etc/umami уже существует"
fi

# ============================================================
# [3/7] Генерация .env файла (однократно)
# ============================================================
echo "[3/7] Генерация .env файла..."

ENV_FILE="/etc/umami/.env"
if [ -f "$ENV_FILE" ] && [ -s "$ENV_FILE" ]; then
    echo "  [Пропуск] .env файл уже существует (не перезаписывается)"
else
    cat > "$ENV_FILE" << EOF
# Umami Analytics — переменные окружения
# База данных: SQLite (файловая БД в Docker volume)
DATABASE_URL=file:/app/data/umami.db

# Кастомное имя скрипта для обхода AdBlock (по умолчанию: stats)
# Скрипт будет доступен по адресу: https://analytics.borisovai.ru/${TRACKER_SCRIPT_NAME}.js
TRACKER_SCRIPT_NAME=${TRACKER_SCRIPT_NAME}

# APP_SECRET генерируется автоматически при первом запуске (не трогать)
EOF

    chmod 600 "$ENV_FILE"
    echo "  [OK] .env файл создан (chmod 600)"
fi

# ============================================================
# [4/7] Копирование docker-compose.yml
# ============================================================
echo "[4/7] Копирование docker-compose.yml..."

COMPOSE_SOURCE="${SCRIPT_DIR}/../../config/single-machine/umami-docker-compose.yml"
COMPOSE_DEST="/etc/umami/docker-compose.yml"

if [ ! -f "$COMPOSE_SOURCE" ]; then
    echo "  [ОШИБКА] Файл $COMPOSE_SOURCE не найден"
    exit 1
fi

cp "$COMPOSE_SOURCE" "$COMPOSE_DEST"
chmod 644 "$COMPOSE_DEST"
echo "  [OK] docker-compose.yml скопирован в /etc/umami/"

# ============================================================
# [5/7] Запуск контейнеров
# ============================================================
echo "[5/7] Запуск контейнеров..."

cd /etc/umami

# Создаём volume и выставляем права ДО запуска контейнера
# Umami работает как uid=1001 (nextjs), нужны права на запись в /app/data
docker volume create umami-data 2>/dev/null || true
chown -R 1001:65533 /var/lib/docker/volumes/umami-data/_data/ 2>/dev/null || true

if ! docker compose up -d; then
    echo "  [ОШИБКА] Не удалось запустить контейнеры"
    docker compose logs
    exit 1
fi

echo "  [OK] Контейнер umami запущен"

# Ожидание готовности (healthcheck)
echo -n "  Ожидание готовности Umami"
for i in {1..12}; do
    sleep 5
    echo -n "."
    if curl -sf --max-time 3 http://127.0.0.1:${UMAMI_PORT}/api/heartbeat >/dev/null 2>&1; then
        echo ""
        echo "  [OK] Umami готов к работе (порт ${UMAMI_PORT})"
        break
    fi
    if [ $i -eq 12 ]; then
        echo ""
        echo "  [Предупреждение] Umami не ответил за 60 секунд"
        echo "  Проверьте логи: docker logs umami"
    fi
done

# ============================================================
# [6/7] DNS записи
# ============================================================
echo "[6/7] Создание DNS записей..."

# Получение IP сервера
SERVER_IP=$(get_config_value "server_ip" 2>/dev/null)
if [ -z "$SERVER_IP" ]; then
    # Попытка определить автоматически
    SERVER_IP=$(hostname -I | awk '{print $1}')
fi

if [ -z "$SERVER_IP" ]; then
    echo "  [Предупреждение] Не удалось определить IP сервера"
    echo "  Создайте DNS записи вручную: analytics.<base_domain> → IP"
else
    echo "  IP сервера: $SERVER_IP"

    # Создание DNS записей для всех base_domains (идемпотентно — проверяем существующие)
    DNS_API_BASE="http://127.0.0.1:5353"
    EXISTING_RECORDS=$(curl -sf "${DNS_API_BASE}/api/records" 2>/dev/null || echo '{"records":[]}')

    if command -v build_service_domains &>/dev/null; then
        # Создаём DNS записи для analytics.dev.<base_domain>
        while IFS= read -r base; do
            [ -z "$base" ] && continue
            FULL_DOMAIN="${ANALYTICS_PREFIX}.${ANALYTICS_MIDDLE}.${base}"

            # Проверяем, существует ли запись (по домену)
            if echo "$EXISTING_RECORDS" | grep -q "\"${FULL_DOMAIN}\""; then
                echo "  [Пропуск] DNS запись ${FULL_DOMAIN} уже существует"
            else
                # Создаём A-запись через DNS API
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
        echo "  [Пропуск] Функция build_service_domains не найдена"
        echo "  Создайте DNS записи вручную: analytics.dev.<base_domain> → $SERVER_IP"
    fi
fi

# Сохранение конфигурации
if command -v save_config_value &>/dev/null; then
    save_config_value "analytics_prefix" "$ANALYTICS_PREFIX" 2>/dev/null
    save_config_value "analytics_middle" "$ANALYTICS_MIDDLE" 2>/dev/null
    save_config_value "umami_port" "$UMAMI_PORT" 2>/dev/null
    save_config_value "umami_tracker_script" "$TRACKER_SCRIPT_NAME" 2>/dev/null
fi

# ============================================================
# [7/7] Traefik dynamic конфиг
# ============================================================
echo "[7/7] Создание Traefik конфигурации..."

TRAEFIK_DYNAMIC_DIR="/etc/traefik/dynamic"
ANALYTICS_YML="${TRAEFIK_DYNAMIC_DIR}/analytics.yml"

if [ ! -d "$TRAEFIK_DYNAMIC_DIR" ]; then
    echo "  [Предупреждение] Директория $TRAEFIK_DYNAMIC_DIR не найдена"
    echo "  Traefik конфиг не создан — создайте вручную"
else
    # Генерация analytics.yml с SSO bridge через Python (безопасная работа с backticks)
    MGMT_PORT=3000
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
prefix = '${ANALYTICS_PREFIX}'
middle = '${ANALYTICS_MIDDLE}'
umami_port = '${UMAMI_PORT}'
mgmt_port = '${MGMT_PORT}'

tracker = '${TRACKER_SCRIPT_NAME}'
if not tracker:
    tracker = 'stats'

mw = ''
routers = ''
for d in domains:
    suffix = d.split('.')[-1]
    full = f'{prefix}.{middle}.{d}'
    mw += f'''    analytics-login-redirect-{suffix}:
      redirectRegex:
        regex: '^https://{full.replace('.', chr(92)+'.')}/login\$'
        replacement: 'https://{full}/sso-bridge'
        permanent: false
'''
    routers += f'''    analytics-tracking-{suffix}:
      rule: \"Host({bt}{full}{bt}) && (Path({bt}/api/send{bt}) || Path({bt}/{tracker}.js{bt}))\"
      service: analytics
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      priority: 300
    analytics-sso-{suffix}:
      rule: \"Host({bt}{full}{bt}) && Path({bt}/sso-bridge{bt})\"
      service: analytics-sso
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - authelia@file
      priority: 200
    analytics-login-{suffix}:
      rule: \"Host({bt}{full}{bt}) && Path({bt}/login{bt})\"
      service: analytics
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - authelia@file
        - analytics-login-redirect-{suffix}
      priority: 100
    analytics-{suffix}:
      rule: \"Host({bt}{full}{bt})\"
      service: analytics
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - authelia@file
'''

content = f'''# Umami Analytics - Traefik dynamic config
# SSO: /login -> /sso-bridge (management-ui) -> autologin via Authelia
# Tracking API (/api/send, /{tracker}.js) - public, no Authelia
http:
  middlewares:
{mw}
  routers:
{routers}
  services:
    analytics:
      loadBalancer:
        servers:
          - url: 'http://127.0.0.1:{umami_port}'
    analytics-sso:
      loadBalancer:
        servers:
          - url: 'http://127.0.0.1:{mgmt_port}'
'''
with open('${ANALYTICS_YML}', 'w') as f:
    f.write(content)
"
        chmod 644 "$ANALYTICS_YML"
        echo "  [OK] analytics.yml создан в $TRAEFIK_DYNAMIC_DIR (с SSO bridge)"
    else
        echo "  [Предупреждение] Не удалось получить base_domains"
        echo "  Создайте analytics.yml вручную"
    fi
fi

# ============================================================
# Итоги установки
# ============================================================
echo ""
echo "=== Umami Analytics установлен ==="
echo ""
echo "  Контейнер:  docker ps | grep umami"
echo "  Логи:       docker logs -f umami"
echo "  Управление: cd /etc/umami && docker compose [up|down|restart]"
echo ""
echo "  Веб-интерфейс:"
while IFS= read -r base; do
    [ -z "$base" ] && continue
    echo "    https://${ANALYTICS_PREFIX}.${ANALYTICS_MIDDLE}.${base}"
done < <(get_base_domains 2>/dev/null)
echo ""
echo "  Первый запуск: создайте admin пользователя в веб-интерфейсе"
echo ""
echo "  Бэкап БД:"
echo "    docker exec umami sqlite3 /app/data/umami.db \".backup /app/data/umami-backup.db\""
echo "    docker cp umami:/app/data/umami-backup.db /root/backups/"
echo ""
