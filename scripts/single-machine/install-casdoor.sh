#!/bin/bash
# Установка Casdoor Identity Provider (Docker)
# Запускается один раз: создаёт директории, копирует конфиги, стартует контейнер
# Использование: bash scripts/single-machine/install-casdoor.sh [--force]
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CASDOOR_DIR="/opt/casdoor"
FORCE="${1:-}"

echo "=== Установка Casdoor Identity Provider ==="

# Проверка Docker
if ! command -v docker &>/dev/null; then
    echo "ОШИБКА: Docker не установлен. Запустите install:docker сначала."
    exit 1
fi

# Проверка существующей установки
if [ -f "$CASDOOR_DIR/docker-compose.yml" ] && [ "$FORCE" != "--force" ]; then
    echo "Casdoor уже установлен. Используйте --force для переустановки."
    exit 0
fi

# Загрузка общих функций
COMMON_SH="$REPO_ROOT/scripts/single-machine/common.sh"
if [ -f "$COMMON_SH" ]; then
    source "$COMMON_SH"
fi

# Поиск серверных конфигов
_find_server_dir() {
    local cr="${CONFIG_REPO_DIR:-/opt/server-configs}"
    local sn="${SERVER_NAME:-contabo-sm-139}"
    [ -d "$cr/servers/$sn/casdoor" ] && { echo "$cr/servers/$sn"; return; }
    for d in "$REPO_ROOT"/config/*/; do
        [ -d "$d/casdoor" ] && { echo "${d%/}"; return; }
    done
    echo ""
}

SERVER_DIR=$(_find_server_dir)

echo "[1/4] Создание директорий..."
mkdir -p "$CASDOOR_DIR/conf"
mkdir -p "$CASDOOR_DIR/data/logs"

echo "[2/4] Копирование конфигов..."
if [ -n "$SERVER_DIR" ] && [ -d "$SERVER_DIR/casdoor" ]; then
    cp "$SERVER_DIR/casdoor/docker-compose.yml" "$CASDOOR_DIR/docker-compose.yml"
    cp "$SERVER_DIR/casdoor/conf/app.conf" "$CASDOOR_DIR/conf/app.conf"
    echo "  Конфиги скопированы из $SERVER_DIR/casdoor/"
else
    echo "ОШИБКА: конфиги Casdoor не найдены (ожидается config/<server>/casdoor/)"
    exit 1
fi

echo "[3/4] Запуск Casdoor..."
cd "$CASDOOR_DIR"
docker compose pull
docker compose up -d

echo "[4/4] Проверка..."
sleep 8

if curl -sf --max-time 10 http://127.0.0.1:8100/ >/dev/null 2>&1; then
    echo "  [OK] Casdoor запущен на 127.0.0.1:8100"
else
    echo "  ПРЕДУПРЕЖДЕНИЕ: Casdoor не отвечает. Проверьте:"
    echo "  docker compose -f $CASDOOR_DIR/docker-compose.yml logs"
fi

echo ""
echo "=== Casdoor установлен ==="
echo "  Admin UI: https://auth.dev.borisovai.tech"
echo "  Default: admin / 123"
echo "  НЕМЕДЛЕННО СМЕНИТЕ ПАРОЛЬ!"
echo ""
echo "  Далее настройте через UI:"
echo "  1. Organization → borisovai"
echo "  2. Application → cascade"
echo "  3. OAuth Providers (Google, GitHub, VK, Yandex)"
echo "  4. Подробности: $CASDOOR_DIR/README.md"
