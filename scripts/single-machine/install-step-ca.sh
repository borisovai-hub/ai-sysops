#!/bin/bash
# Скрипт установки step-ca (self-hosted PKI для mTLS канала admin↔node-agent)
# Использование: sudo ./install-step-ca.sh [--force]
#
# Устанавливает step-ca на primary сервер и настраивает:
# - Бинарники /usr/local/bin/step-ca, /usr/local/bin/step
# - Конфиг /etc/step-ca/ (root, intermediate, ca.json, db)
# - JWK provisioner "admin-bootstrap" — для одноразового enroll новых агентов
# - ACME provisioner "agents" — для авто-обновления cert после первичного enroll
# - Systemd unit step-ca.service (listen 127.0.0.1:9000)
# - Cert lifetime: 24h, renewal-grace 8h
# - DNS: ca.tunnel.<base_domain> (для Traefik TCP passthrough)
# - Backup: /var/backups/step-ca/ (ежедневный db+secrets)
#
# Параметры:
#   --force  - переустановить (пересоздаёт CA, инвалидирует все cert'ы агентов!)
#
# ВАЖНО: после первой установки root key обязательно перенести оффлайн
# (см. /root/.borisovai-credentials/step-ca-root-export-instructions.txt)

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Предупреждение: common.sh не найден"
fi

set +e

FORCE_MODE=false
STEP_VERSION="0.28.2"

for arg in "$@"; do
    case $arg in
        --force) FORCE_MODE=true ;;
    esac
done

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: запустите с правами root (sudo)"
    exit 1
fi

# Проверка идемпотентности
if [ "$FORCE_MODE" != true ]; then
    if [ -f "/usr/local/bin/step-ca" ] && [ -f "/etc/step-ca/config/ca.json" ] && is_service_installed "step-ca.service" 2>/dev/null; then
        echo "  [Пропуск] step-ca уже установлен"
        if is_service_running "step-ca.service" 2>/dev/null; then
            echo "  [OK] step-ca запущен"
        else
            echo "  [Предупреждение] step-ca установлен, но не запущен — запускаю"
            systemctl start step-ca
        fi
        exit 0
    fi
fi

echo ""
echo "=== Установка step-ca (внутренний PKI) ==="
echo ""

# ============================================================
# [1/8] Скачивание step-ca и step CLI
# ============================================================
echo "[1/8] Скачивание step-ca v${STEP_VERSION} и step CLI..."

ARCH=$(uname -m)
case $ARCH in
    x86_64)  ARCH_NAME="amd64" ;;
    aarch64) ARCH_NAME="arm64" ;;
    *)
        echo "  [ОШИБКА] Неподдерживаемая архитектура: $ARCH"
        exit 1
        ;;
esac

NEED_DOWNLOAD=false
if [ "$FORCE_MODE" = true ] || [ ! -f "/usr/local/bin/step-ca" ] || [ ! -f "/usr/local/bin/step" ]; then
    NEED_DOWNLOAD=true
else
    INSTALLED_VERSION=$(/usr/local/bin/step-ca version 2>/dev/null | head -1 | awk '{print $2}' | tr -d 'v' || echo "unknown")
    if [ "$INSTALLED_VERSION" != "$STEP_VERSION" ]; then
        echo "  Обновление с v${INSTALLED_VERSION} до v${STEP_VERSION}"
        NEED_DOWNLOAD=true
    else
        echo "  [Пропуск] step-ca v${STEP_VERSION} уже установлен"
    fi
fi

if [ "$NEED_DOWNLOAD" = true ]; then
    TMP_DIR=$(mktemp -d)

    # step-ca бинарь
    STEPCA_URL="https://github.com/smallstep/certificates/releases/download/v${STEP_VERSION}/step-ca_linux_${STEP_VERSION}_${ARCH_NAME}.tar.gz"
    if ! curl -fsSL -o "${TMP_DIR}/step-ca.tar.gz" "$STEPCA_URL"; then
        echo "  [ОШИБКА] Не удалось скачать ${STEPCA_URL}"
        rm -rf "$TMP_DIR"
        exit 1
    fi
    tar -xzf "${TMP_DIR}/step-ca.tar.gz" -C "$TMP_DIR"
    # step-ca архив имеет плоскую структуру (binary в корне), step CLI — в bin/
    cp "${TMP_DIR}/step-ca" /usr/local/bin/step-ca
    chmod +x /usr/local/bin/step-ca

    # step CLI бинарь (отдельный релиз)
    STEPCLI_URL="https://github.com/smallstep/cli/releases/download/v${STEP_VERSION}/step_linux_${STEP_VERSION}_${ARCH_NAME}.tar.gz"
    if ! curl -fsSL -o "${TMP_DIR}/step.tar.gz" "$STEPCLI_URL"; then
        echo "  [ОШИБКА] Не удалось скачать ${STEPCLI_URL}"
        rm -rf "$TMP_DIR"
        exit 1
    fi
    tar -xzf "${TMP_DIR}/step.tar.gz" -C "$TMP_DIR"
    cp "${TMP_DIR}/step_${STEP_VERSION}/bin/step" /usr/local/bin/step
    chmod +x /usr/local/bin/step

    rm -rf "$TMP_DIR"
    echo "  [OK] step-ca + step v${STEP_VERSION} установлены"
fi

# ============================================================
# [2/8] Конфигурация портов и DNS
# ============================================================
echo "[2/8] Конфигурация портов и DNS..."

STEP_CA_PORT=$(get_config_value "step_ca_port")
[ -z "$STEP_CA_PORT" ] && STEP_CA_PORT="9000"
save_config_value "step_ca_port" "$STEP_CA_PORT"

STEP_CA_PREFIX=$(get_config_value "step_ca_prefix")
[ -z "$STEP_CA_PREFIX" ] && STEP_CA_PREFIX="ca.tunnel"
save_config_value "step_ca_prefix" "$STEP_CA_PREFIX"

# CA name
STEP_CA_NAME=$(get_config_value "step_ca_name")
[ -z "$STEP_CA_NAME" ] && STEP_CA_NAME="borisovai-internal"
save_config_value "step_ca_name" "$STEP_CA_NAME"

# Cert lifetime (по умолчанию 24h)
STEP_CA_DEFAULT_DUR=$(get_config_value "step_ca_default_dur")
[ -z "$STEP_CA_DEFAULT_DUR" ] && STEP_CA_DEFAULT_DUR="24h"
save_config_value "step_ca_default_dur" "$STEP_CA_DEFAULT_DUR"

# Сбор всех DNS-имён CA из base_domains
CA_DNS_NAMES="127.0.0.1,localhost"
while IFS= read -r base; do
    [ -z "$base" ] && continue
    CA_DNS_NAMES="${CA_DNS_NAMES},${STEP_CA_PREFIX}.${base}"
done < <(get_base_domains)

# Первый base_domain — для DNS-записи и ссылок
FIRST_BASE=$(get_base_domains | head -1)
if [ -z "$FIRST_BASE" ]; then
    echo "  [ОШИБКА] Базовые домены не настроены (base_domains пуст)"
    exit 1
fi
CA_PRIMARY_DNS="${STEP_CA_PREFIX}.${FIRST_BASE}"

echo "  Listen:        127.0.0.1:${STEP_CA_PORT}"
echo "  CA name:       ${STEP_CA_NAME}"
echo "  Primary DNS:   ${CA_PRIMARY_DNS}"
echo "  All DNS SANs:  ${CA_DNS_NAMES}"
echo "  Cert lifetime: ${STEP_CA_DEFAULT_DUR}"

# ============================================================
# [3/8] step ca init (генерация root + intermediate)
# ============================================================
echo "[3/8] Инициализация PKI..."

STEPPATH="/etc/step-ca"
SECRETS_DIR="${STEPPATH}/secrets"
EXPORT_DIR="${STEPPATH}/root-export"

# Если --force и старая инсталляция есть — backup и стереть
if [ "$FORCE_MODE" = true ] && [ -d "$STEPPATH/config" ]; then
    BACKUP_DIR="/var/backups/step-ca/pre-force-$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    echo "  [WARN] --force: бэкап старой инсталляции в ${BACKUP_DIR}"
    cp -a "$STEPPATH" "$BACKUP_DIR/" 2>/dev/null
    rm -rf "${STEPPATH}/config" "${STEPPATH}/certs" "${STEPPATH}/secrets" "${STEPPATH}/db" "${STEPPATH}/templates"
fi

mkdir -p "$STEPPATH" "$SECRETS_DIR" "$EXPORT_DIR"
chmod 700 "$SECRETS_DIR"

if [ ! -f "${STEPPATH}/config/ca.json" ]; then
    # Генерация паролей для root и provisioner
    CA_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-40)
    PROV_PASSWORD=$(openssl rand -base64 32 | tr -d "=+/" | cut -c1-40)

    echo -n "$CA_PASSWORD" > "${SECRETS_DIR}/password"
    echo -n "$PROV_PASSWORD" > "${SECRETS_DIR}/provisioner-password"
    chmod 600 "${SECRETS_DIR}/password" "${SECRETS_DIR}/provisioner-password"

    # step ca init non-interactive
    export STEPPATH
    /usr/local/bin/step ca init \
        --name="$STEP_CA_NAME" \
        --dns="$CA_DNS_NAMES" \
        --address="127.0.0.1:${STEP_CA_PORT}" \
        --provisioner="admin-bootstrap" \
        --password-file="${SECRETS_DIR}/password" \
        --provisioner-password-file="${SECRETS_DIR}/provisioner-password" \
        --ssh=false \
        --acme \
        --no-db=false 2>&1 | tail -20

    if [ ! -f "${STEPPATH}/config/ca.json" ]; then
        echo "  [ОШИБКА] step ca init не создал ca.json"
        exit 1
    fi
    echo "  [OK] PKI инициализирован"

    # Экспорт root для оффлайн-бэкапа
    cp "${STEPPATH}/certs/root_ca.crt" "${EXPORT_DIR}/root_ca.crt"
    cp "${STEPPATH}/secrets/root_ca_key" "${EXPORT_DIR}/root_ca_key.encrypted"
    chmod 600 "${EXPORT_DIR}"/*

    # Инструкции по выносу root оффлайн
    cat > "${EXPORT_DIR}/README_OFFLINE_BACKUP.txt" << EOF
=== Перенос root key оффлайн (КРИТИЧНО!) ===

После проверки работы step-ca выполните:

1. Скопируйте на зашифрованную флешку:
     ${EXPORT_DIR}/root_ca.crt
     ${EXPORT_DIR}/root_ca_key.encrypted

2. Скопируйте также пароль для расшифровки:
     ${SECRETS_DIR}/password

3. Положите флешку в физический сейф.

4. Создайте вторую копию (зашифрованный архив в облачный backup):
     tar czf root-backup.tgz -C ${STEPPATH} secrets/password root-export/
     gpg --symmetric --cipher-algo AES256 root-backup.tgz
     # Загрузите root-backup.tgz.gpg в облачный backup
     rm root-backup.tgz

5. После переноса УДАЛИТЕ файлы экспорта с сервера:
     shred -u ${EXPORT_DIR}/root_ca_key.encrypted
     rm ${EXPORT_DIR}/README_OFFLINE_BACKUP.txt

   ВАЖНО: root_ca.crt и intermediate_ca.crt должны остаться в
   ${STEPPATH}/certs/ — они нужны для работы CA. УДАЛЯЕТСЯ только
   КОПИЯ root_ca_key.encrypted из root-export/, не оригинал из secrets/.

6. Настройте напоминание о тесте восстановления каждые 6 месяцев:
     crontab -l | grep step-ca-restore-test
     # echo "0 0 1 1,7 * /root/scripts/step-ca-restore-test.sh"

CA password (нужен для расшифровки root key) — В ОТДЕЛЬНОМ ХРАНИЛИЩЕ
от самого ключа. Не на той же флешке. Хранится в:
  ${SECRETS_DIR}/password (на сервере, root only)

Пароль и ключ вместе = компрометация. Раздельно = безопасно.
EOF
    chmod 600 "${EXPORT_DIR}/README_OFFLINE_BACKUP.txt"
else
    echo "  [Пропуск] PKI уже инициализирован"
fi

# ============================================================
# [4/8] Кастомизация ca.json (lifetime, политика SAN)
# ============================================================
echo "[4/8] Настройка политики (lifetime, SAN whitelist)..."

CA_JSON="${STEPPATH}/config/ca.json"

# Backup перед правкой
cp "$CA_JSON" "${CA_JSON}.backup.$(date +%Y%m%d_%H%M%S)"

# Установка default cert duration через jq (smallstep ставит jq как зависимость)
if ! command -v jq &>/dev/null; then
    apt-get install -y jq 2>&1 | tail -2
fi

# Устанавливаем default/max claims на provisioner-ах
# admin-bootstrap (JWK) — 24h max
# agents (ACME) — 24h max + 8h renewal grace
TMP_JSON=$(mktemp)
jq --arg dur "$STEP_CA_DEFAULT_DUR" '
  .authority.claims = {
    "minTLSCertDuration": "5m",
    "maxTLSCertDuration": "24h",
    "defaultTLSCertDuration": $dur,
    "renewalPeriod": "8h",
    "disableRenewal": false
  }
' "$CA_JSON" > "$TMP_JSON" && mv "$TMP_JSON" "$CA_JSON"

chmod 600 "$CA_JSON"
echo "  [OK] Default lifetime: ${STEP_CA_DEFAULT_DUR}, max: 24h, renewal grace: 8h"

# ============================================================
# [5/8] Systemd unit
# ============================================================
echo "[5/8] Настройка systemd..."

SYSTEMD_UNIT="/etc/systemd/system/step-ca.service"

if [ "$FORCE_MODE" = true ] || [ ! -f "$SYSTEMD_UNIT" ]; then
    [ -f "$SYSTEMD_UNIT" ] && cp "$SYSTEMD_UNIT" "${SYSTEMD_UNIT}.backup.$(date +%Y%m%d_%H%M%S)"
    cat > "$SYSTEMD_UNIT" << EOF
[Unit]
Description=step-ca (internal PKI)
After=network.target
ConditionFileNotEmpty=${STEPPATH}/config/ca.json
StartLimitIntervalSec=30
StartLimitBurst=3

[Service]
Type=simple
Environment=STEPPATH=${STEPPATH}
WorkingDirectory=${STEPPATH}
ExecStart=/usr/local/bin/step-ca config/ca.json --password-file=${SECRETS_DIR}/password
ExecReload=/bin/kill -HUP \$MAINPID
Restart=on-failure
RestartSec=5
LimitNOFILE=65536
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=${STEPPATH} /var/log
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true

[Install]
WantedBy=multi-user.target
EOF
    chmod 644 "$SYSTEMD_UNIT"
    echo "  [OK] Создан ${SYSTEMD_UNIT}"
else
    echo "  [Пропуск] Systemd unit уже существует"
fi

systemctl daemon-reload
systemctl enable step-ca

if systemctl is-active --quiet step-ca 2>/dev/null; then
    systemctl restart step-ca
else
    systemctl start step-ca
fi

sleep 3
if systemctl is-active --quiet step-ca; then
    echo "  [OK] step-ca запущен"
else
    echo ""
    echo "[ОШИБКА] step-ca не запустился"
    echo "Логи: journalctl -u step-ca -n 50"
    exit 1
fi

# Health check
sleep 2
if curl -sk "https://127.0.0.1:${STEP_CA_PORT}/health" | grep -q '"status":"ok"'; then
    echo "  [OK] /health отвечает ok"
else
    echo "  [Предупреждение] /health не отвечает ok — проверьте журнал"
fi

# ============================================================
# [6/8] DNS запись для ca.tunnel.<base_domain>
# ============================================================
echo "[6/8] Создание DNS записей..."

# IPv4 only — ifconfig.me на dual-stack хостах возвращает AAAA, что ломает DNS A-записи
SERVER_IP=$(curl -s4 ifconfig.me 2>/dev/null || curl -s4 ifconfig.co 2>/dev/null || ip -4 route get 1 2>/dev/null | awk '{print $7; exit}')
if [ -z "$SERVER_IP" ]; then
    echo "  [Предупреждение] Не удалось определить IP"
    echo "  Создайте вручную: ${STEP_CA_PREFIX}.<base_domain> → A → <ip>"
else
    DNS_API="http://127.0.0.1:5353/api/records"
    while IFS= read -r base; do
        [ -z "$base" ] && continue
        curl -s -X POST -H "Content-Type: application/json" \
            -d "{\"subdomain\":\"${STEP_CA_PREFIX}\",\"domain\":\"${base}\",\"ip\":\"${SERVER_IP}\"}" \
            "$DNS_API" 2>/dev/null
        echo "  [OK] ${STEP_CA_PREFIX}.${base} → ${SERVER_IP}"
    done < <(get_base_domains)
fi

# ============================================================
# [7/8] Backup-cron для step-ca DB
# ============================================================
echo "[7/8] Настройка ежедневного backup..."

BACKUP_DIR="/var/backups/step-ca"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

CRON_SCRIPT="/usr/local/sbin/step-ca-backup.sh"
cat > "$CRON_SCRIPT" << 'EOF'
#!/bin/bash
# Ежедневный backup step-ca DB и issued certs registry
set -e
TS=$(date +%Y%m%d)
DEST="/var/backups/step-ca/step-ca-${TS}.tgz"
tar czf "$DEST" -C /etc/step-ca db config certs 2>/dev/null
chmod 600 "$DEST"
# Хранить 30 дней
find /var/backups/step-ca -name 'step-ca-*.tgz' -mtime +30 -delete 2>/dev/null
EOF
chmod +x "$CRON_SCRIPT"

CRON_LINE="0 3 * * * ${CRON_SCRIPT}"
( crontab -l 2>/dev/null | grep -v "step-ca-backup" ; echo "$CRON_LINE" ) | crontab -
echo "  [OK] Cron: ежедневно в 03:00, retention 30 дней (${BACKUP_DIR})"

# ============================================================
# [8/8] Сохранение секретов и инструкций
# ============================================================
echo "[8/8] Сохранение credentials..."

CRED_DIR="/root/.borisovai-credentials"
mkdir -p "$CRED_DIR"
chmod 700 "$CRED_DIR"

# Извлечение fingerprint root cert (нужен для bootstrap агентов)
ROOT_FP=$(/usr/local/bin/step certificate fingerprint "${STEPPATH}/certs/root_ca.crt" 2>/dev/null || echo "RUN: step certificate fingerprint /etc/step-ca/certs/root_ca.crt")

cat > "$CRED_DIR/step-ca" << CRED_EOF
# step-ca credentials ($(date '+%Y-%m-%d %H:%M:%S'))
ca_url=https://127.0.0.1:${STEP_CA_PORT}
ca_url_external=https://${CA_PRIMARY_DNS}
ca_name=${STEP_CA_NAME}
default_cert_lifetime=${STEP_CA_DEFAULT_DUR}
root_fingerprint=${ROOT_FP}

# Пароли — в /etc/step-ca/secrets/ (root only)
ca_password_file=/etc/step-ca/secrets/password
provisioner_password_file=/etc/step-ca/secrets/provisioner-password

# Бутстрап нового агента:
#   step ca bootstrap --ca-url=https://${CA_PRIMARY_DNS} --fingerprint=${ROOT_FP}
#   step ca token <agent-san>  # выдать токен из admin-bootstrap provisioner
#   step ca certificate <agent-san> agent.crt agent.key --token=<token>
CRED_EOF
chmod 600 "$CRED_DIR/step-ca"

echo ""
echo "=== Установка step-ca завершена ==="
echo ""
echo "  CA:                ${STEP_CA_NAME}"
echo "  Internal URL:      https://127.0.0.1:${STEP_CA_PORT}"
echo "  External URL:      https://${CA_PRIMARY_DNS} (через Traefik passthrough)"
echo "  Root fingerprint:  ${ROOT_FP}"
echo "  Cert lifetime:     ${STEP_CA_DEFAULT_DUR} (max 24h, renewal 8h)"
echo ""
echo "  Provisioners:"
echo "    admin-bootstrap (JWK) — для первичного enroll агентов"
echo "    acme            (ACME) — для авто-обновления cert"
echo ""
echo "  Файлы:"
echo "    PKI:             ${STEPPATH}/"
echo "    Credentials:     ${CRED_DIR}/step-ca"
echo "    Backup cron:     ${CRON_SCRIPT} (03:00 daily)"
echo "    Backup dir:      ${BACKUP_DIR}/"
echo ""
echo "  ⚠️  СЛЕДУЮЩИЙ ШАГ — оффлайн-backup root key:"
echo "    cat ${EXPORT_DIR}/README_OFFLINE_BACKUP.txt"
echo ""
echo "  Проверка:"
echo "    systemctl status step-ca"
echo "    curl -sk https://127.0.0.1:${STEP_CA_PORT}/health"
echo "    /usr/local/bin/step ca provisioner list --ca-url=https://127.0.0.1:${STEP_CA_PORT} --root=${STEPPATH}/certs/root_ca.crt"
echo ""
