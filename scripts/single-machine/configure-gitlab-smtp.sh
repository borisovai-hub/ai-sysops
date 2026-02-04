#!/bin/bash
# Скрипт настройки SMTP для GitLab
# Использование: sudo ./configure-gitlab-smtp.sh [--mailu] [--external] [--email <email>] [--password <password>]
#
# Параметры:
#   --mailu      - использовать Mailu Mail Server
#   --external   - использовать внешний SMTP сервер
#   --email      - email адрес для отправки (например, gitlab@borisovai.ru)
#   --password   - пароль от email адреса
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

# Проверка установки GitLab
if ! is_service_installed "gitlab-runsvdir.service"; then
    echo "Ошибка: GitLab не установлен"
    echo "Сначала запустите: sudo ./install-gitlab.sh"
    exit 1
fi

GITLAB_CONFIG="/etc/gitlab/gitlab.rb"

if [ ! -f "$GITLAB_CONFIG" ]; then
    echo "Ошибка: Файл конфигурации GitLab не найден: $GITLAB_CONFIG"
    exit 1
fi

echo "=== Настройка SMTP для GitLab ==="
echo ""

# Параметры
USE_MAILU=false
USE_EXTERNAL=false
GITLAB_EMAIL_PARAM=""
GITLAB_PASSWORD_PARAM=""

# Обработка параметров командной строки
while [[ $# -gt 0 ]]; do
    case $1 in
        --mailu)
            USE_MAILU=true
            shift
            ;;
        --external)
            USE_EXTERNAL=true
            shift
            ;;
        --email)
            GITLAB_EMAIL_PARAM="$2"
            shift 2
            ;;
        --password)
            GITLAB_PASSWORD_PARAM="$2"
            shift 2
            ;;
        *)
            echo "Неизвестный параметр: $1"
            echo "Использование: $0 [--mailu] [--external] [--email <email>] [--password <password>]"
            exit 1
            ;;
    esac
done

# Определение типа SMTP
if [ "$USE_MAILU" = true ] && [ "$USE_EXTERNAL" = true ]; then
    echo "Ошибка: Нельзя использовать --mailu и --external одновременно"
    exit 1
fi

if [ "$USE_MAILU" != true ] && [ "$USE_EXTERNAL" != true ]; then
    # Интерактивный выбор
    echo "Выберите тип SMTP сервера:"
    echo "  1) Mailu Mail Server (если установлен)"
    echo "  2) Внешний SMTP сервер"
    echo ""
    read -p "Ваш выбор (1 или 2): " SMTP_CHOICE
    
    case $SMTP_CHOICE in
        1)
            USE_MAILU=true
            ;;
        2)
            USE_EXTERNAL=true
            ;;
        *)
            echo "Ошибка: Неверный выбор"
            exit 1
            ;;
    esac
fi

# Создание резервной копии конфигурации
BACKUP_FILE="${GITLAB_CONFIG}.backup.$(date +%Y%m%d_%H%M%S)"
cp "$GITLAB_CONFIG" "$BACKUP_FILE"
echo "  [OK] Создана резервная копия: $BACKUP_FILE"
echo ""

# Удаление существующих SMTP настроек
sed -i '/^# SMTP/,/^# End SMTP/d' "$GITLAB_CONFIG" 2>/dev/null || true
sed -i '/^gitlab_rails\['\''smtp_/,/^gitlab_rails\['\''gitlab_email_/d' "$GITLAB_CONFIG" 2>/dev/null || true

# Настройка SMTP
if [ "$USE_MAILU" = true ]; then
    echo "[1/3] Настройка SMTP через Mailu..."
    
    # Проверка установки Mailu
    if ! is_service_installed "mailu.service"; then
        echo "  [Предупреждение] Mailu не установлен"
        read -p "  Продолжить настройку Mailu SMTP? (y/n): " CONTINUE_MAILU
        if [ "$CONTINUE_MAILU" != "y" ] && [ "$CONTINUE_MAILU" != "Y" ]; then
            echo "Отмена настройки"
            exit 1
        fi
    fi
    
    # Получение параметров Mailu
    MAIL_DOMAIN=$(get_config_value "mail_domain")
    if [ -z "$MAIL_DOMAIN" ]; then
        MAIL_DOMAIN=$(prompt_and_save "mail_domain" "Введите домен Mailu (например, mail.dev.borisovai.ru)" "mail.dev.borisovai.ru")
    fi
    
    BASE_DOMAIN=$(echo "$MAIL_DOMAIN" | sed 's/^[^.]*\.//')
    # Если домен начинается с mail.dev., убираем mail.dev. и оставляем только базовый домен
    if echo "$BASE_DOMAIN" | grep -q "^dev\."; then
        BASE_DOMAIN=$(echo "$BASE_DOMAIN" | sed 's/^dev\.//')
    fi
    
    # Email отправителя
    if [ -n "$GITLAB_EMAIL_PARAM" ]; then
        GITLAB_EMAIL="$GITLAB_EMAIL_PARAM"
        echo "  Используется email из параметра: $GITLAB_EMAIL"
    else
        GITLAB_EMAIL=$(get_config_value "gitlab_email")
        if [ -z "$GITLAB_EMAIL" ]; then
            GITLAB_EMAIL=$(prompt_and_save "gitlab_email" "Введите email для отправки уведомлений GitLab (например, gitlab@${BASE_DOMAIN})" "gitlab@${BASE_DOMAIN}")
        else
            echo "  Используется сохранённый email: $GITLAB_EMAIL"
        fi
    fi
    
    # SMTP настройки Mailu
    # Mailu предоставляет SMTP на портах: 25, 587 (STARTTLS), 465 (SSL/TLS)
    # Используем порт 465 с TLS для внешнего доступа через mail.dev.borisovai.ru
    SMTP_HOST="$MAIL_DOMAIN"
    SMTP_PORT="465"
    SMTP_USER="$GITLAB_EMAIL"
    SMTP_DOMAIN="$BASE_DOMAIN"
    
    echo ""
    echo "  Настройки Mailu SMTP:"
    echo "    Host: $SMTP_HOST"
    echo "    Port: $SMTP_PORT (TLS/SSL)"
    echo "    User: $SMTP_USER"
    echo "    Domain: $SMTP_DOMAIN"
    echo ""
    
    if [ -n "$GITLAB_PASSWORD_PARAM" ]; then
        SMTP_PASSWORD="$GITLAB_PASSWORD_PARAM"
        echo "  Используется пароль из параметра"
    else
        read -p "  Введите пароль для $SMTP_USER: " SMTP_PASSWORD
        if [ -z "$SMTP_PASSWORD" ]; then
            echo "Ошибка: Пароль обязателен"
            exit 1
        fi
    fi
    
    # Сохранение email в конфигурацию
    save_config_value "gitlab_email" "$GITLAB_EMAIL"
    
    # Добавление SMTP конфигурации в GitLab
    cat >> "$GITLAB_CONFIG" << EOF

# SMTP настройки для Mailu
gitlab_rails['smtp_enable'] = true
gitlab_rails['smtp_address'] = "$SMTP_HOST"
gitlab_rails['smtp_port'] = $SMTP_PORT
gitlab_rails['smtp_user_name'] = "$SMTP_USER"
gitlab_rails['smtp_password'] = "$SMTP_PASSWORD"
gitlab_rails['smtp_domain'] = "$SMTP_DOMAIN"
gitlab_rails['smtp_authentication'] = "login"
gitlab_rails['smtp_enable_starttls_auto'] = false
gitlab_rails['smtp_tls'] = true
gitlab_rails['smtp_openssl_verify_mode'] = 'peer'

# Email отправителя
gitlab_rails['gitlab_email_from'] = "$GITLAB_EMAIL"
gitlab_rails['gitlab_email_display_name'] = "GitLab"
gitlab_rails['gitlab_email_reply_to'] = "$GITLAB_EMAIL"
EOF

    echo "  [OK] SMTP настроен для Mailu"
    
elif [ "$USE_EXTERNAL" = true ]; then
    echo "[1/3] Настройка внешнего SMTP сервера..."
    
    # Получение параметров внешнего SMTP
    SMTP_HOST=$(prompt_and_save "smtp_host" "Введите SMTP хост (например, smtp.gmail.com)")
    if [ -z "$SMTP_HOST" ]; then
        echo "Ошибка: SMTP хост обязателен"
        exit 1
    fi
    
    SMTP_PORT=$(prompt_and_save "smtp_port" "Введите SMTP порт (587 для TLS, 465 для SSL, 25 для без шифрования)" "587")
    if [ -z "$SMTP_PORT" ]; then
        SMTP_PORT=587
    fi
    
    SMTP_DOMAIN=$(prompt_and_save "smtp_domain" "Введите SMTP домен (обычно домен вашего email)")
    if [ -z "$SMTP_DOMAIN" ]; then
        SMTP_DOMAIN=$(echo "$SMTP_HOST" | sed 's/^smtp\.//')
    fi
    
    SMTP_USER=$(prompt_and_save "smtp_user" "Введите SMTP пользователь (обычно ваш email)")
    if [ -z "$SMTP_USER" ]; then
        echo "Ошибка: SMTP пользователь обязателен"
        exit 1
    fi
    
    read -p "  Введите пароль для $SMTP_USER: " SMTP_PASSWORD
    if [ -z "$SMTP_PASSWORD" ]; then
        echo "Ошибка: Пароль обязателен"
        exit 1
    fi
    
    if [ -n "$GITLAB_EMAIL_PARAM" ]; then
        GITLAB_EMAIL="$GITLAB_EMAIL_PARAM"
        echo "  Используется email из параметра: $GITLAB_EMAIL"
    else
        GITLAB_EMAIL=$(get_config_value "gitlab_email")
        if [ -z "$GITLAB_EMAIL" ]; then
            GITLAB_EMAIL=$(prompt_and_save "gitlab_email" "Введите email для отправки уведомлений GitLab" "$SMTP_USER")
        else
            echo "  Используется сохранённый email: $GITLAB_EMAIL"
        fi
    fi
    
    # Сохранение email в конфигурацию
    save_config_value "gitlab_email" "$GITLAB_EMAIL"
    
    # Определение типа шифрования
    echo ""
    echo "  Выберите тип шифрования:"
    echo "  1) STARTTLS (порт 587)"
    echo "  2) SSL/TLS (порт 465)"
    echo "  3) Без шифрования (порт 25)"
    read -p "  Ваш выбор (1-3): " ENCRYPTION_CHOICE
    
    SMTP_TLS=false
    SMTP_STARTTLS=true
    SMTP_OPENSSL_VERIFY_MODE="peer"
    
    case $ENCRYPTION_CHOICE in
        1)
            SMTP_TLS=false
            SMTP_STARTTLS=true
            SMTP_OPENSSL_VERIFY_MODE="peer"
            ;;
        2)
            SMTP_TLS=true
            SMTP_STARTTLS=false
            SMTP_OPENSSL_VERIFY_MODE="peer"
            ;;
        3)
            SMTP_TLS=false
            SMTP_STARTTLS=false
            SMTP_OPENSSL_VERIFY_MODE="none"
            ;;
        *)
            echo "  [Предупреждение] Неверный выбор, используется STARTTLS"
            SMTP_TLS=false
            SMTP_STARTTLS=true
            ;;
    esac
    
    # Добавление SMTP конфигурации в GitLab
    cat >> "$GITLAB_CONFIG" << EOF

# SMTP настройки для внешнего сервера
gitlab_rails['smtp_enable'] = true
gitlab_rails['smtp_address'] = "$SMTP_HOST"
gitlab_rails['smtp_port'] = $SMTP_PORT
gitlab_rails['smtp_user_name'] = "$SMTP_USER"
gitlab_rails['smtp_password'] = "$SMTP_PASSWORD"
gitlab_rails['smtp_domain'] = "$SMTP_DOMAIN"
gitlab_rails['smtp_authentication'] = "login"
gitlab_rails['smtp_enable_starttls_auto'] = $SMTP_STARTTLS
gitlab_rails['smtp_tls'] = $SMTP_TLS
gitlab_rails['smtp_openssl_verify_mode'] = '$SMTP_OPENSSL_VERIFY_MODE'

# Email отправителя
gitlab_rails['gitlab_email_from'] = "$GITLAB_EMAIL"
gitlab_rails['gitlab_email_display_name'] = "GitLab"
gitlab_rails['gitlab_email_reply_to'] = "$GITLAB_EMAIL"
EOF

    echo "  [OK] SMTP настроен для внешнего сервера"
fi

# Применение конфигурации
echo ""
echo "[2/3] Применение конфигурации GitLab..."
echo "  Это может занять несколько минут..."
if gitlab-ctl reconfigure; then
    echo "  [OK] Конфигурация применена"
else
    echo "  [ОШИБКА] Не удалось применить конфигурацию"
    echo "  Восстановление из резервной копии..."
    cp "$BACKUP_FILE" "$GITLAB_CONFIG"
    exit 1
fi

# Тестирование SMTP
echo ""
echo "[3/3] Тестирование SMTP..."
echo "  Отправка тестового email..."

# Создание скрипта для тестирования
TEST_SCRIPT="/tmp/test_gitlab_smtp.rb"
cat > "$TEST_SCRIPT" << 'RUBY_EOF'
require 'net/smtp'
require 'socket'

config_file = '/etc/gitlab/gitlab.rb'
smtp_config = {}

File.readlines(config_file).each do |line|
  if line =~ /gitlab_rails\['smtp_(.+?)'\]\s*=\s*(.+)$/
    key = $1
    value = $2.strip.gsub(/^["']|["']$/, '')
    smtp_config[key] = value
  end
end

if smtp_config['enable'] != 'true'
  puts "SMTP не включен"
  exit 1
end

begin
  smtp = Net::SMTP.new(smtp_config['address'], smtp_config['port'].to_i)
  
  if smtp_config['tls'] == 'true'
    smtp.enable_tls
  elsif smtp_config['enable_starttls_auto'] == 'true'
    smtp.enable_starttls
  end
  
  smtp.start(smtp_config['domain'], smtp_config['user_name'], smtp_config['password'], smtp_config['authentication']) do |smtp|
    from = smtp_config['gitlab_email_from']
    to = smtp_config['gitlab_email_from']
    
    msg = <<MESSAGE
From: #{from}
To: #{to}
Subject: GitLab SMTP Test

This is a test email from GitLab SMTP configuration.
MESSAGE
    
    smtp.send_message(msg, from, to)
    puts "Тестовый email отправлен успешно на #{to}"
  end
rescue => e
  puts "Ошибка отправки тестового email: #{e.message}"
  exit 1
end
RUBY_EOF

# Попытка тестирования через GitLab Rails console
echo "  Попытка отправки тестового email через GitLab..."
TEST_EMAIL_SCRIPT="/tmp/test_gitlab_email.rb"
cat > "$TEST_EMAIL_SCRIPT" << RUBY_EOF
begin
  Notify.test_email('${GITLAB_EMAIL}', 'GitLab SMTP Test', 'This is a test email from GitLab SMTP configuration.').deliver_now
  puts '[OK] Тестовый email отправлен успешно'
rescue => e
  puts '[Предупреждение] Не удалось отправить тестовый email: ' + e.message
  puts 'Проверьте настройки SMTP вручную'
end
RUBY_EOF

if gitlab-rails runner "$(cat $TEST_EMAIL_SCRIPT)" 2>/dev/null; then
    echo "  [OK] Тест выполнен"
else
    echo "  [Предупреждение] Не удалось выполнить автоматический тест"
    echo "  Проверьте настройки SMTP вручную через GitLab UI"
fi

rm -f "$TEST_EMAIL_SCRIPT"

rm -f "$TEST_SCRIPT"

echo ""
echo "=== Настройка SMTP для GitLab завершена! ==="
echo ""
echo "Настройки SMTP:"
if [ "$USE_MAILU" = true ]; then
    echo "  Тип: Mailu Mail Server"
    echo "  Host: $SMTP_HOST"
    echo "  Port: $SMTP_PORT"
    echo "  User: $SMTP_USER"
    echo "  Domain: $BASE_DOMAIN"
else
    echo "  Тип: Внешний SMTP сервер"
    echo "  Host: $SMTP_HOST"
    echo "  Port: $SMTP_PORT"
    echo "  User: $SMTP_USER"
    echo "  Domain: $SMTP_DOMAIN"
fi
echo "  Email отправителя: $GITLAB_EMAIL"
echo ""
echo "Следующие шаги:"
echo "  1. Проверьте получение тестового email на $GITLAB_EMAIL"
echo "  2. Если email не получен, проверьте логи:"
echo "     tail -f /var/log/gitlab/gitlab-rails/production.log | grep -i mail"
echo "  3. Проверьте настройки в GitLab UI:"
echo "     Admin Area → Settings → General → Email"
echo ""
echo "Проверка конфигурации:"
echo "  gitlab-ctl show-config | grep smtp"
echo ""
