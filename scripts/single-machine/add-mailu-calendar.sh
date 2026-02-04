#!/bin/bash
# Добавление CalDAV/CardDAV (календарь и контакты) в уже установленный Mailu.
# Патчит docker-compose.yml и mailu.env, создаёт директорию dav, перезапускает Mailu.
# Использование: sudo ./add-mailu-calendar.sh [mailu-dir]
#   mailu-dir — директория Mailu (по умолчанию /opt/mailu)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAILU_DIR="${1:-/opt/mailu}"
MAILU_SERVICE="mailu.service"

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите с правами root (sudo)"
    exit 1
fi

if [ ! -f "$MAILU_DIR/docker-compose.yml" ] || [ ! -f "$MAILU_DIR/mailu.env" ]; then
    echo "Ошибка: В $MAILU_DIR не найдены docker-compose.yml или mailu.env. Установите Mailu или укажите правильную директорию."
    exit 1
fi

# Читаем переменные образа (нужны и для проверки "уже есть", и для добавления)
VERSION=$(grep -E '^VERSION=' "$MAILU_DIR/mailu.env" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | head -1)
[ -z "$VERSION" ] && VERSION=$(grep -E '^MAILU_VERSION=' "$MAILU_DIR/mailu.env" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | head -1)
[ -z "$VERSION" ] && VERSION="2.0"
DOCKER_ORG=$(grep -E '^DOCKER_ORG=' "$MAILU_DIR/mailu.env" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | head -1)
[ -z "$DOCKER_ORG" ] && DOCKER_ORG="ghcr.io/mailu"
DOCKER_PREFIX=$(grep -E '^DOCKER_PREFIX=' "$MAILU_DIR/mailu.env" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | head -1)
[ -z "$DOCKER_PREFIX" ] && DOCKER_PREFIX=""
RADICALE_IMAGE="${DOCKER_ORG}/${DOCKER_PREFIX}radicale:${VERSION}"

# Считаем webdav уже добавленным только если он в секции services (перед "networks:")
WEBDAV_LINE=$(grep -n '^  webdav:' "$MAILU_DIR/docker-compose.yml" 2>/dev/null | head -1 | cut -d: -f1)
NETWORKS_LINE=$(grep -n '^networks:' "$MAILU_DIR/docker-compose.yml" 2>/dev/null | head -1 | cut -d: -f1)
if [ -n "$WEBDAV_LINE" ] && [ -n "$NETWORKS_LINE" ] && [ "$WEBDAV_LINE" -lt "$NETWORKS_LINE" ]; then
    echo "Календарь (webdav) уже есть в docker-compose.yml."
    if grep -q 'image: mailu/radicale:' "$MAILU_DIR/docker-compose.yml" 2>/dev/null; then
        sed -i "s|image: mailu/radicale:.*|image: ${RADICALE_IMAGE}|" "$MAILU_DIR/docker-compose.yml"
        echo "  [OK] Образ webdav заменён на ${RADICALE_IMAGE}"
    fi
    if ! grep -q '^WEBDAV=radicale' "$MAILU_DIR/mailu.env" 2>/dev/null; then
        if grep -q '^WEBDAV=' "$MAILU_DIR/mailu.env"; then
            sed -i 's/^WEBDAV=.*/WEBDAV=radicale/' "$MAILU_DIR/mailu.env"
        else
            echo "WEBDAV=radicale" >> "$MAILU_DIR/mailu.env"
        fi
        echo "  [OK] В mailu.env установлено WEBDAV=radicale"
    fi
    if ! grep -A 25 '^  webdav:' "$MAILU_DIR/docker-compose.yml" | head -26 | grep -q 'depends_on:'; then
        awk 'BEGIN{added=0} /^  webdav:/{w=1;has_dep=0} w&&/depends_on:/{has_dep=1} w&&/^  [a-zA-Z][a-zA-Z0-9]*:/&&!/^  webdav/{w=0} w&&/dav:\/data/&&!has_dep&&!added{print;print "    depends_on:";print "      - front";added=1;next} {print}' "$MAILU_DIR/docker-compose.yml" > "$MAILU_DIR/docker-compose.yml.tmp" && mv "$MAILU_DIR/docker-compose.yml.tmp" "$MAILU_DIR/docker-compose.yml"
        echo "  [OK] Патч webdav (depends_on: front) применён"
    fi
    echo "Перезапуск Mailu и пересоздание front (чтобы подхватить WEBDAV)..."
    systemctl restart "$MAILU_SERVICE" 2>/dev/null || true
    (cd "$MAILU_DIR" && (docker compose -f docker-compose.yml --env-file mailu.env up -d --force-recreate front 2>/dev/null || docker-compose -f docker-compose.yml --env-file mailu.env up -d --force-recreate front 2>/dev/null || true))
    echo "[OK] Календарь уже был включён, конфиг обновлён, Mailu перезапущен."
    exit 0
fi

ROOT=$(grep -E '^ROOT=' "$MAILU_DIR/mailu.env" 2>/dev/null | cut -d'=' -f2- | tr -d '"' | head -1)
[ -z "$ROOT" ] && ROOT="/opt/mailu"
ENV_FILE="mailu.env"

if grep -q '^WEBDAV=' "$MAILU_DIR/mailu.env"; then
    sed -i 's/^WEBDAV=.*/WEBDAV=radicale/' "$MAILU_DIR/mailu.env"
else
    echo "" >> "$MAILU_DIR/mailu.env"
    echo "# CalDAV/CardDAV (календарь и контакты)" >> "$MAILU_DIR/mailu.env"
    echo "WEBDAV=radicale" >> "$MAILU_DIR/mailu.env"
fi
echo "[1/5] WEBDAV=radicale добавлено в mailu.env"

mkdir -p "$MAILU_DIR/dav"
echo "[2/5] Директория $MAILU_DIR/dav создана"

# Удаляем ошибочный блок "  webdav:" из секции networks (если был добавлен в конец файла ранее)
awk '
/^networks:/ { in_networks = 1; skip_webdav = 0 }
in_networks && /^  webdav:/ { skip_webdav = 1; next }
skip_webdav && /^  [a-zA-Z][a-zA-Z0-9]*:/ { skip_webdav = 0 }
skip_webdav { next }
{ print }
' "$MAILU_DIR/docker-compose.yml" > "$MAILU_DIR/docker-compose.yml.tmp" && mv "$MAILU_DIR/docker-compose.yml.tmp" "$MAILU_DIR/docker-compose.yml"

# Вставляем сервис webdav перед секцией "networks:"
WEBDAV_TMP=$(mktemp)
cat > "$WEBDAV_TMP" << EOF
  webdav:
    image: ${RADICALE_IMAGE}
    restart: always
    env_file: ${ENV_FILE}
    volumes:
      - "${ROOT}/dav:/data"
    depends_on:
      - front

EOF
awk -v blockfile="$WEBDAV_TMP" '
BEGIN { done = 0 }
/^networks:/ && !done {
  while ((getline line < blockfile) > 0) print line
  close(blockfile)
  done = 1
}
{ print }
' "$MAILU_DIR/docker-compose.yml" > "$MAILU_DIR/docker-compose.yml.tmp" && mv "$MAILU_DIR/docker-compose.yml.tmp" "$MAILU_DIR/docker-compose.yml"
rm -f "$WEBDAV_TMP"
echo "[3/5] Сервис webdav добавлен в docker-compose.yml (перед секцией networks)"

echo "[4/5] Перезапуск Mailu..."
if systemctl is-enabled "$MAILU_SERVICE" &>/dev/null; then
    systemctl restart "$MAILU_SERVICE"
else
    (cd "$MAILU_DIR" && (docker compose -f docker-compose.yml --env-file mailu.env up -d 2>/dev/null || docker-compose -f docker-compose.yml --env-file mailu.env up -d))
fi

echo "[5/5] Пересоздание front (nginx), чтобы подхватить WEBDAV=radicale..."
(cd "$MAILU_DIR" && (docker compose -f docker-compose.yml --env-file mailu.env up -d --force-recreate front 2>/dev/null || docker-compose -f docker-compose.yml --env-file mailu.env up -d --force-recreate front 2>/dev/null || true))

sleep 5
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q "mailu-webdav\|mailu_webdav"; then
    echo ""
    echo "=== Календарь добавлен в Mailu ==="
    echo "Прямая ссылка на календарь (тот же домен, что и webmail; можно добавить в закладки):"
    echo "  https://<ваш-mail-домен>/webdav/.web"
    echo ""
    echo "Пользователи календаря = пользователи почты (одни и те же учётки):"
    echo "  - Вход в календарь: полный email и пароль почтового ящика (как в webmail)."
    echo "  - Чтобы «добавить пользователя» в календарь: создайте почтовый ящик в админке Mailu"
    echo "    (https://<домен>/admin → Mailboxes → Add mailbox) — он сразу сможет входить в календарь."
    echo "  - Отдельной регистрации в календаре нет: календарь и почта используют одни учётные записи."
    echo ""
    echo "Кнопка «Календарь» в Roundcube: sudo ./setup-mailu-calendar-roundcube.sh $MAILU_DIR  (из каталога scripts/single-machine)"
    echo "Или откройте ссылку вручную / настройте клиент (Thunderbird, телефон) по CalDAV."
    echo ""
    echo "Полноценный веб-календарь (InfCloud): sudo ./install-mailu-infcloud.sh $MAILU_DIR  — затем https://calendar.<ваш-mail-домен>"
else
    echo "Предупреждение: контейнер webdav мог не запуститься. Проверьте: docker ps | grep webdav"
    echo "Логи: cd $MAILU_DIR && docker compose -f docker-compose.yml --env-file mailu.env logs webdav"
fi
