#!/bin/bash
# Развёртывание InfCloud — веб-календарь с нормальным интерфейсом для Mailu (Radicale).
# Требуется: Mailu с включённым календарём (add-mailu-calendar.sh), Traefik, домен почты в mailu.yml.
# InfCloud доступен по поддомену calendar.<mail-domain>; CalDAV проксируется с /dav на /webdav Mailu.
# Использование: sudo ./install-mailu-infcloud.sh [mailu-dir]
#   mailu-dir — директория Mailu (по умолчанию /opt/mailu)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAILU_DIR="${1:-/opt/mailu}"
DYNAMIC_DIR="/etc/traefik/dynamic"
MAILU_TRAEFIK="$DYNAMIC_DIR/mailu.yml"
INFCLOUD_DIR="/opt/infcloud"
INFCLOUD_PORT="8090"
INFCLOUD_IMAGE="ckulka/infcloud:latest"

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите с правами root (sudo)"
    exit 1
fi

if [ ! -f "$MAILU_TRAEFIK" ]; then
    echo "Ошибка: Не найден $MAILU_TRAEFIK. Сначала настройте Mailu и Traefik (install-mailu.sh)."
    exit 1
fi

# Домен почты и порт front из Traefik или install-config
MAIL_DOMAIN=$(grep "rule:.*Host" "$MAILU_TRAEFIK" 2>/dev/null | head -1 | grep -oE '([a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?\.)+[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?' | head -1)
if [ -z "$MAIL_DOMAIN" ] && [ -f /etc/install-config.json ]; then
    MAIL_DOMAIN=$(grep -o '"mail_domain"[[:space:]]*:[[:space:]]*"[^"]*"' /etc/install-config.json 2>/dev/null | cut -d'"' -f4)
fi
MAILU_HTTP_PORT=$(grep -oE '127\.0\.0\.1:[0-9]+' "$MAILU_TRAEFIK" 2>/dev/null | head -1 | cut -d: -f3)
[ -z "$MAILU_HTTP_PORT" ] && MAILU_HTTP_PORT="6555"

if [ -z "$MAIL_DOMAIN" ]; then
    echo "Ошибка: Не удалось определить домен почты из $MAILU_TRAEFIK"
    exit 1
fi

CALENDAR_HOST="calendar.$MAIL_DOMAIN"
INFCLOUD_TRAEFIK="$DYNAMIC_DIR/mailu-infcloud.yml"

echo "=== Установка InfCloud (веб-календарь) для Mailu ==="
echo "  Домен почты: $MAIL_DOMAIN"
echo "  Календарь:   https://$CALENDAR_HOST"
echo ""

# config.js: CalDAV по тому же поддомену через /dav (прокси в Traefik на /webdav)
mkdir -p "$INFCLOUD_DIR"
cat > "$INFCLOUD_DIR/config.js" << CONFIGJS
// InfCloud: CalDAV/CardDAV через Mailu Radicale (прокси /dav -> /webdav)
var globalNetworkCheckSettings = {
  href: "https://$CALENDAR_HOST/dav/",
  timeOut: 90000,
  lockTimeOut: 10000,
  settingsAccount: true,
  delegation: true,
  additionalResources: [],
  hrefLabel: null,
  forceReadOnly: null,
  ignoreAlarms: false,
  backgroundCalendars: []
};
CONFIGJS
chmod 644 "$INFCLOUD_DIR/config.js"
echo "[1/4] config.js создан в $INFCLOUD_DIR"

# Контейнер InfCloud
if docker ps -a --format '{{.Names}}' 2>/dev/null | grep -qx "infcloud"; then
    echo "[2/4] Контейнер infcloud уже есть, перезапуск..."
    docker stop infcloud 2>/dev/null
    docker rm infcloud 2>/dev/null
fi
docker pull "$INFCLOUD_IMAGE" 2>/dev/null || true
docker run -d --name infcloud --restart unless-stopped \
    -p "127.0.0.1:${INFCLOUD_PORT}:80" \
    -v "$INFCLOUD_DIR/config.js:/usr/share/nginx/html/config.js:ro" \
    "$INFCLOUD_IMAGE"
echo "[2/4] Контейнер InfCloud запущен на порту $INFCLOUD_PORT"

# Traefik: calendar.* -> InfCloud; calendar.*/dav -> Mailu /webdav (с подменой Host)
cat > "$INFCLOUD_TRAEFIK" << EOF
http:
  middlewares:
    mailu-calendar-dav-rewrite:
      replacePathRegex:
        regex: "^/dav(.*)"
        replacement: "/webdav\$1"
      headers:
        customRequestHeaders:
          Host: "$MAIL_DOMAIN"

  routers:
    mailu-calendar-dav:
      rule: "Host(\`$CALENDAR_HOST\`) && PathPrefix(\`/dav\`)"
      service: mailu-front
      entryPoints:
        - websecure
      middlewares:
        - mailu-calendar-dav-rewrite
      tls:
        certResolver: letsencrypt
      priority: 10

    mailu-calendar-ui:
      rule: "Host(\`$CALENDAR_HOST\`)"
      service: infcloud
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      priority: 1

  services:
    infcloud:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: "http://127.0.0.1:$INFCLOUD_PORT"
EOF
chmod 644 "$INFCLOUD_TRAEFIK"
echo "[3/4] Traefik: $INFCLOUD_TRAEFIK"

if systemctl is-active --quiet traefik 2>/dev/null; then
    systemctl reload traefik 2>/dev/null || systemctl restart traefik 2>/dev/null
    echo "[4/4] Traefik перезагружен"
else
    echo "[4/4] Traefik не запущен — перезапустите вручную после старта"
fi

echo ""
echo "=== InfCloud установлен ==="
echo "  1. Добавьте DNS: $CALENDAR_HOST -> IP этого сервера"
echo "  2. Откройте: https://$CALENDAR_HOST"
echo "  3. Вход: полный email и пароль почтового ящика (как в webmail)."
echo ""
echo "Минимальный интерфейс Radicale по-прежнему доступен: https://$MAIL_DOMAIN/webdav/.web"
echo "Кнопка «Календарь» в Roundcube может вести на любой из этих адресов."
