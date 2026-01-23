#!/bin/bash
# Bash скрипт для загрузки файлов на сервер по SCP
# Использование: ./upload-to-server.sh
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение и найдет все необходимые файлы.

set -e

# Определение директории скрипта (абсолютный путь)
# Это позволяет запускать скрипт из любой директории
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$HOME/.upload-config.json"

# Функции для работы с конфигурацией
get_config_value() {
    local key="$1"
    if [ -f "$CONFIG_FILE" ]; then
        grep -o "\"$key\": \"[^\"]*\"" "$CONFIG_FILE" 2>/dev/null | cut -d'"' -f4 || echo ""
    else
        echo ""
    fi
}

save_config_value() {
    local key="$1"
    local value="$2"
    
    if [ ! -f "$CONFIG_FILE" ]; then
        echo "{}" > "$CONFIG_FILE"
    fi
    
    # Экранируем специальные символы
    value=$(echo "$value" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
    
    if grep -q "\"$key\"" "$CONFIG_FILE"; then
        sed -i "s|\"$key\": \"[^\"]*\"|\"$key\": \"$value\"|" "$CONFIG_FILE"
    else
        sed -i '$ s/}$/,\n  "'"$key"'": "'"$value"'"\n}/' "$CONFIG_FILE"
        if grep -q "^{}$" "$CONFIG_FILE"; then
            printf "{\n  \"%s\": \"%s\"\n}\n" "$key" "$value" > "$CONFIG_FILE"
        fi
    fi
}

prompt_with_default() {
    local prompt="$1"
    local key="$2"
    local default_value="${3:-}"
    local saved_value=$(get_config_value "$key")
    local default=""
    
    if [ -n "$saved_value" ]; then
        default="$saved_value"
    elif [ -n "$default_value" ]; then
        default="$default_value"
    fi
    
    local value=""
    if [ -n "$default" ]; then
        read -p "$prompt [$default]: " value
        if [ -z "$value" ]; then
            value="$default"
        fi
    else
        read -p "$prompt: " value
    fi
    
    if [ -n "$value" ]; then
        save_config_value "$key" "$value"
        echo "$value"
    else
        echo ""
    fi
}

echo "=== Загрузка скриптов на сервер по SCP ==="
echo ""
echo "Директория скрипта: $SCRIPT_DIR"
echo ""

# Запрос данных для подключения с сохранением
SERVER_IP=$(prompt_with_default "Введите IP адрес сервера" "server_ip")
USERNAME=$(prompt_with_default "Введите имя пользователя (обычно root)" "username" "root")
REMOTE_PATH=$(prompt_with_default "Введите путь на сервере" "remote_path" "~/windows-install")

if [ -z "$REMOTE_PATH" ]; then
    REMOTE_PATH="~/windows-install"
fi

# Выбор метода аутентификации
echo ""
echo "Выберите метод аутентификации:"
echo "1) SSH ключ"
echo "2) Пароль"
AUTH_METHOD=$(prompt_with_default "Ваш выбор (1 или 2)" "auth_method")

SCP_OPTIONS=""
if [ "$AUTH_METHOD" = "1" ]; then
    save_config_value "auth_method" "1"
    KEY_PATH=$(prompt_with_default "Введите путь к SSH ключу" "key_path" "$HOME/.ssh/id_rsa")
    if [ -z "$KEY_PATH" ]; then
        KEY_PATH="$HOME/.ssh/id_rsa"
    fi
    
    if [ ! -f "$KEY_PATH" ]; then
        echo "Ошибка: SSH ключ не найден: $KEY_PATH"
        exit 1
    fi
    
    SCP_OPTIONS="-i $KEY_PATH"
    echo "Используется SSH ключ: $KEY_PATH"
else
    save_config_value "auth_method" "2"
    echo "Будет запрошен пароль при подключении"
fi

# Список файлов для загрузки (абсолютные пути относительно скрипта)
FILES=(
    "$SCRIPT_DIR/install-windows.sh"
    "$SCRIPT_DIR/setup-grub.sh"
    "$SCRIPT_DIR/download-windows-iso.sh"
)

# Проверка наличия файлов
echo ""
echo "Проверка файлов для загрузки..."
MISSING_FILES=0
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  [✓] $file - найден"
    else
        echo "  [X] $file - не найден"
        MISSING_FILES=1
    fi
done

if [ $MISSING_FILES -eq 1 ]; then
    echo ""
    echo "Ошибка: Некоторые файлы не найдены!"
    echo "Убедитесь, что все скрипты находятся в текущей директории."
    exit 1
fi

# Формирование команды SCP
SCP_TARGET="${USERNAME}@${SERVER_IP}:${REMOTE_PATH}"

# Вывод команды для проверки
echo ""
echo "Команда для выполнения:"
if [ -n "$SCP_OPTIONS" ]; then
    echo "scp $SCP_OPTIONS ${FILES[*]} $SCP_TARGET"
else
    echo "scp ${FILES[*]} $SCP_TARGET"
fi
echo ""

# Выполнение команды
echo "Загрузка файлов на сервер..."
if [ -n "$SCP_OPTIONS" ]; then
    scp $SCP_OPTIONS "${FILES[@]}" "$SCP_TARGET"
else
    scp "${FILES[@]}" "$SCP_TARGET"
fi

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Файлы успешно загружены!"
    echo ""
    echo "Следующие шаги на сервере:"
    echo "1. Подключитесь по SSH: ssh ${USERNAME}@${SERVER_IP}"
    echo "2. Перейдите в директорию: cd ${REMOTE_PATH}"
    echo "3. Сделайте скрипты исполняемыми: chmod +x *.sh"
    echo "4. Запустите установку: sudo su"
    echo "5. Выполните: ./install-windows.sh"
else
    echo ""
    echo "Ошибка при загрузке файлов!"
    echo "Проверьте:"
    echo "  - Правильность IP адреса и имени пользователя"
    echo "  - Доступность сервера по сети"
    echo "  - Наличие SSH доступа"
    if [ "$AUTH_METHOD" = "1" ]; then
        echo "  - Правильность пути к SSH ключу"
    else
        echo "  - Правильность пароля"
    fi
    exit 1
fi
