#!/bin/bash
# Инкрементальный деплой файлового сервера
# Если файловый сервер не установлен — пропуск (используйте job install:fileserver)
# Если установлен — проверяет и обновляет конфигурацию, Docker-образы
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Деплой файлового сервера ==="

# Проверка установки
if [ ! -f "/etc/fileserver/docker-compose.yml" ]; then
    echo "Файловый сервер не установлен — пропуск (запустите install:fileserver job)"
    exit 0
fi

echo "Файловый сервер установлен, проверка обновлений..."

# Загрузка общих функций
COMMON_SH="$REPO_ROOT/scripts/single-machine/common.sh"
if [ -f "$COMMON_SH" ]; then
    source "$COMMON_SH"
fi

TRAEFIK_DYN="/etc/traefik/dynamic"
FILES_PORT=$(get_config_value "files_port" 2>/dev/null)
[ -z "$FILES_PORT" ] && FILES_PORT="3002"
FILES_PREFIX=$(get_config_value "files_prefix" 2>/dev/null)
[ -z "$FILES_PREFIX" ] && FILES_PREFIX="files"
FILES_MIDDLE=$(get_config_value "files_middle" 2>/dev/null)
[ -z "$FILES_MIDDLE" ] && FILES_MIDDLE="dev"

UPDATED=0

# ============================================================
# [1/4] Обновление nginx.conf (если изменился)
# ============================================================
echo "[1/4] Проверка nginx.conf..."

NGINX_FILE="/etc/fileserver/nginx.conf"
REPO_NGINX="$REPO_ROOT/config/single-machine/fileserver-nginx.conf"

if [ -f "$REPO_NGINX" ]; then
    if ! diff -q "$NGINX_FILE" "$REPO_NGINX" >/dev/null 2>&1; then
        echo "  Обновление nginx.conf..."
        cp "$REPO_NGINX" "$NGINX_FILE"
        NGINX_CHANGED=1
        UPDATED=$((UPDATED + 1))
    else
        echo "  [OK] nginx.conf без изменений"
    fi
else
    echo "  [Предупреждение] $REPO_NGINX не найден в репозитории"
fi

# ============================================================
# [2/4] Обновление docker-compose.yml (если изменился)
# ============================================================
echo "[2/4] Проверка docker-compose.yml..."

COMPOSE_FILE="/etc/fileserver/docker-compose.yml"
REPO_COMPOSE="$REPO_ROOT/config/single-machine/fileserver-docker-compose.yml"

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
# [3/4] Проверка files.yml в Traefik (создать если отсутствует)
# ============================================================
echo "[3/4] Проверка files.yml в Traefik..."

FILES_YML="$TRAEFIK_DYN/files.yml"
if [ ! -f "$FILES_YML" ]; then
    echo "  Создание files.yml..."

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
        echo "  [OK] files.yml создан"
        UPDATED=$((UPDATED + 1))
    else
        echo "  [Предупреждение] Не удалось получить base_domains для files.yml"
    fi
else
    echo "  [OK] files.yml существует"
fi

# ============================================================
# [4/4] Обновление Docker-образов и рестарт (если изменился compose/nginx)
# ============================================================
echo "[4/4] Обновление Docker-образов..."

if [ "$COMPOSE_CHANGED" = "1" ] || [ "$NGINX_CHANGED" = "1" ]; then
    echo "  Конфигурация изменилась — обновление контейнеров..."
    cd /etc/fileserver

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
    sleep 3
else
    cd /etc/fileserver
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
echo -n "  Health check... "
if curl -sf --max-time 5 http://127.0.0.1:${FILES_PORT}/health >/dev/null 2>&1; then
    echo "OK"
else
    echo "ПРЕДУПРЕЖДЕНИЕ (проверьте логи: docker logs fileserver)"
fi

if [ "$UPDATED" -eq 0 ]; then
    echo "  Конфигурация без изменений"
else
    echo "  Обновлено: $UPDATED элемент(ов)"
fi

echo "=== Файловый сервер задеплоен ==="
