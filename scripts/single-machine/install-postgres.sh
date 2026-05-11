#!/bin/bash
# Скрипт установки PostgreSQL 16 в Docker
# Использование: sudo ./install-postgres.sh [--force]
#
# Что делает:
# 1. Устанавливает Docker CE если нет (apt repository docker.com)
# 2. Создаёт /var/lib/postgres-data (volume) и /etc/postgres/docker-compose.yml
# 3. Генерирует пароль один раз, сохраняет в /root/.borisovai-credentials/postgres
# 4. Запускает postgres:16-alpine, listen 127.0.0.1:5432 (внешний доступ — через
#    frps tunnel при необходимости)
#
# Параметры:
#   --force  - принудительно пересоздать docker-compose.yml + restart контейнера
#              (НЕ удаляет volume — данные сохраняются)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[ -f "$SCRIPT_DIR/common.sh" ] && source "$SCRIPT_DIR/common.sh"

set -e

FORCE_MODE=false
for arg in "$@"; do
    case $arg in
        --force) FORCE_MODE=true ;;
    esac
done

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: запустите с правами root (sudo)"
    exit 1
fi

PG_VERSION="16-alpine"
PG_PORT=5432
DATA_DIR=/var/lib/postgres-data
COMPOSE_DIR=/etc/postgres
CRED_FILE=/root/.borisovai-credentials/postgres

echo ""
echo "=== Установка PostgreSQL ${PG_VERSION} в Docker ==="
echo ""

# ============================================================
# [1/3] Docker CE
# ============================================================
echo "[1/3] Проверка Docker..."
if ! command -v docker &>/dev/null; then
    echo "  Установка Docker CE..."
    apt-get update -qq
    apt-get install -y -qq ca-certificates curl gnupg
    install -m 0755 -d /etc/apt/keyrings
    if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
        curl -fsSL https://download.docker.com/linux/debian/gpg \
            | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
        chmod a+r /etc/apt/keyrings/docker.gpg
    fi
    CODENAME=$(. /etc/os-release && echo "$VERSION_CODENAME")
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/debian ${CODENAME} stable" \
        > /etc/apt/sources.list.d/docker.list
    apt-get update -qq
    apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
    systemctl enable --now docker
fi
echo "  $(docker --version)"
echo "  $(docker compose version | head -1)"

# ============================================================
# [2/3] Credentials + compose
# ============================================================
echo "[2/3] Конфигурация..."
mkdir -p "$COMPOSE_DIR" "$DATA_DIR" "$(dirname "$CRED_FILE")"
chmod 700 "$(dirname "$CRED_FILE")"

if [ ! -f "$CRED_FILE" ]; then
    PG_PASS=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-32)
    cat > "$CRED_FILE" << CRED_EOF
postgres_user=postgres
postgres_password=${PG_PASS}
postgres_port=${PG_PORT}
host_bind=127.0.0.1
db_default=postgres
data_dir=${DATA_DIR}
CRED_EOF
    chmod 600 "$CRED_FILE"
    echo "  [OK] Credentials → ${CRED_FILE}"
else
    PG_PASS=$(grep postgres_password "$CRED_FILE" | cut -d= -f2)
    echo "  [Пропуск] Credentials уже есть"
fi

COMPOSE_FILE="${COMPOSE_DIR}/docker-compose.yml"
if [ "$FORCE_MODE" = true ] || [ ! -f "$COMPOSE_FILE" ]; then
    cat > "$COMPOSE_FILE" << COMPOSE_EOF
services:
  postgres:
    image: postgres:${PG_VERSION}
    container_name: postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${PG_PASS}
      POSTGRES_DB: postgres
      PGDATA: /var/lib/postgresql/data/pgdata
    volumes:
      - ${DATA_DIR}:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:${PG_PORT}:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    shm_size: 256mb
COMPOSE_EOF
    echo "  [OK] ${COMPOSE_FILE}"
fi

# ============================================================
# [3/3] Start + health
# ============================================================
echo "[3/3] Запуск контейнера..."
cd "$COMPOSE_DIR"
docker compose up -d 2>&1 | tail -3
sleep 4

if docker compose ps --status running | grep -q postgres; then
    echo "  [OK] postgres запущен"
else
    echo "  [ОШИБКА] postgres не стартовал"
    docker compose logs --tail 30
    exit 1
fi

echo
echo "=== PostgreSQL установлен ==="
echo ""
echo "  Версия:       ${PG_VERSION}"
echo "  Listen:       127.0.0.1:${PG_PORT} (только loopback)"
echo "  Volume:       ${DATA_DIR}"
echo "  Credentials:  ${CRED_FILE}"
echo ""
echo "  Проверка:"
echo "    docker exec postgres psql -U postgres -c '\\\\l'"
echo ""
echo "  Создание новой БД для проекта:"
echo "    docker exec postgres createdb -U postgres myapp"
echo "    docker exec postgres psql -U postgres -c \"CREATE USER myapp WITH PASSWORD '...';\""
echo "    docker exec postgres psql -U postgres -c \"GRANT ALL ON DATABASE myapp TO myapp;\""
echo ""
echo "  Доступ из других серверов (через frps):"
echo "    На primary: добавить TCP-tunnel в /etc/frp/frps.toml или"
echo "    на этом сервере добавить в /etc/frp/frpc.toml proxy postgres-5432."
echo ""
