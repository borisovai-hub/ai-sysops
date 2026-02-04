#!/bin/bash
# Скрипт установки n8n на одну машину
# Использование: sudo ./install-n8n.sh [n8n-domain] [--force]
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение.

# Определение директории скрипта (абсолютный путь)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Загрузка общих функций
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Предупреждение: common.sh не найден, некоторые функции могут быть недоступны"
fi

set +e

if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Параметры
N8N_DOMAIN="${1:-}"
FORCE_MODE=false

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
    esac
done

echo "=== Установка n8n ==="
echo ""

# Проверка существования n8n
if [ "$FORCE_MODE" != true ]; then
    if is_command_exists "n8n" && is_service_installed "n8n.service"; then
        echo "  [Пропуск] n8n уже установлен"
        if is_service_running "n8n.service"; then
            echo "  [OK] n8n запущен"
        else
            echo "  [Предупреждение] n8n установлен, но не запущен"
            echo "  Запуск сервиса..."
            systemctl start n8n
        fi
        exit 0
    fi
fi

# Обновление пакетов перед установкой Node.js
export DEBIAN_FRONTEND=noninteractive
apt-get update

# Проверка/установка Node.js
echo "[1/6] Проверка Node.js..."
if ! command -v node &> /dev/null; then
    echo "Установка Node.js 20.x (LTS)..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo "Node.js установлен: $(node --version)"
else
    NODE_VERSION=$(node --version)
    echo "Node.js уже установлен: $NODE_VERSION"
    
    # Проверка версии
    NODE_MAJOR=$(echo $NODE_VERSION | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_MAJOR" -lt 20 ]; then
        echo "Предупреждение: Рекомендуется Node.js 20+ (LTS) для n8n"
        read -p "Обновить Node.js? (y/n): " UPDATE_NODE
        if [ "$UPDATE_NODE" = "y" ] || [ "$UPDATE_NODE" = "Y" ]; then
            curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
            apt-get install -y nodejs
        fi
    fi
fi

# Проверка npm
if ! command -v npm &> /dev/null; then
    echo "Ошибка: npm не найден"
    exit 1
fi

# Создание пользователя для n8n
echo ""
echo "[2/6] Создание пользователя для n8n..."
if ! id -u n8n &>/dev/null; then
    useradd -r -s /bin/false -d /opt/n8n -m n8n
    echo "Пользователь n8n создан"
else
    echo "Пользователь n8n уже существует"
fi

# Установка n8n
echo ""
echo "[3/6] Установка n8n (это может занять несколько минут)..."
N8N_DIR="/opt/n8n"
mkdir -p "$N8N_DIR"
chown n8n:n8n "$N8N_DIR"

# Определение домена n8n
if [ -z "$N8N_DOMAIN" ]; then
    if [ -n "$(get_config_value "base_domains")" ]; then
        N8N_PREFIX=$(get_config_value "n8n_prefix")
        [ -z "$N8N_PREFIX" ] && N8N_PREFIX="n8n"
        save_config_value "n8n_prefix" "$N8N_PREFIX"
        N8N_DOMAIN=$(build_service_domains "$N8N_PREFIX" | head -1)
        if [ -z "$N8N_DOMAIN" ]; then
            N8N_DOMAIN="n8n.example.com"
        fi
        echo "Используются базовые домены, основной домен n8n: $N8N_DOMAIN"
    else
        N8N_DOMAIN=$(get_config_value "n8n_domain")
        if [ -z "$N8N_DOMAIN" ]; then
            N8N_DOMAIN=$(prompt_and_save "n8n_domain" "Домен для n8n (например, n8n.example.com)" "n8n.example.com")
            if [ -z "$N8N_DOMAIN" ]; then
                N8N_DOMAIN="n8n.example.com"
            fi
        else
            echo "Используется сохраненный домен n8n: $N8N_DOMAIN"
        fi
    fi
fi

# Установка n8n глобально
if ! is_command_exists "n8n" || [ "$FORCE_MODE" = true ]; then
    npm install -g n8n
    if [ $? -ne 0 ]; then
        echo "Ошибка: Не удалось установить n8n"
        exit 1
    fi
else
    echo "  [Пропуск] n8n уже установлен"
fi

# Создание директорий для данных
echo ""
echo "[4/6] Создание директорий для данных..."
mkdir -p /var/lib/n8n
mkdir -p /var/log/n8n
chown -R n8n:n8n /var/lib/n8n
chown -R n8n:n8n /var/log/n8n

# Создание systemd service
echo ""
echo "[5/6] Создание systemd service..."
if [ "$FORCE_MODE" = true ] || [ ! -f "/etc/systemd/system/n8n.service" ]; then
    # Создание резервной копии если файл существует
    if [ -f "/etc/systemd/system/n8n.service" ]; then
        cp /etc/systemd/system/n8n.service /etc/systemd/system/n8n.service.backup.$(date +%Y%m%d_%H%M%S)
    fi
    cat > /etc/systemd/system/n8n.service << EOF
[Unit]
Description=n8n workflow automation
Documentation=https://docs.n8n.io
After=network.target

[Service]
Type=simple
User=n8n
Environment="NODE_ENV=production"
Environment="N8N_BASIC_AUTH_ACTIVE=true"
Environment="N8N_BASIC_AUTH_USER=admin"
Environment="N8N_BASIC_AUTH_PASSWORD=changeme"
Environment="N8N_HOST=127.0.0.1"
Environment="N8N_PORT=5678"
Environment="N8N_PROTOCOL=http"
Environment="WEBHOOK_URL=https://${N8N_DOMAIN}/"
Environment="N8N_METRICS=true"
Environment="N8N_LOG_LEVEL=info"
Environment="N8N_USER_FOLDER=/var/lib/n8n"
ExecStart=/usr/bin/n8n start
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=n8n

[Install]
WantedBy=multi-user.target
EOF
else
    echo "  [Пропуск] Systemd service уже существует"
    # Обновление WEBHOOK_URL если домен изменился
    if [ -f "/etc/systemd/system/n8n.service" ]; then
        CURRENT_DOMAIN=$(grep "WEBHOOK_URL" /etc/systemd/system/n8n.service | sed "s/.*https:\/\/\(.*\)\/.*/\1/")
        if [ "$CURRENT_DOMAIN" != "$N8N_DOMAIN" ]; then
            echo "  Обновление домена в конфигурации..."
            sed -i "s|WEBHOOK_URL=.*|WEBHOOK_URL=https://${N8N_DOMAIN}/|" /etc/systemd/system/n8n.service
            systemctl daemon-reload
        fi
    fi
fi

# Настройка переменных окружения
echo ""
echo "[6/6] Настройка конфигурации..."
# Базовые настройки уже в systemd service
# Пользователь может изменить пароль после установки

# Запуск n8n
systemctl daemon-reload
systemctl enable n8n

# Остановка перед запуском если уже запущен
if systemctl is-active --quiet n8n 2>/dev/null; then
    echo "  Остановка существующего n8n..."
    systemctl stop n8n
fi

systemctl start n8n

sleep 5
if systemctl is-active --quiet n8n; then
    if [ -n "$(get_config_value "base_domains")" ]; then
        N8N_PREFIX=$(get_config_value "n8n_prefix")
        [ -z "$N8N_PREFIX" ] && N8N_PREFIX="n8n"
        echo ""
        echo "Создание DNS записей для n8n..."
        create_dns_records_for_domains "$N8N_PREFIX"
    fi
    echo ""
    echo "=== Установка n8n завершена! ==="
    echo ""
    echo "n8n запущен и доступен на:"
    echo "  http://127.0.0.1:5678"
    echo ""
    echo "ВАЖНО: Измените пароль по умолчанию!"
    echo "  Редактируйте /etc/systemd/system/n8n.service"
    echo "  Измените N8N_BASIC_AUTH_PASSWORD=changeme"
    echo "  Затем: systemctl daemon-reload && systemctl restart n8n"
    echo ""
    echo "Проверка статуса: systemctl status n8n"
    echo "Просмотр логов: journalctl -u n8n -f"
else
    echo ""
    echo "Ошибка: n8n не запустился"
    echo "Проверьте логи: journalctl -u n8n -n 50"
    exit 1
fi
