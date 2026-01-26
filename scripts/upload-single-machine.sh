#!/bin/bash
# Скрипт загрузки файлов для установки на одну машину
# Использование: ./upload-single-machine.sh [--check]
#   --check  только проверить наличие файлов, без загрузки
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение и найдет все необходимые файлы.

set -e
CHECK_ONLY=false
for a in "$@"; do
    [ "$a" = "--check" ] && CHECK_ONLY=true
done

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

# Список файлов и проверка наличия (до запроса данных)
FILES=(
    "$SCRIPT_DIR/single-machine/common.sh"
    "$SCRIPT_DIR/single-machine/install-all.sh"
    "$SCRIPT_DIR/single-machine/install-traefik.sh"
    "$SCRIPT_DIR/single-machine/install-gitlab.sh"
    "$SCRIPT_DIR/single-machine/install-n8n.sh"
    "$SCRIPT_DIR/single-machine/install-management-ui.sh"
    "$SCRIPT_DIR/single-machine/install-mailu.sh"
    "$SCRIPT_DIR/single-machine/mailu-setup-render.py"
    "$SCRIPT_DIR/single-machine/setup-dns-api.sh"
    "$SCRIPT_DIR/single-machine/configure-traefik.sh"
)
MANAGEMENT_UI_PATH="$PROJECT_ROOT/management-ui"
DNS_API_PATH="$SCRIPT_DIR/dns-api"

echo "Проверка файлов для загрузки..."
MISSING_FILES=0
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "  [✓] $(basename "$file") - найден"
    else
        echo "  [X] $file - не найден"
        MISSING_FILES=1
    fi
done
[ -d "$MANAGEMENT_UI_PATH" ] && echo "  [✓] management-ui/ - найдена" || { echo "  [X] management-ui/ - не найдена"; MISSING_FILES=1; }
[ -d "$DNS_API_PATH" ]       && echo "  [✓] dns-api/ - найдена"       || { echo "  [X] dns-api/ - не найдена";       MISSING_FILES=1; }

if [ $MISSING_FILES -eq 1 ]; then
    echo ""
    echo "Ошибка: Некоторые файлы не найдены!"
    exit 1
fi

if [ "$CHECK_ONLY" = true ]; then
    echo ""
    echo "✓ Проверка пройдена (--check). Загрузка не выполнялась."
    exit 0
fi

# Запрос данных для подключения
echo ""
SERVER_IP=$(prompt_with_default "Введите IP адрес сервера" "server_ip")
USERNAME=$(prompt_with_default "Введите имя пользователя (обычно root)" "username" "root")
REMOTE_PATH=$(prompt_with_default "Введите путь на сервере" "remote_path" "~/install")
[ -z "$REMOTE_PATH" ] && REMOTE_PATH="~/install"

echo ""
echo "Выберите метод аутентификации:"
echo "1) SSH ключ"
echo "2) Пароль"
AUTH_METHOD=$(prompt_with_default "Ваш выбор (1 или 2)" "auth_method")

SCP_OPTIONS=""
if [ "$AUTH_METHOD" = "1" ]; then
    save_config_value "auth_method" "1"
    KEY_PATH=$(prompt_with_default "Введите путь к SSH ключу" "key_path" "$HOME/.ssh/id_rsa")
    [ -z "$KEY_PATH" ] && KEY_PATH="$HOME/.ssh/id_rsa"
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

# Нормализация окончаний строк (CRLF → LF) перед отправкой — избежать ошибок на сервере
echo "Нормализация окончаний строк (CRLF → LF)..."
for f in "${FILES[@]}" "$DNS_API_PATH"/*.sh "$SCRIPT_DIR/single-machine"/*.py; do
    [ -f "$f" ] && sed -i 's/\r$//' "$f" 2>/dev/null || true
done
echo "  [OK] Готово к отправке"
echo ""

# Выполнение загрузки с проверкой после каждой операции
echo "Загрузка файлов на сервер..."
UPLOAD_FAILED=0

do_ssh() {
    if [ -n "$SCP_OPTIONS" ]; then
        ssh $SCP_OPTIONS "${USERNAME}@${SERVER_IP}" "$1"
    else
        ssh "${USERNAME}@${SERVER_IP}" "$1"
    fi
}

do_scp() {
    if [ -n "$SCP_OPTIONS" ]; then
        scp $SCP_OPTIONS "$@"
    else
        scp "$@"
    fi
}

# Создание директорий на сервере
echo "  1/4 Создание директорий..."
if ! do_ssh "mkdir -p ${REMOTE_PATH}/scripts/single-machine"; then
    echo "  [ОШИБКА] Не удалось подключиться по SSH или создать директории"
    UPLOAD_FAILED=1
fi

if [ $UPLOAD_FAILED -eq 0 ]; then
    echo "  2/4 Загрузка скриптов single-machine..."
    if ! do_scp "${FILES[@]}" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/scripts/single-machine/"; then
        echo "  [ОШИБКА] Не удалось загрузить скрипты"
        UPLOAD_FAILED=1
    fi
fi

if [ $UPLOAD_FAILED -eq 0 ]; then
    echo "  3/4 Загрузка management-ui..."
    if ! do_scp -r "$MANAGEMENT_UI_PATH" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/"; then
        echo "  [ОШИБКА] Не удалось загрузить management-ui"
        UPLOAD_FAILED=1
    fi
fi

if [ $UPLOAD_FAILED -eq 0 ]; then
    echo "  4/4 Загрузка dns-api..."
    if ! do_scp -r "$DNS_API_PATH" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/scripts/"; then
        echo "  [ОШИБКА] Не удалось загрузить dns-api"
        UPLOAD_FAILED=1
    fi
fi

if [ $UPLOAD_FAILED -eq 0 ]; then
    echo ""
    echo "✓ Файлы успешно загружены!"
    echo ""
    echo "Следующие шаги на сервере:"
    echo "  1. Подключитесь: ssh ${USERNAME}@${SERVER_IP}"
    echo "  2. Перейдите: cd ${REMOTE_PATH}/scripts/single-machine"
    echo "  3. chmod +x *.sh"
    echo "  4. sudo ./install-all.sh"
else
    echo ""
    echo "Ошибка при загрузке файлов!"
    echo "Проверьте: IP, пользователь, SSH доступ"
    if [ "$AUTH_METHOD" = "1" ]; then
        echo "  и путь к SSH ключу: $KEY_PATH"
    fi
    exit 1
fi
