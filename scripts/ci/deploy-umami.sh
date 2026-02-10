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

ANALYTICS_YML="$TRAEFIK_DYN/analytics.yml"
if [ ! -f "$ANALYTICS_YML" ]; then
    echo "  Создание analytics.yml..."

    # Раздельные роутеры (по одному на домен) — избегаем SAN-конфликт в Let's Encrypt
    ROUTERS_YAML=""
    HAS_DOMAINS=false
    while IFS= read -r base; do
        [ -z "$base" ] && continue
        HAS_DOMAINS=true
        SUFFIX=$(echo "$base" | sed 's/.*\.//')
        ROUTERS_YAML="${ROUTERS_YAML}
    analytics-${SUFFIX}:
      rule: \"Host(\`${ANALYTICS_PREFIX}.${base}\`)\"
      service: analytics
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
"
    done < <(get_base_domains 2>/dev/null)

    if [ "$HAS_DOMAINS" = true ]; then
        cat > "$ANALYTICS_YML" << TRAEFIKEOF
# Umami Analytics — Traefik dynamic конфигурация
# Раздельные роутеры для каждого базового домена
http:
  routers:${ROUTERS_YAML}
  services:
    analytics:
      loadBalancer:
        servers:
          - url: 'http://127.0.0.1:${UMAMI_PORT}'
TRAEFIKEOF
        chmod 644 "$ANALYTICS_YML"
        echo "  [OK] analytics.yml создан"
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
