#!/bin/bash
# Деплой DNS-записей из GitOps-файла config/<server>/dns/records.json
# Синхронизирует записи: создаёт отсутствующие, удаляет лишние
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Деплой DNS-записей ==="

DNS_API_PORT=5353
DNS_API_BASE="http://127.0.0.1:${DNS_API_PORT}"

# Проверка DNS API
if ! curl -sf --max-time 3 "${DNS_API_BASE}/api/records" > /dev/null 2>&1; then
    echo "DNS API недоступен — пропуск"
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
RECORDS_FILE="$SERVER_DIR/dns/records.json"

if [ -z "$SERVER_DIR" ] || [ ! -f "$RECORDS_FILE" ]; then
    echo "Файл records.json не найден — пропуск"
    exit 0
fi
echo "Файл записей: $RECORDS_FILE"

# Читаем целевые записи из файла
DESIRED=$(cat "$RECORDS_FILE")
DESIRED_COUNT=$(echo "$DESIRED" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")

if [ "$DESIRED_COUNT" = "0" ]; then
    echo "Файл records.json пуст — пропуск"
    exit 0
fi

# Читаем текущие записи из DNS API
CURRENT=$(curl -sf "${DNS_API_BASE}/api/records" 2>/dev/null || echo '{"records":[]}')

CREATED=0
DELETED=0

# Создаём отсутствующие записи
while IFS= read -r line; do
    SUBDOMAIN=$(echo "$line" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('subdomain',''))")
    DOMAIN=$(echo "$line" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('domain',''))")
    IP=$(echo "$line" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('ip',''))")
    TYPE=$(echo "$line" | python3 -c "import json,sys; r=json.load(sys.stdin); print(r.get('type','A'))")

    [ -z "$SUBDOMAIN" ] || [ -z "$DOMAIN" ] || [ -z "$IP" ] && continue

    # Проверяем существование
    EXISTS=$(echo "$CURRENT" | python3 -c "
import json,sys
data = json.load(sys.stdin)
records = data.get('records', data if isinstance(data, list) else [])
for r in records:
    if r.get('subdomain') == '$SUBDOMAIN' and r.get('domain') == '$DOMAIN':
        print('yes')
        sys.exit(0)
print('no')
" 2>/dev/null || echo "no")

    if [ "$EXISTS" = "no" ]; then
        if curl -sf -X POST "${DNS_API_BASE}/api/records" \
            -H "Content-Type: application/json" \
            -d "{\"subdomain\":\"${SUBDOMAIN}\",\"domain\":\"${DOMAIN}\",\"ip\":\"${IP}\",\"type\":\"${TYPE}\"}" \
            > /dev/null 2>&1; then
            echo "  [+] ${SUBDOMAIN}.${DOMAIN} → ${IP}"
            CREATED=$((CREATED + 1))
        else
            echo "  [!] Ошибка создания ${SUBDOMAIN}.${DOMAIN}"
        fi
    fi
done < <(echo "$DESIRED" | python3 -c "
import json,sys
for r in json.load(sys.stdin):
    print(json.dumps(r))
")

# НЕ удаляем записи автоматически — только additive mode
# Удаление записей только через UI или API вручную

echo "  Создано: $CREATED"
echo "=== DNS-записи задеплоены ==="
