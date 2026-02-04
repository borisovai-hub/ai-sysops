#!/bin/bash
# Скрипт загрузки файлов для установки на одну машину
# Использование: ./upload-single-machine.sh [--check] [--auto] [--force]
#   --check  только проверить наличие файлов, без загрузки
#   --auto   автоматический режим (использовать сохранённые данные)
#   --force  принудительная отправка всех файлов
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение и найдет все необходимые файлы.

set +e  # Отключаем немедленный выход при ошибке для корректной обработки проверок файлов
CHECK_ONLY=false
AUTO_MODE=false
FORCE_UPLOAD=false
for a in "$@"; do
    case $a in
        --check)
            CHECK_ONLY=true
            ;;
        --auto)
            AUTO_MODE=true
            ;;
        --force)
            FORCE_UPLOAD=true
            ;;
    esac
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
    "$SCRIPT_DIR/single-machine/add-mailu-calendar.sh"
    "$SCRIPT_DIR/single-machine/setup-mailu-calendar-roundcube.sh"
    "$SCRIPT_DIR/single-machine/install-mailu-infcloud.sh"
    "$SCRIPT_DIR/single-machine/install-gitlab-runner.sh"
    "$SCRIPT_DIR/single-machine/setup-cicd.sh"
    "$SCRIPT_DIR/single-machine/configure-traefik-deploy.sh"
    "$SCRIPT_DIR/single-machine/mailu-setup-render.py"
    "$SCRIPT_DIR/single-machine/setup-dns-api.sh"
    "$SCRIPT_DIR/single-machine/configure-traefik.sh"
    "$SCRIPT_DIR/single-machine/configure-gitlab-smtp.sh"
    "$SCRIPT_DIR/single-machine/configure-gitlab-smtp-quick.sh"
    "$SCRIPT_DIR/single-machine/add-ssl-domains.sh"
    "$SCRIPT_DIR/single-machine/manage-base-domains.sh"
    "$SCRIPT_DIR/single-machine/fix-mtu-issue.sh",
    "$SCRIPT_DIR/single-machine/disable-http2-traefik.sh"
)
MANAGEMENT_UI_PATH="$PROJECT_ROOT/management-ui"
DNS_API_PATH="$SCRIPT_DIR/dns-api"
CONFIG_CICD_PATH="$PROJECT_ROOT/config/single-machine/cicd"

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
[ -d "$CONFIG_CICD_PATH" ]   && echo "  [✓] config/single-machine/cicd/ - найдена" || echo "  [!] config/single-machine/cicd/ - не найдена (опционально)"
[ -d "$SCRIPT_DIR/single-machine/roundcube-calendar-link" ] && echo "  [✓] single-machine/roundcube-calendar-link/ - найдена" || echo "  [!] single-machine/roundcube-calendar-link/ - не найдена (опционально, для кнопки календаря в Roundcube)"

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
if [ "$AUTO_MODE" = true ]; then
    # Автоматический режим - используем сохранённые данные
    SERVER_IP=$(get_config_value "server_ip")
    USERNAME=$(get_config_value "username")
    REMOTE_PATH=$(get_config_value "remote_path")
    AUTH_METHOD=$(get_config_value "auth_method")
    KEY_PATH=$(get_config_value "key_path")
    
    if [ -z "$SERVER_IP" ] || [ -z "$USERNAME" ]; then
        echo "Ошибка: Не все данные сохранены. Запустите скрипт без --auto для настройки."
        exit 1
    fi
    
    [ -z "$REMOTE_PATH" ] && REMOTE_PATH="~/install"
    echo "Автоматический режим: используем сохранённые данные"
    echo "  Сервер: ${USERNAME}@${SERVER_IP}"
    echo "  Путь: ${REMOTE_PATH}"
else
    SERVER_IP=$(prompt_with_default "Введите IP адрес сервера" "server_ip")
    USERNAME=$(prompt_with_default "Введите имя пользователя (обычно root)" "username" "root")
    REMOTE_PATH=$(prompt_with_default "Введите путь на сервере" "remote_path" "~/install")
    [ -z "$REMOTE_PATH" ] && REMOTE_PATH="~/install"
    
    echo ""
    echo "Выберите метод аутентификации:"
    echo "1) SSH ключ"
    echo "2) Пароль"
    AUTH_METHOD=$(prompt_with_default "Ваш выбор (1 или 2)" "auth_method")
fi

SCP_OPTIONS=""
if [ "$AUTH_METHOD" = "1" ] || ([ "$AUTO_MODE" = true ] && [ "$AUTH_METHOD" = "1" ]); then
    if [ "$AUTO_MODE" != true ]; then
        save_config_value "auth_method" "1"
        KEY_PATH=$(prompt_with_default "Введите путь к SSH ключу" "key_path" "$HOME/.ssh/id_rsa")
        [ -z "$KEY_PATH" ] && KEY_PATH="$HOME/.ssh/id_rsa"
    fi
    [ -z "$KEY_PATH" ] && KEY_PATH="$HOME/.ssh/id_rsa"
    if [ ! -f "$KEY_PATH" ]; then
        echo "Ошибка: SSH ключ не найден: $KEY_PATH"
        exit 1
    fi
    SCP_OPTIONS="-i $KEY_PATH"
    echo "Используется SSH ключ: $KEY_PATH"
elif [ "$AUTO_MODE" != true ]; then
    save_config_value "auth_method" "2"
    echo "Будет запрошен пароль при подключении"
fi

# Формирование команды SCP
SCP_TARGET="${USERNAME}@${SERVER_IP}:${REMOTE_PATH}"

# Вывод команды для проверки
echo ""
echo "Команда для выполнения:"
if [ -n "$SCP_OPTIONS" ]; then
    echo "scp $SCP_OPTIONS ... $SCP_TARGET/scripts/single-machine/"
    echo "scp $SCP_OPTIONS -r management-ui $SCP_TARGET/"
    echo "scp $SCP_OPTIONS -r dns-api $SCP_TARGET/scripts/"
    echo "scp $SCP_OPTIONS -r roundcube-calendar-link $SCP_TARGET/scripts/single-machine/"
else
    echo "scp ... $SCP_TARGET/scripts/single-machine/"
    echo "scp -r management-ui $SCP_TARGET/"
    echo "scp -r dns-api $SCP_TARGET/scripts/"
    echo "scp -r roundcube-calendar-link $SCP_TARGET/scripts/single-machine/"
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
init_upload_cache

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

# Функция для получения времени модификации файла
get_file_mtime() {
    local file="$1"
    if [ -f "$file" ]; then
        stat -c %Y "$file" 2>/dev/null || stat -f %m "$file" 2>/dev/null || echo "0"
    else
        echo "0"
    fi
}

# Локальный кэш mtime: сохраняем время после загрузки, сравниваем по нему (без SSH)
# Файл: ~/.upload-single-machine-mtimes-<target>.cache, строки "path|mtime"
CACHE_FILE=""
init_upload_cache() {
    local key
    key=$(echo "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}" | sed 's/[^a-zA-Z0-9._-]/_/g')
    CACHE_FILE="${HOME}/.upload-single-machine-mtimes-${key}.cache"
}

get_saved_mtime() {
    local path="$1"
    [ -z "$CACHE_FILE" ] && return
    grep -F "$path|" "$CACHE_FILE" 2>/dev/null | head -1 | cut -d'|' -f2
}

save_saved_mtime() {
    local path="$1"
    local mtime="$2"
    [ -z "$path" ] && return
    if [ -f "$CACHE_FILE" ]; then
        grep -v -F "$path|" "$CACHE_FILE" > "${CACHE_FILE}.tmp" 2>/dev/null || true
    else
        : > "${CACHE_FILE}.tmp" 2>/dev/null || true
    fi
    echo "${path}|${mtime}" >> "${CACHE_FILE}.tmp"
    mv "${CACHE_FILE}.tmp" "$CACHE_FILE" 2>/dev/null || true
}

# Нужно ли отправлять: сравниваем локальный mtime с сохранённым (без SSH)
should_upload_file() {
    local local_file="$1"
    local cache_path="$2"
    
    if [ "$FORCE_UPLOAD" = true ]; then
        return 0
    fi
    if [ ! -f "$local_file" ]; then
        return 1
    fi
    local local_mtime=$(get_file_mtime "$local_file")
    [ -z "$local_mtime" ] || ! [ "$local_mtime" -gt 0 ] 2>/dev/null && return 1
    
    local saved_mtime
    saved_mtime=$(get_saved_mtime "$cache_path")
    if [ -z "$saved_mtime" ]; then
        return 0
    fi
    [ "$local_mtime" -gt "$saved_mtime" ] 2>/dev/null
}

# Сохранить mtime для всех файлов в директории (после успешной загрузки)
save_dir_mtimes_to_cache() {
    local local_dir="$1"
    local cache_prefix="$2"
    [ ! -d "$local_dir" ] && return
    while IFS= read -r -d '' file; do
        [ -z "$file" ] && continue
        rel_path="${file#$local_dir}"
        rel_path="${rel_path#/}"
        [ -z "$rel_path" ] && continue
        save_saved_mtime "${cache_prefix}/${rel_path}" "$(get_file_mtime "$file")"
    done < <(find "$local_dir" -type f -print0 2>/dev/null)
}

# Функция для проверки и отправки директории (сравнение по локальному кэшу mtime)
upload_directory_if_changed() {
    local local_dir="$1"
    local remote_dir="$2"
    local dir_name="$3"
    
    if [ ! -d "$local_dir" ]; then
        return 1
    fi
    
    if [ "$FORCE_UPLOAD" = true ]; then
        if [ "$CHECK_ONLY" != true ]; then
            echo "    [Force] Отправка всей директории $dir_name"
        fi
        return 0
    fi
    
    local has_changes=false
    local files_to_check=0
    local changed_files=0
    
    while IFS= read -r -d '' file; do
        [ -z "$file" ] && continue
        files_to_check=$((files_to_check + 1))
        rel_path="${file#$local_dir}"
        rel_path="${rel_path#/}"
        cache_path="${dir_name}/${rel_path}"
        
        if should_upload_file "$file" "$cache_path"; then
            has_changes=true
            changed_files=$((changed_files + 1))
            if [ "$CHECK_ONLY" != true ]; then
                echo "      [Изменён] $rel_path"
            fi
        fi
    done < <(find "$local_dir" -type f -print0 2>/dev/null)
    
    if [ "$files_to_check" -eq 0 ]; then
        if [ "$CHECK_ONLY" != true ]; then
            echo "    [Пропуск] $dir_name - директория пуста"
        fi
        return 1
    fi
    
    if [ "$has_changes" = true ]; then
        if [ "$CHECK_ONLY" != true ]; then
            echo "    [Изменено] $dir_name: $changed_files из $files_to_check файлов"
        fi
        return 0
    else
        if [ "$CHECK_ONLY" != true ]; then
            echo "    [Пропуск] $dir_name - без изменений ($files_to_check файлов)"
        fi
        return 1
    fi
}

# Создание директорий на сервере
echo "  1/6 Создание директорий..."
if ! do_ssh "mkdir -p ${REMOTE_PATH}/scripts/single-machine ${REMOTE_PATH}/scripts/dns-api ${REMOTE_PATH}/config/single-machine/cicd"; then
    echo "  [ОШИБКА] Не удалось подключиться по SSH или создать директории"
    UPLOAD_FAILED=1
fi

if [ $UPLOAD_FAILED -eq 0 ]; then
    echo "  2/6 Загрузка скриптов single-machine..."
    FILES_TO_UPLOAD=()
    for file in "${FILES[@]}"; do
        if [ -f "$file" ]; then
            filename=$(basename "$file")
            cache_path="single-machine/$filename"
            if should_upload_file "$file" "$cache_path"; then
                FILES_TO_UPLOAD+=("$file")
                [ "$FORCE_UPLOAD" != true ] && echo "    [Изменён] $filename"
            else
                [ "$CHECK_ONLY" != true ] && echo "    [Пропуск] $filename - без изменений"
            fi
        fi
    done
    
    if [ ${#FILES_TO_UPLOAD[@]} -gt 0 ]; then
        if ! do_scp "${FILES_TO_UPLOAD[@]}" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/scripts/single-machine/"; then
            echo "  [ОШИБКА] Не удалось загрузить скрипты"
            UPLOAD_FAILED=1
        else
            for file in "${FILES_TO_UPLOAD[@]}"; do
                save_saved_mtime "single-machine/$(basename "$file")" "$(get_file_mtime "$file")"
            done
            echo "  [OK] Загружено файлов: ${#FILES_TO_UPLOAD[@]}"
        fi
    else
        echo "  [Пропуск] Нет изменённых файлов для загрузки"
    fi
fi

if [ $UPLOAD_FAILED -eq 0 ]; then
    echo "  3/6 Загрузка management-ui..."
    if upload_directory_if_changed "$MANAGEMENT_UI_PATH" "${REMOTE_PATH}/management-ui" "management-ui"; then
        if [ "$CHECK_ONLY" != true ]; then
            if ! do_scp -r "$MANAGEMENT_UI_PATH" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/"; then
                echo "  [ОШИБКА] Не удалось загрузить management-ui"
                UPLOAD_FAILED=1
            else
                save_dir_mtimes_to_cache "$MANAGEMENT_UI_PATH" "management-ui"
                echo "  [OK] management-ui загружен"
            fi
        fi
    fi
fi

if [ $UPLOAD_FAILED -eq 0 ]; then
    echo "  4/6 Загрузка dns-api..."
    if upload_directory_if_changed "$DNS_API_PATH" "${REMOTE_PATH}/scripts/dns-api" "dns-api"; then
        if [ "$CHECK_ONLY" != true ]; then
            if ! do_scp -r "$DNS_API_PATH" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/scripts/"; then
                echo "  [ОШИБКА] Не удалось загрузить dns-api"
                UPLOAD_FAILED=1
            else
                save_dir_mtimes_to_cache "$DNS_API_PATH" "dns-api"
                echo "  [OK] dns-api загружен"
            fi
        fi
    fi
fi

ROUNDCUBE_CALENDAR_LINK="$SCRIPT_DIR/single-machine/roundcube-calendar-link"
if [ $UPLOAD_FAILED -eq 0 ]; then
    if [ -d "$ROUNDCUBE_CALENDAR_LINK" ]; then
        echo "  5/6 Загрузка roundcube-calendar-link (плагин календаря)..."
        if upload_directory_if_changed "$ROUNDCUBE_CALENDAR_LINK" "${REMOTE_PATH}/scripts/single-machine/roundcube-calendar-link" "roundcube-calendar-link"; then
            if [ "$CHECK_ONLY" != true ]; then
                if ! do_scp -r "$ROUNDCUBE_CALENDAR_LINK" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/scripts/single-machine/"; then
                    echo "  [ОШИБКА] Не удалось загрузить roundcube-calendar-link"
                    UPLOAD_FAILED=1
                else
                    save_dir_mtimes_to_cache "$ROUNDCUBE_CALENDAR_LINK" "roundcube-calendar-link"
                    echo "  [OK] roundcube-calendar-link загружен"
                fi
            fi
        fi
    else
        echo "  5/6 [Пропуск] roundcube-calendar-link не найдена (опционально)"
    fi
fi

if [ $UPLOAD_FAILED -eq 0 ] && [ -d "$CONFIG_CICD_PATH" ]; then
    echo "  6/6 Загрузка config/cicd..."
    if ! do_ssh "mkdir -p ${REMOTE_PATH}/config/single-machine/cicd"; then
        echo "  [ОШИБКА] Не удалось создать директорию для config/cicd"
        UPLOAD_FAILED=1
    else
        if upload_directory_if_changed "$CONFIG_CICD_PATH" "${REMOTE_PATH}/config/single-machine/cicd" "config/cicd"; then
            if [ "$CHECK_ONLY" != true ]; then
                if ! do_scp -r "$CONFIG_CICD_PATH" "${USERNAME}@${SERVER_IP}:${REMOTE_PATH}/config/single-machine/"; then
                    echo "  [ОШИБКА] Не удалось загрузить config/cicd"
                    UPLOAD_FAILED=1
                else
                    save_dir_mtimes_to_cache "$CONFIG_CICD_PATH" "config/cicd"
                    echo "  [OK] config/cicd загружен"
                fi
            fi
        fi
    fi
elif [ ! -d "$CONFIG_CICD_PATH" ]; then
    echo "  6/6 [Пропуск] config/cicd не найдена (опционально)"
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
    echo "  (календарь: sudo ./add-mailu-calendar.sh [mailu-dir]; кнопка в Roundcube: sudo ./setup-mailu-calendar-roundcube.sh; веб-календарь InfCloud: sudo ./install-mailu-infcloud.sh)"
else
    echo ""
    echo "Ошибка при загрузке файлов!"
    echo "Проверьте: IP, пользователь, SSH доступ"
    if [ "$AUTH_METHOD" = "1" ]; then
        echo "  и путь к SSH ключу: $KEY_PATH"
    fi
    exit 1
fi
