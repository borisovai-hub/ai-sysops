#!/bin/bash
# Скрипт загрузки файлов для установки на одну машину
# Использование: ./upload-single-machine.sh
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение и найдет все необходимые файлы.

set -e

# Определение директории скрипта (абсолютный путь)
# Это позволяет запускать скрипт из любой директории
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CONFIG_FILE="$HOME/.upload-single-machine-config.json"

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

echo "=== Загрузка скриптов для установки на одну машину ==="
echo ""
echo "Директория скрипта: $SCRIPT_DIR"
echo "Корень проекта: $PROJECT_ROOT"
echo ""

# Запрос данных для подключения с сохранением
SERVER_IP=$(prompt_with_default "Введите IP адрес сервера" "server_ip")
USERNAME=$(prompt_with_default "Введите имя пользователя (обычно root)" "username" "root")
REMOTE_PATH=$(prompt_with_default "Введите путь на сервере" "remote_path" "~/install")

if [ -z "$REMOTE_PATH" ]; then
    REMOTE_PATH="~/install"
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
    "$SCRIPT_DIR/single-machine/common.sh"
    "$SCRIPT_DIR/single-machine/install-all.sh"
    "$SCRIPT_DIR/single-machine/install-traefik.sh"
    "$SCRIPT_DIR/single-machine/install-gitlab.sh"
    "$SCRIPT_DIR/single-machine/install-n8n.sh"
    "$SCRIPT_DIR/single-machine/install-management-ui.sh"
    "$SCRIPT_DIR/single-machine/setup-dns-api.sh"
    "$SCRIPT_DIR/single-machine/configure-traefik.sh"
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

# Проверка директории management-ui (абсолютный путь)
MANAGEMENT_UI_PATH="$PROJECT_ROOT/management-ui"
if [ -d "$MANAGEMENT_UI_PATH" ]; then
    echo "  [✓] management-ui/ - найдена в $MANAGEMENT_UI_PATH"
else
    echo "  [X] management-ui/ - не найдена в $MANAGEMENT_UI_PATH"
    MISSING_FILES=1
fi

# Проверка директории dns-api (абсолютный путь)
DNS_API_PATH="$SCRIPT_DIR/dns-api"
if [ -d "$DNS_API_PATH" ]; then
    echo "  [✓] dns-api/ - найдена в $DNS_API_PATH"
else
    echo "  [X] dns-api/ - не найдена в $DNS_API_PATH"
    MISSING_FILES=1
fi

if [ $MISSING_FILES -eq 1 ]; then
    echo ""
    echo "Ошибка: Некоторые файлы не найдены!"
    echo "Убедитесь, что все скрипты находятся в правильных директориях."
    exit 1
fi

# Формирование команды SCP
SCP_TARGET="${USERNAME}@${SERVER_IP}:${REMOTE_PATH}"

# Вывод команды для проверки
echo ""
echo "Команда для выполнения:"
if [ -n "$SCP_OPTIONS" ]; then
    echo "scp $SCP_OPTIONS ${FILES[*]} $SCP_TARGET/"
    echo "scp $SCP_OPTIONS -r management-ui $SCP_TARGET/"
    echo "scp $SCP_OPTIONS -r dns-api $SCP_TARGET/scripts/"
else
    echo "scp ${FILES[*]} $SCP_TARGET/"
    echo "scp -r management-ui $SCP_TARGET/"
    echo "scp -r dns-api $SCP_TARGET/scripts/"
fi
echo ""

# Выполнение команды
echo "Загрузка файлов на сервер..."
if [ -n "$SCP_OPTIONS" ]; then
    # Создание директории на сервере
    ssh $SCP_OPTIONS "${USERNAME}@${SERVER_IP}" "mkdir -p ${REMOTE_PATH}/scripts/single-machine"
    
    # Загрузка скриптов
    scp $SCP_OPTIONS "${FILES[@]}" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/scripts/single-machine/"
    
    # Загрузка management-ui (используем абсолютный путь)
    scp $SCP_OPTIONS -r "$MANAGEMENT_UI_PATH" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/"
    
    # Загрузка dns-api (используем абсолютный путь)
    scp $SCP_OPTIONS -r "$DNS_API_PATH" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/scripts/"
else
    # Создание директории на сервере
    ssh "${USERNAME}@${SERVER_IP}" "mkdir -p ${REMOTE_PATH}/scripts/single-machine"
    
    # Загрузка скриптов
    scp "${FILES[@]}" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/scripts/single-machine/"
    
    # Загрузка management-ui (используем абсолютный путь)
    scp -r "$MANAGEMENT_UI_PATH" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/"
    
    # Загрузка dns-api (используем абсолютный путь)
    scp -r "$DNS_API_PATH" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/scripts/"
fi

if [ $? -eq 0 ]; then
    echo ""
    echo "✓ Файлы успешно загружены!"
    echo ""
    echo "Следующие шаги на сервере:"
    echo "1. Подключитесь по SSH: ssh ${USERNAME}@${SERVER_IP}"
    echo "2. Перейдите в директорию: cd ${REMOTE_PATH}/scripts/single-machine"
    echo "3. Сделайте скрипты исполняемыми: chmod +x *.sh"
    echo "4. Запустите установку: sudo ./install-all.sh"
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
