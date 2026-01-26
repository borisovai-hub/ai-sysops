#!/bin/bash
# Скрипт установки Stalwart Mail Server на одну машину
# Использование: sudo ./install-stalwart.sh <mail-domain> <letsencrypt-email> [--force]
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

# Функции для проверки портов
check_port_in_use() {
    local port=$1
    if command -v netstat &> /dev/null; then
        netstat -tlnp 2>/dev/null | grep -q ":$port " && return 0
    elif command -v ss &> /dev/null; then
        ss -tlnp 2>/dev/null | grep -q ":$port " && return 0
    elif command -v lsof &> /dev/null; then
        lsof -i :$port 2>/dev/null | grep -q LISTEN && return 0
    fi
    return 1
}

# Параметры
MAIL_DOMAIN="${1:-}"
LETSENCRYPT_EMAIL="${2:-}"
FORCE_MODE=false

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
    esac
done

echo "=== Установка Stalwart Mail Server ==="
echo ""

# Получение параметров если не переданы
if [ -z "$MAIL_DOMAIN" ]; then
    MAIL_DOMAIN=$(get_config_value "mail_domain")
    if [ -z "$MAIL_DOMAIN" ]; then
        MAIL_DOMAIN=$(prompt_and_save "mail_domain" "Домен для почты (например, mail.example.com)")
        if [ -z "$MAIL_DOMAIN" ]; then
            echo "Ошибка: Домен обязателен"
            exit 1
        fi
    else
        echo "Используется сохраненный домен: $MAIL_DOMAIN"
    fi
fi

if [ -z "$LETSENCRYPT_EMAIL" ]; then
    LETSENCRYPT_EMAIL=$(get_config_value "letsencrypt_email")
    if [ -z "$LETSENCRYPT_EMAIL" ]; then
        LETSENCRYPT_EMAIL=$(prompt_and_save "letsencrypt_email" "Email для Let's Encrypt")
        if [ -z "$LETSENCRYPT_EMAIL" ]; then
            echo "Ошибка: Email обязателен для Let's Encrypt"
            exit 1
        fi
    else
        echo "Используется сохраненный email: $LETSENCRYPT_EMAIL"
    fi
fi

# Проверка существования Stalwart
STALWART_DIR="/opt/stalwart-mail"
STALWART_BIN="$STALWART_DIR/bin/stalwart-mail"
STALWART_SERVICE="stalwart-mail.service"

if [ "$FORCE_MODE" != true ]; then
    if is_service_installed "$STALWART_SERVICE" && is_file_exists "$STALWART_BIN"; then
        echo "  [Пропуск] Stalwart уже установлен"
        if is_service_running "$STALWART_SERVICE"; then
            echo "  [OK] Stalwart запущен"
        else
            echo "  [Предупреждение] Stalwart установлен, но не запущен"
            echo "  Запуск сервиса..."
            systemctl start "$STALWART_SERVICE"
        fi
        exit 0
    fi
fi

# Проверка конфликтов портов
echo "[Проверка] Проверка портов..."
MAIL_PORTS=(25 587 465 143 993)
CONFLICTS_FOUND=0

for port in "${MAIL_PORTS[@]}"; do
    if check_port_in_use "$port"; then
        echo "  [КОНФЛИКТ] Порт $port уже используется"
        CONFLICTS_FOUND=1
    fi
done

if [ "$CONFLICTS_FOUND" -eq 1 ]; then
    echo ""
    echo "  ВНИМАНИЕ: Обнаружены конфликты портов!"
    echo "  Возможно, уже установлен другой почтовый сервер (Postfix, Dovecot и т.д.)"
    read -p "  Продолжить установку? (y/n): " CONTINUE_PORT
    if [ "$CONTINUE_PORT" != "y" ] && [ "$CONTINUE_PORT" != "Y" ]; then
        exit 1
    fi
fi

# Проверка порта 8080 (Traefik Dashboard)
if check_port_in_use 8080; then
    echo "  [OK] Порт 8080 занят (Traefik Dashboard) - веб-админка Stalwart будет на 8081"
    STALWART_ADMIN_PORT=8081
else
    echo "  [OK] Порт 8080 свободен"
    STALWART_ADMIN_PORT=8080
fi

# Обновление пакетов
echo ""
echo "[1/8] Обновление пакетов..."
export DEBIAN_FRONTEND=noninteractive
apt update -qq

# Установка зависимостей
echo ""
echo "[2/8] Установка зависимостей..."
apt install -y curl wget

# Создание пользователя для Stalwart
echo ""
echo "[3/8] Создание пользователя для Stalwart..."
if ! id -u stalwart-mail &>/dev/null; then
    useradd -r -s /bin/false -d "$STALWART_DIR" -m stalwart-mail
    echo "  [OK] Пользователь stalwart-mail создан"
else
    echo "  [Пропуск] Пользователь stalwart-mail уже существует"
fi

# Установка Stalwart
echo ""
echo "[4/8] Установка Stalwart Mail Server..."
if [ "$FORCE_MODE" = true ] || [ ! -f "$STALWART_BIN" ]; then
    # Скачивание и выполнение установочного скрипта
    INSTALL_SCRIPT="/tmp/stalwart-install.sh"
    curl --proto '=https' --tlsv1.2 -sSf https://get.stalw.art/install.sh -o "$INSTALL_SCRIPT"
    
    if [ $? -ne 0 ]; then
        echo "  [ОШИБКА] Не удалось скачать установочный скрипт"
        exit 1
    fi
    
    chmod +x "$INSTALL_SCRIPT"
    
    # Выполнение установки
    echo "  Выполнение установки (это может занять несколько минут)..."
    "$INSTALL_SCRIPT" "$STALWART_DIR"
    
    if [ $? -ne 0 ]; then
        echo "  [ОШИБКА] Не удалось установить Stalwart"
        exit 1
    fi
    
    # Сохранение admin credentials если они были выведены
    if [ -f "$STALWART_BIN" ]; then
        echo "  [OK] Stalwart установлен"
        echo "  ВАЖНО: Сохраните admin credentials, которые были выведены выше!"
    else
        echo "  [ОШИБКА] Бинарник Stalwart не найден после установки"
        exit 1
    fi
else
    echo "  [Пропуск] Stalwart уже установлен"
fi

# Настройка config.toml
echo ""
echo "[5/8] Настройка конфигурации..."
STALWART_CONFIG="$STALWART_DIR/etc/config.toml"

if [ ! -f "$STALWART_CONFIG" ]; then
    echo "  [ОШИБКА] Файл конфигурации не найден: $STALWART_CONFIG"
    exit 1
fi

# Создание резервной копии конфига
if [ ! -f "${STALWART_CONFIG}.backup" ]; then
    cp "$STALWART_CONFIG" "${STALWART_CONFIG}.backup"
fi

# Изменение порта веб-админки если нужно
if [ "$STALWART_ADMIN_PORT" = "8081" ]; then
    echo "  Настройка порта веб-админки на 8081..."
    # Проверяем, есть ли уже настройка http.url
    if grep -q '\[server\.http\]' "$STALWART_CONFIG"; then
        # Обновляем существующую настройку
        if grep -q 'url\s*=' "$STALWART_CONFIG"; then
            sed -i "s|url\s*=.*|url = \"http://127.0.0.1:8081\"|" "$STALWART_CONFIG"
        else
            # Добавляем url в существующую секцию
            sed -i '/\[server\.http\]/a url = "http://127.0.0.1:8081"' "$STALWART_CONFIG"
        fi
    else
        # Добавляем новую секцию после [server] или в конец файла
        if grep -q '\[server\]' "$STALWART_CONFIG"; then
            # Используем временный файл для безопасной вставки
            TEMP_CONFIG=$(mktemp)
            awk '/\[server\]/ {print; print ""; print "[server.http]"; print "url = \"http://127.0.0.1:8081\""; next} {print}' "$STALWART_CONFIG" > "$TEMP_CONFIG"
            mv "$TEMP_CONFIG" "$STALWART_CONFIG"
        else
            echo "" >> "$STALWART_CONFIG"
            echo "[server.http]" >> "$STALWART_CONFIG"
            echo 'url = "http://127.0.0.1:8081"' >> "$STALWART_CONFIG"
        fi
    fi
fi

# Настройка hostname
echo "  Настройка hostname: $MAIL_DOMAIN"
if grep -q '\[server\]' "$STALWART_CONFIG"; then
    if grep -q 'hostname\s*=' "$STALWART_CONFIG"; then
        sed -i "s|hostname\s*=.*|hostname = \"$MAIL_DOMAIN\"|" "$STALWART_CONFIG"
    else
        sed -i '/\[server\]/a hostname = "'"$MAIL_DOMAIN"'"' "$STALWART_CONFIG"
    fi
else
    echo "" >> "$STALWART_CONFIG"
    echo "[server]" >> "$STALWART_CONFIG"
    echo "hostname = \"$MAIL_DOMAIN\"" >> "$STALWART_CONFIG"
fi

# Настройка Proxy Protocol для Traefik (если будет использоваться)
echo "  Настройка Proxy Protocol для Traefik..."
if ! grep -q '\[server\.proxy\]' "$STALWART_CONFIG"; then
    echo "" >> "$STALWART_CONFIG"
    echo "[server.proxy]" >> "$STALWART_CONFIG"
    echo 'trusted-networks = ["127.0.0.0/8", "::1", "10.0.0.0/8", "172.16.0.0/12"]' >> "$STALWART_CONFIG"
fi

# Установка прав на конфиг
chown stalwart-mail:stalwart-mail "$STALWART_CONFIG"
chmod 600 "$STALWART_CONFIG"

echo "  [OK] Конфигурация обновлена"

# Настройка systemd service
echo ""
echo "[6/8] Настройка systemd service..."
if [ "$FORCE_MODE" = true ] || [ ! -f "/etc/systemd/system/$STALWART_SERVICE" ]; then
    # Создание резервной копии если файл существует
    if [ -f "/etc/systemd/system/$STALWART_SERVICE" ]; then
        cp "/etc/systemd/system/$STALWART_SERVICE" "/etc/systemd/system/$STALWART_SERVICE.backup.$(date +%Y%m%d_%H%M%S)"
    fi
    
    # Проверка наличия ADMIN_SECRET в окружении (может быть установлен скриптом установки)
    ADMIN_SECRET="${ADMIN_SECRET:-}"
    if [ -z "$ADMIN_SECRET" ] && [ -f "$STALWART_DIR/.admin_secret" ]; then
        ADMIN_SECRET=$(cat "$STALWART_DIR/.admin_secret" 2>/dev/null || echo "")
    fi
    
    cat > "/etc/systemd/system/$STALWART_SERVICE" << EOF
[Unit]
Description=Stalwart Mail Server
Documentation=https://stalw.art/docs/
After=network.target

[Service]
Type=simple
User=stalwart-mail
Group=stalwart-mail
WorkingDirectory=$STALWART_DIR
ExecStart=$STALWART_BIN
Restart=always
RestartSec=10
Environment="STALWART_PATH=$STALWART_DIR"
EOF

    if [ -n "$ADMIN_SECRET" ]; then
        echo "Environment=\"ADMIN_SECRET=$ADMIN_SECRET\"" >> "/etc/systemd/system/$STALWART_SERVICE"
    fi
    
    cat >> "/etc/systemd/system/$STALWART_SERVICE" << EOF

[Install]
WantedBy=multi-user.target
EOF

    systemctl daemon-reload
    echo "  [OK] Systemd service создан"
else
    echo "  [Пропуск] Systemd service уже существует"
fi

# Настройка firewall
echo ""
echo "[7/8] Настройка firewall (UFW)..."
if command -v ufw &> /dev/null; then
    for port in "${MAIL_PORTS[@]}"; do
        ufw allow $port/tcp comment "Stalwart Mail Server" 2>/dev/null || true
    done
    echo "  [OK] Порты открыты в firewall: ${MAIL_PORTS[*]}"
else
    echo "  [Пропуск] UFW не установлен, настройте firewall вручную"
fi

# Интеграция с Traefik
echo ""
echo "[8/8] Интеграция с Traefik..."
if is_service_installed "traefik.service" || [ -f "/opt/traefik/traefik" ]; then
    DYNAMIC_DIR="/etc/traefik/dynamic"
    mkdir -p "$DYNAMIC_DIR"

# Извлечение базового домена для autodiscover/mta-sts
BASE_DOMAIN=$(echo "$MAIL_DOMAIN" | sed 's/^[^.]*\.//')
AUTODISCOVER_DOMAIN="autodiscover.$BASE_DOMAIN"
MTASTS_DOMAIN="mta-sts.$BASE_DOMAIN"
ADMIN_DOMAIN="mail-admin.$BASE_DOMAIN"

# Создание конфигурации Traefik для Stalwart
STALWART_TRAEFIK_CONFIG="$DYNAMIC_DIR/stalwart.yml"

cat > "$STALWART_TRAEFIK_CONFIG" << EOF
http:
  routers:
    stalwart-jmap:
      rule: "Host(\`$MAIL_DOMAIN\`) && PathPrefix(\`/jmap\`)"
      service: stalwart-jmap
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

    stalwart-autodiscover:
      rule: "Host(\`$AUTODISCOVER_DOMAIN\`)"
      service: stalwart-autodiscover
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

    stalwart-mta-sts:
      rule: "Host(\`$MTASTS_DOMAIN\`)"
      service: stalwart-mta-sts
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

    stalwart-admin:
      rule: "Host(\`$ADMIN_DOMAIN\`)"
      service: stalwart-admin
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

  services:
    stalwart-jmap:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:$STALWART_ADMIN_PORT"

    stalwart-autodiscover:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:$STALWART_ADMIN_PORT"

    stalwart-mta-sts:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:$STALWART_ADMIN_PORT"

    stalwart-admin:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:$STALWART_ADMIN_PORT"
EOF

    chmod 644 "$STALWART_TRAEFIK_CONFIG"

    # Перезагрузка Traefik если он запущен
    if systemctl is-active --quiet traefik 2>/dev/null; then
        echo "  Перезагрузка Traefik..."
        systemctl reload traefik 2>/dev/null || systemctl restart traefik 2>/dev/null
        echo "  [OK] Traefik обновлен"
    else
        echo "  [Пропуск] Traefik не запущен"
    fi

    echo "  [OK] Интеграция с Traefik настроена"
else
    echo "  [Пропуск] Traefik не установлен, интеграция пропущена"
    echo "  После установки Traefik создайте конфигурацию вручную"
fi

# Запуск Stalwart
echo ""
echo "Запуск Stalwart Mail Server..."
systemctl enable "$STALWART_SERVICE"

# Остановка перед запуском если уже запущен
if systemctl is-active --quiet "$STALWART_SERVICE" 2>/dev/null; then
    echo "  Остановка существующего Stalwart..."
    systemctl stop "$STALWART_SERVICE"
    sleep 2
fi

systemctl start "$STALWART_SERVICE"

sleep 5
if systemctl is-active --quiet "$STALWART_SERVICE"; then
    echo ""
    echo "=== Установка Stalwart Mail Server завершена! ==="
    echo ""
    echo "Stalwart запущен и доступен:"
    echo "  - Веб-админка (локально): http://127.0.0.1:$STALWART_ADMIN_PORT/login"
    if is_service_installed "traefik.service" || [ -f "/opt/traefik/traefik" ]; then
        echo "  - Веб-админка (через Traefik): https://$ADMIN_DOMAIN"
        echo "  - JMAP: https://$MAIL_DOMAIN/jmap"
        echo "  - Autodiscover: https://$AUTODISCOVER_DOMAIN"
        echo "  - MTA-STS: https://$MTASTS_DOMAIN"
    else
        echo "  - Веб-админка (локально): http://127.0.0.1:$STALWART_ADMIN_PORT/login"
        echo "  Примечание: После установки Traefik настройте проксирование"
    fi
    echo ""
    echo "Почтовые порты:"
    echo "  - SMTP: 25, 587, 465"
    echo "  - IMAP: 143, 993"
    echo ""
    echo "ВАЖНО - Следующие шаги:"
    echo "  1. Войдите в веб-админку: http://127.0.0.1:$STALWART_ADMIN_PORT/login"
    echo "     (Admin credentials были выведены при установке или сохранены в системе)"
    echo "  2. Создайте домен в веб-админке: Management > Directory > Domains"
    echo "  3. Добавьте DNS записи (см. ниже) - Stalwart сгенерирует SPF/DKIM/DMARC в админке"
    echo "  4. Создайте почтовые ящики: Management > Directory > Accounts"
    echo ""
    echo ""
    echo "DNS записи для добавления (через ваш DNS API или вручную):"
    echo "  - MX: $BASE_DOMAIN. MX 10 $MAIL_DOMAIN."
    echo "  - A: $MAIL_DOMAIN. A <IP_сервера>"
    if is_service_installed "traefik.service" || [ -f "/opt/traefik/traefik" ]; then
        echo "  - A: $AUTODISCOVER_DOMAIN. A <IP_сервера>"
        echo "  - A: $MTASTS_DOMAIN. A <IP_сервера>"
        echo "  - A: $ADMIN_DOMAIN. A <IP_сервера>"
    fi
    echo "  - SPF, DKIM, DMARC записи: сгенерируются в веб-админке после создания домена"
    echo "    (Management > Directory > Domains > [ваш домен] > DNS Records)"
    echo ""
    echo "Проверка статуса: systemctl status $STALWART_SERVICE"
    echo "Просмотр логов: journalctl -u $STALWART_SERVICE -f"
    echo "Конфигурация: $STALWART_CONFIG"
else
    echo ""
    echo "Ошибка: Stalwart не запустился"
    echo "Проверьте логи: journalctl -u $STALWART_SERVICE -n 50"
    exit 1
fi
