#!/bin/bash
# Инкрементальный деплой Vikunja Task Planner
# Если Vikunja не установлен — пропуск (используйте job install:vikunja)
# Если установлен — проверяет и обновляет конфигурацию, Docker-образы
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Деплой Vikunja Task Planner ==="

# Проверка установки
if [ ! -f "/etc/vikunja/docker-compose.yml" ]; then
    echo "Vikunja не установлен — пропуск (запустите install:vikunja job)"
    exit 0
fi

echo "Vikunja установлен, проверка обновлений..."

# Загрузка общих функций
COMMON_SH="$REPO_ROOT/scripts/single-machine/common.sh"
if [ -f "$COMMON_SH" ]; then
    source "$COMMON_SH"
fi

TRAEFIK_DYN="/etc/traefik/dynamic"
VIKUNJA_PORT=$(get_config_value "vikunja_port" 2>/dev/null)
[ -z "$VIKUNJA_PORT" ] && VIKUNJA_PORT="3456"
TASKS_PREFIX=$(get_config_value "tasks_prefix" 2>/dev/null)
[ -z "$TASKS_PREFIX" ] && TASKS_PREFIX="tasks"
TASKS_MIDDLE=$(get_config_value "tasks_middle" 2>/dev/null)
[ -z "$TASKS_MIDDLE" ] && TASKS_MIDDLE="dev"

UPDATED=0

# ============================================================
# [1/3] Обновление docker-compose.yml (если изменился)
# ============================================================
echo "[1/3] Проверка docker-compose.yml..."

COMPOSE_FILE="/etc/vikunja/docker-compose.yml"
REPO_COMPOSE="$REPO_ROOT/config/single-machine/vikunja-docker-compose.yml"

if [ -f "$REPO_COMPOSE" ]; then
    if ! diff -q "$COMPOSE_FILE" "$REPO_COMPOSE" >/dev/null 2>&1; then
        echo "  Обновление docker-compose.yml..."
        cp "$REPO_COMPOSE" "$COMPOSE_FILE"
        COMPOSE_CHANGED=1
        UPDATED=$((UPDATED + 1))
    else
        echo "  [OK] docker-compose.yml без изменений"
    fi
else
    echo "  [Предупреждение] $REPO_COMPOSE не найден в репозитории"
fi

# ============================================================
# [2/3] Проверка vikunja.yml в Traefik (создать если отсутствует)
# ============================================================
echo "[2/3] Проверка vikunja.yml в Traefik..."

VIKUNJA_YML="$TRAEFIK_DYN/vikunja.yml"
if [ ! -f "$VIKUNJA_YML" ]; then
    echo "  Создание vikunja.yml..."

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
        echo "  [OK] vikunja.yml создан"
        UPDATED=$((UPDATED + 1))
    else
        echo "  [Предупреждение] Не удалось получить base_domains для vikunja.yml"
    fi
else
    echo "  [OK] vikunja.yml существует"
fi

# ============================================================
# [3/3] Обновление Docker-образов и рестарт (если изменился compose)
# ============================================================
echo "[3/3] Обновление Docker-образов..."

if [ "$COMPOSE_CHANGED" = "1" ]; then
    echo "  Конфигурация изменилась — обновление контейнеров..."
    cd /etc/vikunja

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
    cd /etc/vikunja

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
echo -n "  Vikunja health... "
if curl -sf --max-time 5 http://127.0.0.1:${VIKUNJA_PORT}/api/v1/info >/dev/null 2>&1; then
    echo "OK"
else
    echo "ПРЕДУПРЕЖДЕНИЕ (проверьте логи: docker logs vikunja)"
fi

if [ "$UPDATED" -eq 0 ]; then
    echo "  Конфигурация без изменений"
else
    echo "  Обновлено: $UPDATED элемент(ов)"
fi

echo "=== Vikunja задеплоен ==="
