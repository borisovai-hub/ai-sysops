#!/bin/bash
# Инкрементальный деплой Casdoor Identity Provider
# Если Casdoor не установлен — пропуск (используйте job install:casdoor)
# Если установлен — проверяет и обновляет конфигурацию, Docker-образы
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

CASDOOR_DIR="/opt/casdoor"

echo "=== Деплой Casdoor Identity Provider ==="

# Проверка установки
if [ ! -f "$CASDOOR_DIR/docker-compose.yml" ]; then
    echo "Casdoor не установлен — пропуск (запустите install:casdoor job)"
    exit 0
fi

echo "Casdoor установлен, проверка обновлений..."

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
UPDATED=0

# ============================================================
# [1/3] Обновление docker-compose.yml (если изменился)
# ============================================================
echo "[1/3] Проверка docker-compose.yml..."

REPO_COMPOSE=""
if [ -n "$SERVER_DIR" ] && [ -f "$SERVER_DIR/casdoor/docker-compose.yml" ]; then
    REPO_COMPOSE="$SERVER_DIR/casdoor/docker-compose.yml"
fi

COMPOSE_CHANGED=0
if [ -n "$REPO_COMPOSE" ]; then
    if ! diff -q "$CASDOOR_DIR/docker-compose.yml" "$REPO_COMPOSE" >/dev/null 2>&1; then
        echo "  Обновление docker-compose.yml..."
        cp "$REPO_COMPOSE" "$CASDOOR_DIR/docker-compose.yml"
        COMPOSE_CHANGED=1
        UPDATED=$((UPDATED + 1))
    else
        echo "  [OK] docker-compose.yml без изменений"
    fi
else
    echo "  [Предупреждение] docker-compose.yml не найден в репозитории"
fi

# ============================================================
# [2/3] Обновление app.conf (если изменился)
# ============================================================
echo "[2/3] Проверка app.conf..."

REPO_CONF=""
if [ -n "$SERVER_DIR" ] && [ -f "$SERVER_DIR/casdoor/conf/app.conf" ]; then
    REPO_CONF="$SERVER_DIR/casdoor/conf/app.conf"
fi

if [ -n "$REPO_CONF" ]; then
    if ! diff -q "$CASDOOR_DIR/conf/app.conf" "$REPO_CONF" >/dev/null 2>&1; then
        echo "  Обновление app.conf..."
        cp "$REPO_CONF" "$CASDOOR_DIR/conf/app.conf"
        COMPOSE_CHANGED=1
        UPDATED=$((UPDATED + 1))
    else
        echo "  [OK] app.conf без изменений"
    fi
else
    echo "  [Предупреждение] app.conf не найден в репозитории"
fi

# ============================================================
# [3/3] Обновление Docker-образов и рестарт (если изменились конфиги)
# ============================================================
echo "[3/3] Обновление Docker-образов..."

if [ "$COMPOSE_CHANGED" = "1" ]; then
    echo "  Конфигурация изменилась — обновление контейнеров..."
    cd "$CASDOOR_DIR"

    docker compose down
    if docker compose pull; then
        echo "  [OK] Образы обновлены"
    else
        echo "  [Предупреждение] Не удалось обновить образы"
    fi

    if docker compose up -d; then
        echo "  [OK] Контейнеры перезапущены"
    else
        echo "  [ОШИБКА] Не удалось запустить контейнеры"
        docker compose logs
        exit 1
    fi

    sleep 5
else
    cd "$CASDOOR_DIR"
    echo "  Проверка обновлений образов..."
    if docker compose pull; then
        if docker compose up -d; then
            echo "  [OK] Образы обновлены (при необходимости)"
        fi
    fi
fi

# ============================================================
# Health check
# ============================================================
echo -n "  Casdoor health... "
if curl -sf --max-time 10 http://127.0.0.1:8100/ >/dev/null 2>&1; then
    echo "OK"
else
    echo "ПРЕДУПРЕЖДЕНИЕ (проверьте логи: docker compose -f $CASDOOR_DIR/docker-compose.yml logs)"
fi

if [ "$UPDATED" -eq 0 ]; then
    echo "  Конфигурация без изменений"
else
    echo "  Обновлено: $UPDATED элемент(ов)"
fi

echo "=== Casdoor задеплоен ==="
