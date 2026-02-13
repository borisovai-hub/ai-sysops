#!/bin/bash
# Инкрементальный деплой Umami Analytics
# Если Umami не установлен — пропуск (используйте job install:umami)
# Если установлен — проверяет и обновляет конфигурацию, Docker-образы
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Деплой Umami Analytics ==="

# Проверка установки
if [ ! -f "/etc/umami/docker-compose.yml" ]; then
    echo "Umami не установлен — пропуск (запустите install:umami job)"
    exit 0
fi

echo "Umami установлен, проверка обновлений..."

# Загрузка общих функций
COMMON_SH="$REPO_ROOT/scripts/single-machine/common.sh"
if [ -f "$COMMON_SH" ]; then
    source "$COMMON_SH"
fi

TRAEFIK_DYN="/etc/traefik/dynamic"
UMAMI_PORT=$(get_config_value "umami_port" 2>/dev/null)
[ -z "$UMAMI_PORT" ] && UMAMI_PORT="3001"
ANALYTICS_PREFIX=$(get_config_value "analytics_prefix" 2>/dev/null)
[ -z "$ANALYTICS_PREFIX" ] && ANALYTICS_PREFIX="analytics"
ANALYTICS_MIDDLE=$(get_config_value "analytics_middle" 2>/dev/null)
[ -z "$ANALYTICS_MIDDLE" ] && ANALYTICS_MIDDLE="dev"

UPDATED=0

# ============================================================
# [1/3] Обновление docker-compose.yml (если изменился)
# ============================================================
echo "[1/3] Проверка docker-compose.yml..."

COMPOSE_FILE="/etc/umami/docker-compose.yml"
REPO_COMPOSE="$REPO_ROOT/config/single-machine/umami-docker-compose.yml"

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
# [2/3] Проверка analytics.yml в Traefik (создать если отсутствует)
# ============================================================
echo "[2/3] Проверка analytics.yml в Traefik..."

MGMT_PORT=3000
ANALYTICS_YML="$TRAEFIK_DYN/analytics.yml"
if [ ! -f "$ANALYTICS_YML" ]; then
    echo "  Создание analytics.yml с SSO bridge..."

    # Генерация через Python — безопасная работа с backticks
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
    routers += f'''    analytics-sso-{suffix}:
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
        echo "  [OK] analytics.yml создан (с SSO bridge)"
        UPDATED=$((UPDATED + 1))
    else
        echo "  [Предупреждение] Не удалось получить base_domains для analytics.yml"
    fi
else
    echo "  [OK] analytics.yml существует"
fi

# ============================================================
# [3/3] Обновление Docker-образов и рестарт (если изменился compose)
# ============================================================
echo "[3/3] Обновление Docker-образов..."

if [ "$COMPOSE_CHANGED" = "1" ]; then
    echo "  Конфигурация изменилась — обновление контейнеров..."
    cd /etc/umami

    # Остановка контейнеров
    docker compose down

    # Получение новых версий образов
    if docker compose pull; then
        echo "  [OK] Образы обновлены"
    else
        echo "  [Предупреждение] Не удалось обновить образы"
    fi

    # Запуск с новой конфигурацией
    if docker compose up -d; then
        echo "  [OK] Контейнеры перезапущены"
    else
        echo "  [ОШИБКА] Не удалось запустить контейнеры"
        docker compose logs
        exit 1
    fi

    sleep 5
else
    # Конфиг не изменился, но можно обновить образы
    cd /etc/umami

    echo "  Проверка обновлений образов..."
    if docker compose pull; then
        # Проверяем, изменились ли образы
        if docker compose up -d; then
            echo "  [OK] Образы обновлены (при необходимости)"
        fi
    fi
fi

# ============================================================
# Health check
# ============================================================
echo -n "  Umami health... "
if curl -sf --max-time 5 http://127.0.0.1:${UMAMI_PORT}/api/heartbeat >/dev/null 2>&1; then
    echo "OK"
else
    echo "ПРЕДУПРЕЖДЕНИЕ (проверьте логи: docker logs umami)"
fi

if [ "$UPDATED" -eq 0 ]; then
    echo "  Конфигурация без изменений"
else
    echo "  Обновлено: $UPDATED элемент(ов)"
fi

echo "=== Umami задеплоен ==="
