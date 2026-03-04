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

# Поиск файла records.json в config/<server>/dns/
RECORDS_FILE=""
for dir in "$REPO_ROOT"/config/*/dns; do
    [ ! -d "$dir" ] && continue
    parent=$(basename "$(dirname "$dir")")
    [ "$parent" = "single-machine" ] && continue
    if [ -f "$dir/records.json" ]; then
        RECORDS_FILE="$dir/records.json"
        echo "Файл записей: config/$parent/dns/records.json"
        break
    fi
done

if [ -z "$RECORDS_FILE" ]; then
    echo "Файл records.json не найден — пропуск"
    exit 0
fi

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

# Удаляем записи, которых нет в файле (только управляемые — те, что имеют совпадение по domain)
MANAGED_DOMAINS=$(echo "$DESIRED" | python3 -c "
import json,sys
domains = set(r.get('domain','') for r in json.load(sys.stdin))
print(' '.join(domains))
" 2>/dev/null || echo "")

if [ -n "$MANAGED_DOMAINS" ]; then
    while IFS= read -r line; do
        [ -z "$line" ] && continue
        REC_ID=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin).get('id',''))")
        REC_SUB=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin).get('subdomain',''))")
        REC_DOM=$(echo "$line" | python3 -c "import json,sys; print(json.load(sys.stdin).get('domain',''))")

        # Только управляемые домены
        MANAGED=false
        for MD in $MANAGED_DOMAINS; do
            [ "$REC_DOM" = "$MD" ] && MANAGED=true && break
        done
        [ "$MANAGED" = false ] && continue

        # Проверяем есть ли в desired
        IN_DESIRED=$(echo "$DESIRED" | python3 -c "
import json,sys
for r in json.load(sys.stdin):
    if r.get('subdomain') == '$REC_SUB' and r.get('domain') == '$REC_DOM':
        print('yes')
        sys.exit(0)
print('no')
" 2>/dev/null || echo "yes")

        if [ "$IN_DESIRED" = "no" ] && [ -n "$REC_ID" ]; then
            if curl -sf -X DELETE "${DNS_API_BASE}/api/records/${REC_ID}" > /dev/null 2>&1; then
                echo "  [-] ${REC_SUB}.${REC_DOM} удалена"
                DELETED=$((DELETED + 1))
            fi
        fi
    done < <(echo "$CURRENT" | python3 -c "
import json,sys
data = json.load(sys.stdin)
records = data.get('records', data if isinstance(data, list) else [])
for r in records:
    print(json.dumps(r))
")
fi

echo "  Создано: $CREATED, удалено: $DELETED"
echo "=== DNS-записи задеплоены ==="
