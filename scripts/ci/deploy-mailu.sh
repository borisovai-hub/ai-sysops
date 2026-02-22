#!/bin/bash
# Инкрементальный деплой Mailu
# Если Mailu не установлен — пропуск
# Если установлен — обновляет PROXY_AUTH_CREATE=true для SSO через Authelia
set -e

echo "=== Деплой Mailu ==="

MAILU_DIR="/etc/mailu"
MAILU_ENV="$MAILU_DIR/mailu.env"

# Проверка установки
if [ ! -f "$MAILU_ENV" ]; then
    echo "Mailu не установлен — пропуск"
    exit 0
fi

echo "Mailu установлен, проверка обновлений..."

UPDATED=0

# ============================================================
# [1/1] PROXY_AUTH_CREATE: false → true (автосоздание mailbox при SSO)
# ============================================================
if grep -q "PROXY_AUTH_CREATE=false" "$MAILU_ENV"; then
    sed -i 's/PROXY_AUTH_CREATE=false/PROXY_AUTH_CREATE=true/' "$MAILU_ENV"
    echo "  [OK] PROXY_AUTH_CREATE=true (автосоздание mailbox при SSO)"
    UPDATED=1
elif grep -q "PROXY_AUTH_CREATE=true" "$MAILU_ENV"; then
    echo "  [Пропуск] PROXY_AUTH_CREATE уже true"
else
    echo "  [Пропуск] PROXY_AUTH не настроен (Authelia не установлена?)"
fi

# Перезапуск при изменениях
if [ $UPDATED -eq 1 ]; then
    echo ""
    echo "Перезапуск Mailu..."
    cd "$MAILU_DIR" && docker compose restart
    echo "  [OK] Mailu перезапущен"
fi

echo ""
echo "=== Деплой Mailu завершён ==="
