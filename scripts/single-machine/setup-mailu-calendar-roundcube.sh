#!/bin/bash
# Установка кнопки "Календарь" в интерфейсе Roundcube (Mailu).
# Копирует плагин calendar_link в overrides/roundcube и добавляет конфиг.
# Использование: sudo ./setup-mailu-calendar-roundcube.sh [mailu-dir]
# Требуется: уже добавленный календарь (add-mailu-calendar.sh) и перезапущенный front.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAILU_DIR="${1:-/opt/mailu}"
PLUGIN_SRC="$SCRIPT_DIR/roundcube-calendar-link"
OVERRIDES_PLUGINS="$MAILU_DIR/overrides/roundcube/plugins"
OVERRIDES_CONFIG="$MAILU_DIR/overrides/roundcube/config"
OVERRIDES_CONFIGD="$MAILU_DIR/overrides/roundcube/config.d"

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите с правами root (sudo)"
    exit 1
fi

if [ ! -d "$PLUGIN_SRC" ] || [ ! -f "$PLUGIN_SRC/calendar_link.php" ]; then
    echo "Ошибка: Плагин не найден в $PLUGIN_SRC"
    exit 1
fi

if [ ! -f "$MAILU_DIR/docker-compose.yml" ]; then
    echo "Ошибка: Mailu не найден в $MAILU_DIR"
    exit 1
fi

mkdir -p "$OVERRIDES_PLUGINS" "$OVERRIDES_CONFIG" "$OVERRIDES_CONFIGD"

echo "[1/3] Копирование плагина calendar_link в overrides/roundcube/plugins/..."
rm -rf "$OVERRIDES_PLUGINS/calendar_link"
cp -r "$PLUGIN_SRC" "$OVERRIDES_PLUGINS/calendar_link"
chown -R root:root "$OVERRIDES_PLUGINS/calendar_link"
chmod -R 755 "$OVERRIDES_PLUGINS/calendar_link"

echo "[2/3] Добавление плагина в конфиг Roundcube..."
CONFIG_TEMPLATE="$PLUGIN_SRC/99-calendar-link.inc.php"
for CONFIG_ADD in "$OVERRIDES_CONFIGD/99-calendar-link.inc.php" "$OVERRIDES_CONFIG/99-calendar-link.inc.php"; do
    if [ ! -f "$CONFIG_ADD" ] && [ -f "$CONFIG_TEMPLATE" ]; then
        cp "$CONFIG_TEMPLATE" "$CONFIG_ADD"
        chmod 644 "$CONFIG_ADD"
        echo "  Создан $CONFIG_ADD"
    fi
done

echo "[3/3] Пересоздание контейнера webmail..."
(cd "$MAILU_DIR" && (docker compose -f docker-compose.yml --env-file mailu.env up -d --force-recreate webmail 2>/dev/null || docker-compose -f docker-compose.yml --env-file mailu.env up -d --force-recreate webmail 2>/dev/null || true))

echo ""
echo "=== Календарь (прямая ссылка) ==="
echo "Да, webmail (Roundcube) — то место, где должна быть кнопка «Календарь»."
echo "Если кнопки нет (образ Mailu часто не подхватывает overrides/plugins), используйте прямую ссылку:"
echo ""
echo "  https://ВАШ-MAIL-ДОМЕН/webdav/.web"
echo ""
echo "  (подставьте ваш домен почты, например https://mail.example.com/webdav/.web)"
echo "  Вход: полный email и пароль почтового ящика. Добавьте ссылку в закладки браузера."
echo ""
echo "Если кнопка не появилась в Roundcube:"
echo "  1. Образ Mailu webmail может не монтировать overrides/plugins."
echo "  2. Ручная установка плагина в контейнер:"
echo "     docker cp $OVERRIDES_PLUGINS/calendar_link \$(docker ps -q -f name=webmail):/var/www/html/plugins/"
echo "     Затем добавьте 'calendar_link' в список plugins в конфиге Roundcube и перезапустите webmail."
