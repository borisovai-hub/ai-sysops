#!/bin/bash
# Деплой Traefik-конфигов из серверной папки config/<server>/traefik/
# Копирует dynamic-конфиги (auto-reload) и static-конфиг (с рестартом при изменении)
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"

TRAEFIK_DIR="/etc/traefik"
TRAEFIK_DYNAMIC_DIR="$TRAEFIK_DIR/dynamic"

echo "=== Деплой Traefik-конфигов ==="

# Определение серверной папки: config/<server>/traefik/
# Ищем первую подходящую (исключаем config/single-machine/ — это шаблон)
SERVER_CONFIG_DIR=""
for dir in "$REPO_ROOT"/config/*/traefik; do
    [ ! -d "$dir" ] && continue
    parent=$(basename "$(dirname "$dir")")
    [ "$parent" = "single-machine" ] && continue
    SERVER_CONFIG_DIR="$dir"
    echo "Серверная папка: config/$parent/traefik/"
    break
done

if [ -z "$SERVER_CONFIG_DIR" ]; then
    echo "ПРЕДУПРЕЖДЕНИЕ: серверная папка config/*/traefik/ не найдена — пропуск"
    exit 0
fi

# [1/2] Dynamic-конфиги (Traefik подхватывает автоматически)
DYNAMIC_SRC="$SERVER_CONFIG_DIR/dynamic"
if [ -d "$DYNAMIC_SRC" ]; then
    echo "Обновление dynamic-конфигов..."
    mkdir -p "$TRAEFIK_DYNAMIC_DIR"

    # Проверяем, установлена ли Authelia на сервере
    AUTHELIA_ON_SERVER=false
    if [ -f "/etc/authelia/configuration.yml" ] || systemctl is-active --quiet authelia 2>/dev/null; then
        AUTHELIA_ON_SERVER=true
    fi

    UPDATED=0
    for yml in "$DYNAMIC_SRC"/*.yml; do
        [ ! -f "$yml" ] && continue
        fname=$(basename "$yml")
        target="$TRAEFIK_DYNAMIC_DIR/$fname"

        if [ -f "$target" ] && diff -q "$yml" "$target" > /dev/null 2>&1; then
            continue
        fi

        cp "$yml" "$target"

        # Если Authelia установлена и в файле нет authelia@file — добавить
        if [ "$AUTHELIA_ON_SERVER" = true ] && ! grep -q "authelia@file" "$target"; then
            if grep -q "\-compress$" "$target"; then
                sed -i '/- .*-compress$/a\        - authelia@file' "$target"
                echo "  [OK] $fname (+authelia@file)"
            else
                echo "  [OK] $fname"
            fi
        else
            echo "  [OK] $fname"
        fi
        UPDATED=$((UPDATED + 1))
    done

    if [ "$UPDATED" -eq 0 ]; then
        echo "  Dynamic-конфиги без изменений"
    else
        echo "  Обновлено: $UPDATED файл(ов) (auto-reload)"
    fi
else
    echo "  Папка dynamic/ не найдена — пропуск"
fi

# [2/2] Static-конфиг (нужен рестарт Traefik при изменении)
STATIC_SRC="$SERVER_CONFIG_DIR/traefik.yml"
STATIC_TARGET="$TRAEFIK_DIR/traefik.yml"

if [ -f "$STATIC_SRC" ]; then
    if [ -f "$STATIC_TARGET" ] && diff -q "$STATIC_SRC" "$STATIC_TARGET" > /dev/null 2>&1; then
        echo "Static-конфиг без изменений"
    else
        echo "Обновление static-конфига..."
        cp "$STATIC_SRC" "$STATIC_TARGET"
        echo "  [OK] traefik.yml скопирован"

        # Рестарт Traefik
        if systemctl list-unit-files | grep -q traefik.service; then
            echo "  Перезапуск Traefik..."
            systemctl restart traefik
            sleep 2
            if systemctl is-active --quiet traefik; then
                echo "  [OK] Traefik запущен"
            else
                echo "  ОШИБКА: Traefik не запустился"
                journalctl -u traefik -n 20 --no-pager
                exit 1
            fi
        else
            echo "  ПРЕДУПРЕЖДЕНИЕ: systemd сервис traefik не найден"
        fi
    fi
else
    echo "Static-конфиг не найден — пропуск"
fi

echo "=== Traefik-конфиги задеплоены ==="
