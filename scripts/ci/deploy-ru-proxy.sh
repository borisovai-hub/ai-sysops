#!/bin/bash
# Деплой RU Proxy доменов из GitOps-файла config/<server>/ru-proxy/domains.json
# Синхронизирует домены через RU Proxy Management API
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Деплой RU Proxy доменов ==="

# Читаем конфиг RU Proxy из install-config.json
RU_PROXY_URL=""
RU_PROXY_TOKEN=""
if [ -f /etc/install-config.json ]; then
    RU_PROXY_URL=$(python3 -c "import json; c=json.load(open('/etc/install-config.json')); print(c.get('ru_proxy_api_url',''))" 2>/dev/null || echo "")
    RU_PROXY_TOKEN=$(python3 -c "import json; c=json.load(open('/etc/install-config.json')); print(c.get('ru_proxy_api_token',''))" 2>/dev/null || echo "")
fi

if [ -z "$RU_PROXY_URL" ] || [ -z "$RU_PROXY_TOKEN" ]; then
    echo "RU Proxy не настроен (ru_proxy_api_url/token) — пропуск"
    exit 0
fi

# Проверка доступности RU Proxy API
if ! curl -sf --max-time 5 -H "Authorization: Bearer ${RU_PROXY_TOKEN}" "${RU_PROXY_URL}/api/health" > /dev/null 2>&1; then
    echo "RU Proxy API недоступен — пропуск"
    exit 0
fi

# Определение серверной конфиг-папки
_find_server_dir() {
    if [ -n "$SERVER_CONFIG_DIR" ] && [ -d "$SERVER_CONFIG_DIR" ]; then
        echo "$SERVER_CONFIG_DIR"; return
    fi
    local cr="${CONFIG_REPO_DIR:-/opt/server-configs}"
    local sn="${SERVER_NAME:-contabo-sm-139}"
    [ -d "$cr/servers/$sn" ] && { echo "$cr/servers/$sn"; return; }
    for d in "$REPO_ROOT"/config/*/; do
        [ ! -d "$d" ] && continue
        local p=$(basename "$d")
        [ "$p" = "single-machine" ] || [ "$p" = "servers" ] && continue
        echo "${d%/}"; return
    done
    echo ""
}

SERVER_DIR="$(_find_server_dir)"
DOMAINS_FILE="$SERVER_DIR/ru-proxy/domains.json"

if [ -z "$SERVER_DIR" ] || [ ! -f "$DOMAINS_FILE" ]; then
    echo "Файл domains.json не найден — пропуск"
    exit 0
fi
echo "Файл доменов: $DOMAINS_FILE"

DESIRED=$(cat "$DOMAINS_FILE")
DESIRED_COUNT=$(echo "$DESIRED" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [ "$DESIRED_COUNT" = "0" ]; then
    echo "Файл domains.json пуст — пропуск"
    exit 0
fi

# Текущие домены из API
CURRENT=$(curl -sf -H "Authorization: Bearer ${RU_PROXY_TOKEN}" "${RU_PROXY_URL}/api/domains" 2>/dev/null || echo '[]')

CREATED=0
DELETED=0
UPDATED=0

# Добавляем/обновляем домены из файла
while IFS= read -r line; do
    DOMAIN=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin).get('domain',''))")
    BACKEND=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin).get('backend',''))")
    ENABLED=$(echo "$line" | python3 -c "import json,sys; print(str(json.load(sys.stdin).get('enabled',True)).lower())")

    [ -z "$DOMAIN" ] && continue

    # Проверяем существование в текущих
    EXISTS=$(echo "$CURRENT" | python3 -c "
import json,sys
for d in json.load(sys.stdin):
    if d.get('domain') == '$DOMAIN':
        print('yes')
        sys.exit(0)
print('no')
" 2>/dev/null || echo "no")

    if [ "$EXISTS" = "no" ]; then
        BODY="{\"domain\":\"${DOMAIN}\""
        [ -n "$BACKEND" ] && BODY="${BODY},\"backend\":\"${BACKEND}\""
        BODY="${BODY}}"
        if curl -sf -X POST -H "Authorization: Bearer ${RU_PROXY_TOKEN}" \
            -H "Content-Type: application/json" \
            -d "$BODY" "${RU_PROXY_URL}/api/domains" > /dev/null 2>&1; then
            echo "  [+] ${DOMAIN}"
            CREATED=$((CREATED + 1))
        else
            echo "  [!] Ошибка добавления ${DOMAIN}"
        fi
    fi
done < <(echo "$DESIRED" | python3 -c "
import json,sys
for r in json.load(sys.stdin):
    print(json.dumps(r))
")

# НЕ удаляем домены автоматически — только additive mode
# Удаление доменов только через UI или API вручную

# Reload Caddy если были изменения
if [ "$CREATED" -gt 0 ]; then
    echo "  Reload Caddy..."
    curl -sf -X POST -H "Authorization: Bearer ${RU_PROXY_TOKEN}" \
        "${RU_PROXY_URL}/api/reload" > /dev/null 2>&1 || true
fi

echo "  Создано: $CREATED"
echo "=== RU Proxy домены задеплоены ==="
