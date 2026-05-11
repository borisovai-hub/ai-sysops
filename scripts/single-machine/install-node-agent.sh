#!/bin/bash
# Скрипт установки node-agent (HTTPS+mTLS агент управляемого сервера)
# Использование:
#   sudo ./install-node-agent.sh --bootstrap-token <JWK> [--server-name <name>] [--ca-url <url>] [--force]
#   sudo ./install-node-agent.sh --local-bootstrap   # для primary, где step-ca на 127.0.0.1
#
# Что делает:
# 1. Устанавливает Node.js 20+ если нет
# 2. Копирует management-ui/node-agent/ → /opt/node-agent/, npm ci + build
# 3. Получает cert от step-ca через JWK токен (--bootstrap-token) или локально
# 4. Пишет /etc/node-agent/config.json (server_name, listen, cert paths, allowed_client_sans)
# 5. Systemd unit node-agent.service + cert-renew timer
#
# Параметры:
#   --bootstrap-token <JWK>   JWK токен от step-ca (одноразовый, выдан в админке)
#   --local-bootstrap         Локальный bootstrap (только для primary с step-ca на той же машине)
#   --server-name <name>      Имя сервера (default: hostname без vmi-prefix)
#   --ca-url <url>            URL step-ca (default: https://ca.tunnel.<base_domain> или localhost для local)
#   --listen <host:port>      Default: 127.0.0.1:7180 (primary) / 0.0.0.0:7180 (secondary, за туннелем)
#   --allowed-client-san <s>  CN/SAN админ-клиента (default: admin@contabo-sm-139)
#   --force                   Переустановить

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SOURCE_DIR="$(cd "$SCRIPT_DIR/../../management-ui/node-agent" && pwd 2>/dev/null)"

if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
fi

set +e

FORCE_MODE=false
BOOTSTRAP_TOKEN=""
LOCAL_BOOTSTRAP=false
SERVER_NAME=""
CA_URL=""
LISTEN=""
ALLOWED_SAN="admin@contabo-sm-139"
NODE_AGENT_PORT=7180

while [[ $# -gt 0 ]]; do
    case $1 in
        --force) FORCE_MODE=true; shift ;;
        --bootstrap-token) BOOTSTRAP_TOKEN="$2"; shift 2 ;;
        --local-bootstrap) LOCAL_BOOTSTRAP=true; shift ;;
        --server-name) SERVER_NAME="$2"; shift 2 ;;
        --ca-url) CA_URL="$2"; shift 2 ;;
        --listen) LISTEN="$2"; shift 2 ;;
        --allowed-client-san) ALLOWED_SAN="$2"; shift 2 ;;
        *) echo "Неизвестный аргумент: $1"; exit 1 ;;
    esac
done

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: запустите с правами root (sudo)"
    exit 1
fi

if [ -z "$BOOTSTRAP_TOKEN" ] && [ "$LOCAL_BOOTSTRAP" != true ] && [ ! -f /etc/node-agent/certs/agent.crt ]; then
    echo "Ошибка: укажите --bootstrap-token <JWK> или --local-bootstrap"
    echo "        (или запустите без аргументов после первичной установки)"
    exit 1
fi

# Auto-detect server-name
if [ -z "$SERVER_NAME" ]; then
    HN=$(hostname)
    case $HN in
        vmi3037455*) SERVER_NAME="contabo-sm-139" ;;
        *) SERVER_NAME=$(get_config_value "server_name" 2>/dev/null) ;;
    esac
    [ -z "$SERVER_NAME" ] && SERVER_NAME="$HN"
fi

PRIMARY_IP_DEFAULT="144.91.108.139"

# Auto-detect CA URL
if [ -z "$CA_URL" ]; then
    if [ "$LOCAL_BOOTSTRAP" = true ] || [ -f /etc/step-ca/config/ca.json ]; then
        CA_URL="https://127.0.0.1:9000"
    else
        # IP-based — без DNS/proxy зависимостей. step-ca слушает на primary:9000
        CA_URL="https://${STEP_CA_PRIMARY_IP:-$PRIMARY_IP_DEFAULT}:9000"
    fi
fi

# Auto-detect listen
if [ -z "$LISTEN" ]; then
    if [ -f /etc/step-ca/config/ca.json ]; then
        # primary — step-ca локально → агент тоже на 127.0.0.1
        LISTEN="127.0.0.1:${NODE_AGENT_PORT}"
    else
        LISTEN="0.0.0.0:${NODE_AGENT_PORT}"
    fi
fi

AGENT_SAN="agent-${SERVER_NAME}.internal"

echo ""
echo "=== Установка node-agent ==="
echo "  Server name:     ${SERVER_NAME}"
echo "  Agent SAN:       ${AGENT_SAN}"
echo "  Listen:          ${LISTEN}"
echo "  CA URL:          ${CA_URL}"
echo "  Allowed client:  ${ALLOWED_SAN}"
echo ""

# ============================================================
# [1/7] Node.js 20+
# ============================================================
echo "[1/7] Проверка Node.js..."
NODE_OK=false
if command -v node &>/dev/null; then
    NODE_VER=$(node -v | sed 's/v//' | cut -d. -f1)
    if [ "$NODE_VER" -ge 20 ] 2>/dev/null; then
        NODE_OK=true
        echo "  [OK] Node.js $(node -v)"
    fi
fi
if [ "$NODE_OK" != true ]; then
    echo "  Установка Node.js 20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>&1 | tail -5
    apt-get install -y nodejs 2>&1 | tail -3
fi

# step CLI — нужен для bootstrap и cert renewal
# (CA_URL по умолчанию использует прямой IP primary — без DNS-зависимости)
if ! command -v step &>/dev/null; then
    echo "  Установка step CLI..."
    STEP_VERSION="0.28.2"
    ARCH=$(uname -m)
    case $ARCH in x86_64) STEP_ARCH=amd64 ;; aarch64) STEP_ARCH=arm64 ;; *) echo "unsupported $ARCH"; exit 1 ;; esac
    TMP=$(mktemp -d)
    curl -fsSL -o "$TMP/step.tgz" "https://github.com/smallstep/cli/releases/download/v${STEP_VERSION}/step_linux_${STEP_VERSION}_${STEP_ARCH}.tar.gz"
    tar xzf "$TMP/step.tgz" -C "$TMP"
    cp "$TMP/step_${STEP_VERSION}/bin/step" /usr/local/bin/step
    chmod +x /usr/local/bin/step
    rm -rf "$TMP"
    echo "  [OK] step v${STEP_VERSION} установлен"
fi

# ============================================================
# [2/7] Копирование исходников + сборка
# ============================================================
echo "[2/7] Копирование исходников..."

INSTALL_DIR="/opt/node-agent"
mkdir -p "$INSTALL_DIR"

copy_source() {
    local src="$1"
    local dst="$2"
    if command -v rsync &>/dev/null; then
        rsync -a --delete --exclude=node_modules --exclude=dist "$src/" "$dst/"
    else
        # Fallback без rsync — чистим dst (кроме node_modules для скорости) и копируем
        find "$dst" -mindepth 1 -maxdepth 1 ! -name node_modules -exec rm -rf {} + 2>/dev/null
        for item in "$src"/* "$src"/.[!.]* "$src"/..?*; do
            [ -e "$item" ] || continue
            base=$(basename "$item")
            [ "$base" = node_modules ] && continue
            [ "$base" = dist ] && continue
            cp -a "$item" "$dst/"
        done
    fi
}

if [ -d "$SOURCE_DIR" ] && [ -f "$SOURCE_DIR/package.json" ]; then
    copy_source "$SOURCE_DIR" "$INSTALL_DIR"
elif [ -d /opt/borisovai-admin/management-ui/node-agent ]; then
    copy_source "/opt/borisovai-admin/management-ui/node-agent" "$INSTALL_DIR"
else
    echo "  [ОШИБКА] Не найден source: ${SOURCE_DIR} или /opt/borisovai-admin/management-ui/node-agent/"
    exit 1
fi

cd "$INSTALL_DIR"
echo "  npm ci..."
npm ci 2>&1 | tail -5
echo "  npm run build..."
if ! npm run build 2>&1 | tail -10; then
    echo "  [ОШИБКА] npm run build вернул ошибку"
    exit 1
fi

if [ ! -f "$INSTALL_DIR/dist/index.js" ]; then
    echo "  [ОШИБКА] dist/index.js не собрался"
    exit 1
fi
echo "  [OK] Собрано в ${INSTALL_DIR}/dist/"

# Создание директории для аудит-логов (требуется ReadWritePaths в systemd unit)
mkdir -p /var/log/node-agent
chmod 755 /var/log/node-agent

# ============================================================
# [3/7] Bootstrap cert от step-ca
# ============================================================
echo "[3/7] Bootstrap cert от step-ca..."

CERT_DIR="/etc/node-agent/certs"
mkdir -p "$CERT_DIR"
chmod 700 "$CERT_DIR"

if [ -f "$CERT_DIR/agent.crt" ] && [ "$FORCE_MODE" != true ] && [ -z "$BOOTSTRAP_TOKEN" ] && [ "$LOCAL_BOOTSTRAP" != true ]; then
    echo "  [Пропуск] Cert уже есть, токен не указан → не перевыдаём"
else
    # step ca bootstrap (если ещё не был сделан) — устанавливает CA root в STEPPATH
    AGENT_STEPPATH="/etc/node-agent/step"
    mkdir -p "$AGENT_STEPPATH"
    export STEPPATH="$AGENT_STEPPATH"

    # Получаем root fingerprint
    if [ -f /etc/step-ca/certs/root_ca.crt ]; then
        # Локальный CA — fingerprint доступен напрямую
        ROOT_FP=$(/usr/local/bin/step certificate fingerprint /etc/step-ca/certs/root_ca.crt)
    elif [ -n "$STEP_CA_ROOT_FINGERPRINT" ]; then
        ROOT_FP="$STEP_CA_ROOT_FINGERPRINT"
    else
        ROOT_FP=$(get_config_value "step_ca_root_fingerprint" 2>/dev/null)
        if [ -z "$ROOT_FP" ]; then
            echo "  [ОШИБКА] Не найден root fingerprint. Передайте через STEP_CA_ROOT_FINGERPRINT env var или --bootstrap-token из админки."
            exit 1
        fi
    fi

    if [ ! -f "$AGENT_STEPPATH/certs/root_ca.crt" ]; then
        /usr/local/bin/step ca bootstrap \
            --ca-url "$CA_URL" \
            --fingerprint "$ROOT_FP" \
            --install --force 2>&1 | tail -3
    fi

    # Получаем сам токен
    if [ "$LOCAL_BOOTSTRAP" = true ] && [ -z "$BOOTSTRAP_TOKEN" ]; then
        echo "  Локальный bootstrap: выдаём JWK токен из admin-bootstrap provisioner..."
        BOOTSTRAP_TOKEN=$(/usr/local/bin/step ca token "$AGENT_SAN" \
            --provisioner admin-bootstrap \
            --provisioner-password-file /etc/step-ca/secrets/provisioner-password \
            --ca-url "$CA_URL" \
            --root /etc/step-ca/certs/root_ca.crt \
            --not-after 5m 2>/dev/null)
        if [ -z "$BOOTSTRAP_TOKEN" ]; then
            echo "  [ОШИБКА] Не удалось выдать локальный токен"
            exit 1
        fi
    fi

    # Получаем cert
    /usr/local/bin/step ca certificate \
        "$AGENT_SAN" \
        "$CERT_DIR/agent.crt" \
        "$CERT_DIR/agent.key" \
        --token "$BOOTSTRAP_TOKEN" \
        --ca-url "$CA_URL" \
        --root "$AGENT_STEPPATH/certs/root_ca.crt" \
        --force 2>&1 | tail -3

    if [ ! -f "$CERT_DIR/agent.crt" ]; then
        echo "  [ОШИБКА] Cert не выдан"
        exit 1
    fi

    # CA bundle (root + intermediate) для проверки клиентских cert'ов
    if [ -f /etc/step-ca/certs/root_ca.crt ] && [ -f /etc/step-ca/certs/intermediate_ca.crt ]; then
        cat /etc/step-ca/certs/root_ca.crt /etc/step-ca/certs/intermediate_ca.crt > "$CERT_DIR/ca.crt"
    elif [ -n "$STEP_CA_INTERMEDIATE_PEM" ]; then
        cp "$AGENT_STEPPATH/certs/root_ca.crt" "$CERT_DIR/ca.crt"
        echo "$STEP_CA_INTERMEDIATE_PEM" >> "$CERT_DIR/ca.crt"
    else
        cp "$AGENT_STEPPATH/certs/root_ca.crt" "$CERT_DIR/ca.crt"
    fi

    # Bundle leaf + intermediate в agent.crt — нужно чтобы серверный TLS
    # отдавал полную цепочку клиенту (Node tls иначе не строит chain).
    if [ -n "$STEP_CA_INTERMEDIATE_PEM" ]; then
        echo "$STEP_CA_INTERMEDIATE_PEM" >> "$CERT_DIR/agent.crt"
        echo "  [OK] Bundled intermediate в agent.crt"
    elif [ -f /etc/step-ca/certs/intermediate_ca.crt ]; then
        cat /etc/step-ca/certs/intermediate_ca.crt >> "$CERT_DIR/agent.crt"
    fi

    chmod 600 "$CERT_DIR"/*.crt "$CERT_DIR"/*.key
    echo "  [OK] Cert: $CERT_DIR/agent.crt (SAN: $AGENT_SAN)"
fi

# ============================================================
# [4/7] Конфиг агента
# ============================================================
echo "[4/7] Конфиг /etc/node-agent/config.json..."

CONFIG_FILE="/etc/node-agent/config.json"

# Авто-определение чекеров — что есть на сервере
ENABLED_CHECKERS=()
[ -f /etc/traefik/traefik.yml ] && ENABLED_CHECKERS+=('"traefik"')
[ -f /etc/frp/frps.toml ] && ENABLED_CHECKERS+=('"frps"')
systemctl list-unit-files dns-api.service &>/dev/null && ENABLED_CHECKERS+=('"dns-api"')
[ -f /etc/step-ca/config/ca.json ] && ENABLED_CHECKERS+=('"step-ca"')
systemctl list-unit-files authelia.service &>/dev/null && ENABLED_CHECKERS+=('"authelia"')
systemctl list-unit-files vikunja.service &>/dev/null && ENABLED_CHECKERS+=('"vikunja"')

CHECKERS_JSON=$(IFS=,; echo "${ENABLED_CHECKERS[*]}")

if [ "$FORCE_MODE" = true ] || [ ! -f "$CONFIG_FILE" ]; then
    cat > "$CONFIG_FILE" << EOF
{
  "server_name": "${SERVER_NAME}",
  "listen": "${LISTEN}",
  "tls": {
    "cert": "${CERT_DIR}/agent.crt",
    "key": "${CERT_DIR}/agent.key",
    "ca": "${CERT_DIR}/ca.crt",
    "require_client_cert": true,
    "allowed_client_sans": ["${ALLOWED_SAN}"]
  },
  "config_repo_dir": "/opt/server-configs",
  "enabled_checkers": [${CHECKERS_JSON}],
  "log_level": "info"
}
EOF
    chmod 600 "$CONFIG_FILE"
    echo "  [OK] ${CONFIG_FILE}"
    echo "  Enabled checkers: ${CHECKERS_JSON}"
else
    echo "  [Пропуск] ${CONFIG_FILE} уже существует"
fi

# ============================================================
# [5/7] Systemd unit + cert-renew timer
# ============================================================
echo "[5/7] Systemd units..."

cat > /etc/systemd/system/node-agent.service << EOF
[Unit]
Description=node-agent (HTTPS+mTLS, server status & config sync)
After=network.target

[Service]
Type=simple
WorkingDirectory=${INSTALL_DIR}
ExecStart=/usr/bin/node ${INSTALL_DIR}/dist/index.js
Restart=always
RestartSec=5
LimitNOFILE=65536
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/node-agent /var/log/node-agent /opt/server-configs
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF

cat > /etc/systemd/system/node-agent-cert-renew.service << EOF
[Unit]
Description=Renew node-agent cert from step-ca
After=network.target

[Service]
Type=oneshot
Environment=STEPPATH=/etc/node-agent/step
# CA по прямому IP, end-to-end mTLS со step-ca, server cert верифицируется
# через STEPPATH/certs/root_ca.crt (внутренний trust установлен при bootstrap)
ExecStart=/usr/local/bin/step ca renew --force \\
    --ca-url ${CA_URL} \\
    ${CERT_DIR}/agent.crt ${CERT_DIR}/agent.key
ExecStartPost=/bin/systemctl restart node-agent.service
EOF

cat > /etc/systemd/system/node-agent-cert-renew.timer << EOF
[Unit]
Description=Periodic node-agent cert renewal (renews when within renewal-grace)

[Timer]
OnBootSec=10m
OnUnitActiveSec=6h
RandomizedDelaySec=10m
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable node-agent.service node-agent-cert-renew.timer 2>&1 | tail -3

if systemctl is-active --quiet node-agent 2>/dev/null; then
    systemctl restart node-agent
else
    systemctl start node-agent
fi

systemctl start node-agent-cert-renew.timer

sleep 3
if systemctl is-active --quiet node-agent; then
    echo "  [OK] node-agent запущен"
else
    echo "  [ОШИБКА] node-agent не запустился"
    journalctl -u node-agent -n 20 --no-pager
    exit 1
fi

# ============================================================
# [6/7] Health check (через mTLS)
# ============================================================
echo "[6/7] Health check..."

# Используем серверный cert как клиентский для self-test (он валиден от того же CA)
HEALTH=$(curl -sk \
    --cert "$CERT_DIR/agent.crt" \
    --key "$CERT_DIR/agent.key" \
    --cacert "$CERT_DIR/ca.crt" \
    --resolve "$AGENT_SAN:${NODE_AGENT_PORT}:127.0.0.1" \
    "https://${AGENT_SAN}:${NODE_AGENT_PORT}/health" 2>&1)

# Проверяем статус. Self-test может упасть если allowed_client_sans не включает agent SAN
# (что нормально — клиент-cert должен быть admin@*, не agent@*)
if echo "$HEALTH" | grep -q '"status":"ok"'; then
    echo "  [OK] /health: $HEALTH"
elif echo "$HEALTH" | grep -q "client SAN not in allowed_client_sans"; then
    echo "  [OK] mTLS работает (self-test ожидаемо отклонён, client SAN ≠ allowed)"
    # Отдельная проверка через TCP что порт открыт и cert тот
    SUBJ=$(echo | openssl s_client -connect "127.0.0.1:${NODE_AGENT_PORT}" 2>/dev/null | openssl x509 -noout -subject 2>&1)
    echo "  Server cert: $SUBJ"
else
    echo "  [ВНИМАНИЕ] Неожиданный ответ /health:"
    echo "  $HEALTH"
fi

# ============================================================
# [7/7] Сохранение credentials
# ============================================================
echo "[7/7] Сохранение credentials..."

CRED_DIR="/root/.borisovai-credentials"
mkdir -p "$CRED_DIR"
chmod 700 "$CRED_DIR"
cat > "$CRED_DIR/node-agent" << CRED_EOF
# node-agent credentials ($(date '+%Y-%m-%d %H:%M:%S'))
server_name=${SERVER_NAME}
agent_san=${AGENT_SAN}
listen=${LISTEN}
agent_url_local=https://${AGENT_SAN}:${NODE_AGENT_PORT}
config_file=${CONFIG_FILE}
cert_dir=${CERT_DIR}
ca_url=${CA_URL}
allowed_client_sans=${ALLOWED_SAN}
CRED_EOF
chmod 600 "$CRED_DIR/node-agent"

echo ""
echo "=== node-agent установлен ==="
echo ""
echo "  Endpoint:     https://${AGENT_SAN}:${NODE_AGENT_PORT}/"
echo "  Server cert:  ${CERT_DIR}/agent.crt"
echo "  Config:       ${CONFIG_FILE}"
echo "  Logs:         journalctl -u node-agent -f"
echo "  Cert renew:   systemctl status node-agent-cert-renew.timer"
echo ""
echo "  Тест с admin client cert (после Фазы 1.5):"
echo "    curl --cert admin.crt --key admin.key --cacert ca.crt \\"
echo "         --resolve ${AGENT_SAN}:${NODE_AGENT_PORT}:127.0.0.1 \\"
echo "         https://${AGENT_SAN}:${NODE_AGENT_PORT}/health"
echo ""
