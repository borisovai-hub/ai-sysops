#!/bin/bash
# Деплой Authelia users из GitOps-файлов config/<server>/authelia/
# Копирует users_database.yml и user-mailboxes.json на сервер + рестарт Authelia
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

echo "=== Деплой Authelia users ==="

# Если Authelia не установлена — пропуск
if [ ! -f "/usr/local/bin/authelia" ]; then
    echo "Authelia не установлена — пропуск"
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
AUTHELIA_SRC="$SERVER_DIR/authelia"

if [ -z "$SERVER_DIR" ] || [ ! -d "$AUTHELIA_SRC" ]; then
    echo "Папка authelia/ не найдена — пропуск"
    exit 0
fi
echo "Источник: $AUTHELIA_SRC/"

UPDATED=0

# [1/2] users_database.yml
USERS_SRC="$AUTHELIA_SRC/users_database.yml"
USERS_TARGET="/etc/authelia/users_database.yml"

if [ -f "$USERS_SRC" ]; then
    if [ -f "$USERS_TARGET" ] && diff -q "$USERS_SRC" "$USERS_TARGET" > /dev/null 2>&1; then
        echo "  [OK] users_database.yml без изменений"
    else
        # Backup
        [ -f "$USERS_TARGET" ] && cp "$USERS_TARGET" "${USERS_TARGET}.backup"
        cp "$USERS_SRC" "$USERS_TARGET"
        chown authelia:authelia "$USERS_TARGET"
        chmod 600 "$USERS_TARGET"
        echo "  [OK] users_database.yml обновлён"
        UPDATED=$((UPDATED + 1))
    fi
else
    echo "  users_database.yml не найден в репо — пропуск"
fi

# [2/2] user-mailboxes.json
MAILBOXES_SRC="$AUTHELIA_SRC/user-mailboxes.json"
MAILBOXES_TARGET="/etc/management-ui/user-mailboxes.json"

if [ -f "$MAILBOXES_SRC" ]; then
    if [ -f "$MAILBOXES_TARGET" ] && diff -q "$MAILBOXES_SRC" "$MAILBOXES_TARGET" > /dev/null 2>&1; then
        echo "  [OK] user-mailboxes.json без изменений"
    else
        cp "$MAILBOXES_SRC" "$MAILBOXES_TARGET"
        echo "  [OK] user-mailboxes.json обновлён"
        UPDATED=$((UPDATED + 1))
    fi
else
    echo "  user-mailboxes.json не найден в репо — пропуск"
fi

# Рестарт Authelia при изменениях
if [ "$UPDATED" -gt 0 ]; then
    echo "  Обновлено: $UPDATED файл(ов)"
    if systemctl is-active --quiet authelia 2>/dev/null; then
        echo "  Перезапуск Authelia..."
        systemctl restart authelia
        sleep 2
        if systemctl is-active --quiet authelia; then
            echo "  [OK] Authelia перезапущена"
        else
            echo "  [ОШИБКА] Authelia не запустилась"
        fi
    fi
else
    echo "  Без изменений"
fi

echo "=== Authelia users задеплоены ==="
