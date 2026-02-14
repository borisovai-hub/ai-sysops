#!/bin/bash
# Скрипт установки файлового сервера (nginx-alpine + Docker Compose)
# Использование: sudo ./install-fileserver.sh [--force]
#
# Устанавливает файловый сервер для хостинга файлов и AI-моделей:
# - Docker контейнер fileserver (nginx:alpine)
# - Конфиг /etc/fileserver/nginx.conf
# - Docker Compose /etc/fileserver/docker-compose.yml
# - Директории /srv/files/{public,private}
# - DNS записи files.<middle>.<base_domain>
# - Traefik dynamic конфиг files.yml
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
FILES_PORT=3002
FILES_PREFIX="files"
FILES_MIDDLE="dev"

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
echo "=== Установка файлового сервера ==="
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
    if docker ps -a --filter name='^fileserver$' --format "{{.Names}}" | grep -q "^fileserver$"; then
        echo "  [Пропуск] Файловый сервер уже установлен"
        if docker ps --filter name='^fileserver$' --format "{{.Status}}" | grep -q "Up"; then
            echo "  [OK] Файловый сервер работает"
        else
            echo "  [Предупреждение] Контейнер fileserver существует, но не запущен"
            echo "  Запуск контейнера..."
            cd /etc/fileserver && docker compose up -d
        fi
        exit 0
    fi
fi

# ============================================================
# [2/7] Создание директорий
# ============================================================
echo "[2/7] Создание директорий..."

# Конфигурация сервера
if [ ! -d "/etc/fileserver" ]; then
    mkdir -p /etc/fileserver
    chmod 755 /etc/fileserver
    echo "  [OK] Директория /etc/fileserver создана"
else
    echo "  [Пропуск] Директория /etc/fileserver уже существует"
fi

# Директории для файлов
DIRS=(
    "/srv/files/public/models"
    "/srv/files/public/assets"
    "/srv/files/public/downloads"
    "/srv/files/private/backups"
    "/srv/files/private/internal"
)

for dir in "${DIRS[@]}"; do
    if [ ! -d "$dir" ]; then
        mkdir -p "$dir"
        echo "  [OK] $dir создана"
    else
        echo "  [Пропуск] $dir уже существует"
    fi
done

# Права: nginx в alpine работает как uid=101 (nginx user)
chown -R root:root /srv/files
chmod -R 755 /srv/files

echo "  [OK] Права на /srv/files установлены"

# ============================================================
# [3/7] Копирование nginx.conf
# ============================================================
echo "[3/7] Копирование nginx.conf..."

NGINX_CONF_SOURCE="${SCRIPT_DIR}/../../config/single-machine/fileserver-nginx.conf"
NGINX_CONF_DEST="/etc/fileserver/nginx.conf"

if [ ! -f "$NGINX_CONF_SOURCE" ]; then
    echo "  [ОШИБКА] Файл $NGINX_CONF_SOURCE не найден"
    exit 1
fi

cp "$NGINX_CONF_SOURCE" "$NGINX_CONF_DEST"
chmod 644 "$NGINX_CONF_DEST"
echo "  [OK] nginx.conf скопирован в /etc/fileserver/"

# ============================================================
# [4/7] Копирование docker-compose.yml
# ============================================================
echo "[4/7] Копирование docker-compose.yml..."

COMPOSE_SOURCE="${SCRIPT_DIR}/../../config/single-machine/fileserver-docker-compose.yml"
COMPOSE_DEST="/etc/fileserver/docker-compose.yml"

if [ ! -f "$COMPOSE_SOURCE" ]; then
    echo "  [ОШИБКА] Файл $COMPOSE_SOURCE не найден"
    exit 1
fi

cp "$COMPOSE_SOURCE" "$COMPOSE_DEST"
chmod 644 "$COMPOSE_DEST"
echo "  [OK] docker-compose.yml скопирован в /etc/fileserver/"

# ============================================================
# [5/7] Запуск контейнеров
# ============================================================
echo "[5/7] Запуск контейнеров..."

cd /etc/fileserver

# Остановка старого контейнера если --force
if [ "$FORCE_MODE" = true ]; then
    docker compose down 2>/dev/null || true
fi

if ! docker compose up -d; then
    echo "  [ОШИБКА] Не удалось запустить контейнеры"
    docker compose logs
    exit 1
fi

echo "  [OK] Контейнер fileserver запущен"

# Ожидание готовности (healthcheck)
echo -n "  Ожидание готовности"
for i in {1..6}; do
    sleep 3
    echo -n "."
    if curl -sf --max-time 3 http://127.0.0.1:${FILES_PORT}/health >/dev/null 2>&1; then
        echo ""
        echo "  [OK] Файловый сервер готов к работе (порт ${FILES_PORT})"
        break
    fi
    if [ $i -eq 6 ]; then
        echo ""
        echo "  [Предупреждение] Сервер не ответил за 18 секунд"
        echo "  Проверьте логи: docker logs fileserver"
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
    echo "  Создайте DNS записи вручную: files.dev.<base_domain> → IP"
else
    echo "  IP сервера: $SERVER_IP"

    # Создание DNS записей для всех base_domains (идемпотентно — проверяем существующие)
    DNS_API_BASE="http://127.0.0.1:5353"
    EXISTING_RECORDS=$(curl -sf "${DNS_API_BASE}/api/records" 2>/dev/null || echo '{"records":[]}')

    if command -v get_base_domains &>/dev/null; then
        while IFS= read -r base; do
            [ -z "$base" ] && continue
            FULL_DOMAIN="${FILES_PREFIX}.${FILES_MIDDLE}.${base}"

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
        echo "  [Пропуск] Функция get_base_domains не найдена"
        echo "  Создайте DNS записи вручную: files.dev.<base_domain> → $SERVER_IP"
    fi
fi

# Сохранение конфигурации
if command -v save_config_value &>/dev/null; then
    save_config_value "files_prefix" "$FILES_PREFIX" 2>/dev/null
    save_config_value "files_middle" "$FILES_MIDDLE" 2>/dev/null
    save_config_value "files_port" "$FILES_PORT" 2>/dev/null
fi

# ============================================================
# [7/7] Traefik dynamic конфиг
# ============================================================
echo "[7/7] Создание Traefik конфигурации..."

TRAEFIK_DYNAMIC_DIR="/etc/traefik/dynamic"
FILES_YML="${TRAEFIK_DYNAMIC_DIR}/files.yml"

if [ ! -d "$TRAEFIK_DYNAMIC_DIR" ]; then
    echo "  [Предупреждение] Директория $TRAEFIK_DYNAMIC_DIR не найдена"
    echo "  Traefik конфиг не создан — создайте вручную"
else
    # Генерация files.yml через Python (безопасная работа с backticks)
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
prefix = '${FILES_PREFIX}'
middle = '${FILES_MIDDLE}'
files_port = '${FILES_PORT}'

routers = ''
for d in domains:
    suffix = d.split('.')[-1]
    full = f'{prefix}.{middle}.{d}'
    routers += f'''    files-public-{suffix}:
      rule: \"Host({bt}{full}{bt}) && PathPrefix({bt}/public/{bt})\"
      service: files
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      priority: 200
    files-{suffix}:
      rule: \"Host({bt}{full}{bt})\"
      service: files
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      middlewares:
        - authelia@file
'''

content = f'''# File Server - Traefik dynamic config
# /public/* — без Authelia (публичные файлы, модели)
# Всё остальное — через Authelia
http:
  routers:
{routers}
  services:
    files:
      loadBalancer:
        servers:
          - url: 'http://127.0.0.1:{files_port}'
'''
with open('${FILES_YML}', 'w') as f:
    f.write(content)
"
        chmod 644 "$FILES_YML"
        echo "  [OK] files.yml создан в $TRAEFIK_DYNAMIC_DIR"
    else
        echo "  [Предупреждение] Не удалось получить base_domains"
        echo "  Создайте files.yml вручную"
    fi
fi

# ============================================================
# Итоги установки
# ============================================================
echo ""
echo "=== Файловый сервер установлен ==="
echo ""
echo "  Контейнер:  docker ps | grep fileserver"
echo "  Логи:       docker logs -f fileserver"
echo "  Управление: cd /etc/fileserver && docker compose [up|down|restart]"
echo ""
echo "  Веб-интерфейс:"
while IFS= read -r base; do
    [ -z "$base" ] && continue
    echo "    https://${FILES_PREFIX}.${FILES_MIDDLE}.${base}"
done < <(get_base_domains 2>/dev/null)
echo ""
echo "  Структура файлов:"
echo "    /srv/files/public/models/     ← AI модели"
echo "    /srv/files/public/assets/     ← Публичные ассеты"
echo "    /srv/files/public/downloads/  ← Публичные загрузки"
echo "    /srv/files/private/backups/   ← Бэкапы"
echo "    /srv/files/private/internal/  ← Внутренние файлы"
echo ""
echo "  Загрузка моделей:"
echo "    pip install huggingface_hub"
echo "    huggingface-cli download Systran/faster-whisper-base --local-dir /srv/files/public/models/faster-whisper-base"
echo ""
