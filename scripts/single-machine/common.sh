#!/bin/bash
# Общие функции для скриптов установки
# Использование: source common.sh

# Файлы для отслеживания состояния
INSTALL_STATE_FILE="/var/log/install-state.json"
INSTALL_LOG_FILE="/var/log/install-progress.log"
INSTALL_CONFIG_FILE="/etc/install-config.json"

# Инициализация файла состояния
init_install_state() {
    mkdir -p "$(dirname "$INSTALL_STATE_FILE")"
    if [ ! -f "$INSTALL_STATE_FILE" ]; then
        cat > "$INSTALL_STATE_FILE" << EOF
{
  "started_at": "$(date -Iseconds)",
  "completed_steps": [],
  "failed_steps": [],
  "current_step": ""
}
EOF
    fi
}

# Сохранение состояния установки
save_install_state() {
    local step="$1"
    local status="$2"  # "completed" или "failed"
    
    if [ ! -f "$INSTALL_STATE_FILE" ]; then
        init_install_state
    fi
    
    # Обновление JSON файла (простой способ без jq)
    if [ "$status" = "completed" ]; then
        # Добавляем шаг в completed_steps если его там нет
        if ! grep -q "\"$step\"" "$INSTALL_STATE_FILE"; then
            sed -i "s|\"completed_steps\": \[|\"completed_steps\": [\"$step\", |" "$INSTALL_STATE_FILE"
        fi
        # Удаляем из failed_steps если там есть
        sed -i "s|\"$step\",||g" "$INSTALL_STATE_FILE"
        sed -i "s|, \"$step\"||g" "$INSTALL_STATE_FILE"
    elif [ "$status" = "failed" ]; then
        # Добавляем шаг в failed_steps если его там нет
        if ! grep -q "\"$step\"" "$INSTALL_STATE_FILE"; then
            sed -i "s|\"failed_steps\": \[|\"failed_steps\": [\"$step\", |" "$INSTALL_STATE_FILE"
        fi
    fi
    
    # Обновление current_step
    sed -i "s|\"current_step\": \".*\"|\"current_step\": \"$step\"|" "$INSTALL_STATE_FILE"
}

# Проверка выполненного шага
is_step_completed() {
    local step="$1"
    if [ -f "$INSTALL_STATE_FILE" ]; then
        grep -q "\"$step\"" "$INSTALL_STATE_FILE" && grep -A 10 "completed_steps" "$INSTALL_STATE_FILE" | grep -q "\"$step\""
    else
        return 1
    fi
}

# Проверка установленного пакета
is_package_installed() {
    local package="$1"
    dpkg -l 2>/dev/null | grep -q "^ii.*$package"
}

# Проверка установленного systemd сервиса
# Принимает "mailu", "mailu.service" и т.п. — суффикс .service отбрасывается при наличии
is_service_installed() {
    local service="${1%.service}"
    systemctl list-unit-files 2>/dev/null | grep -q "^${service}\.service"
}

# Проверка запущенного сервиса
is_service_running() {
    local service="$1"
    systemctl is-active --quiet "$service" 2>/dev/null
}

# Проверка существования файла
is_file_exists() {
    [ -f "$1" ]
}

# Проверка существования директории
is_dir_exists() {
    [ -d "$1" ]
}

# Проверка существования команды
is_command_exists() {
    command -v "$1" &> /dev/null
}

# Безопасное выполнение команды с логированием
safe_execute() {
    local step_name="$1"
    shift
    local command="$@"
    
    mkdir -p "$(dirname "$INSTALL_LOG_FILE")"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] Начало: $step_name" >> "$INSTALL_LOG_FILE"
    
    if eval "$command" >> "$INSTALL_LOG_FILE" 2>&1; then
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Успех: $step_name" >> "$INSTALL_LOG_FILE"
        save_install_state "$step_name" "completed"
        return 0
    else
        local exit_code
        exit_code=$?
        echo "[$(date '+%Y-%m-%d %H:%M:%S')] Ошибка: $step_name (код: $exit_code)" >> "$INSTALL_LOG_FILE"
        save_install_state "$step_name" "failed"
        return $exit_code
    fi
}

# Проверка с возможностью пропуска
check_and_skip() {
    local component="$1"
    local check_function="$2"
    local force="${3:-false}"
    
    if [ "$force" = "true" ]; then
        return 1  # Не пропускаем, переустанавливаем
    fi
    
    if $check_function; then
        echo "  [Пропуск] $component уже установлен"
        return 0  # Пропускаем
    else
        return 1  # Не установлен, продолжаем
    fi
}

# Запрос подтверждения для переустановки
confirm_reinstall() {
    local component="$1"
    echo ""
    echo "ВНИМАНИЕ: $component уже установлен"
    read -p "Переустановить? (y/n): " CONFIRM
    if [ "$CONFIRM" = "y" ] || [ "$CONFIRM" = "Y" ]; then
        return 0
    else
        return 1
    fi
}

# Функции для работы с конфигурацией установки
load_install_config() {
    if [ -f "$INSTALL_CONFIG_FILE" ]; then
        # Загрузка конфигурации из JSON (простой способ без jq)
        # Используем grep и sed для извлечения значений
        return 0
    else
        return 1
    fi
}

# Удаление \r и обрезка пробелов (защита от CRLF и непечатаемых символов)
_sanitize_value() {
    sed 's/\r//g' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

get_config_value() {
    local key="$1"
    local val=""
    if [ -f "$INSTALL_CONFIG_FILE" ]; then
        val=$(grep -o "\"$key\": \"[^\"]*\"" "$INSTALL_CONFIG_FILE" 2>/dev/null | cut -d'"' -f4)
    fi
    echo "$val" | _sanitize_value
}

save_config_value() {
    local key="$1"
    local value="$2"
    
    mkdir -p "$(dirname "$INSTALL_CONFIG_FILE")"
    
    # Убираем \r и лишние пробелы, затем экранируем для JSON
    value=$(echo "$value" | _sanitize_value | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
    
    if [ ! -f "$INSTALL_CONFIG_FILE" ]; then
        printf "{\n  \"%s\": \"%s\"\n}\n" "$key" "$value" > "$INSTALL_CONFIG_FILE"
        return 0
    fi
    
    # Простое обновление JSON (замена или добавление значения)
    if grep -q "\"$key\"" "$INSTALL_CONFIG_FILE"; then
        # Заменяем существующее значение
        sed -i "s|\"$key\": \"[^\"]*\"|\"$key\": \"$value\"|" "$INSTALL_CONFIG_FILE"
    else
        # Добавляем новое значение перед закрывающей скобкой
        # Удаляем последнюю закрывающую скобку и добавляем новое поле
        sed -i '$ s/}$/,\n  "'"$key"'": "'"$value"'"\n}/' "$INSTALL_CONFIG_FILE"
        # Если файл содержит только {}, заменяем полностью
        if grep -q "^{}$" "$INSTALL_CONFIG_FILE"; then
            printf "{\n  \"%s\": \"%s\"\n}\n" "$key" "$value" > "$INSTALL_CONFIG_FILE"
        fi
    fi
}

# Функция для запроса значения с сохранением
prompt_and_save() {
    local key="$1"
    local prompt="$2"
    local default_value="${3:-}"
    local value=""
    
    # Пытаемся загрузить из конфигурации
    local saved_value=$(get_config_value "$key")
    
    if [ -n "$saved_value" ]; then
        default_value="$saved_value"
    fi
    
    if [ -n "$default_value" ]; then
        read -p "$prompt [$default_value]: " value
        if [ -z "$value" ]; then
            value="$default_value"
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

# Функция для запроса выбора с сохранением
prompt_choice_and_save() {
    local key="$1"
    local prompt="$2"
    local options="$3"
    local default_value="${4:-}"
    local value=""
    
    # Пытаемся загрузить из конфигурации
    local saved_value=$(get_config_value "$key")
    
    if [ -n "$saved_value" ]; then
        default_value="$saved_value"
    fi
    
    if [ -n "$default_value" ]; then
        read -p "$prompt [$default_value]: " value
        if [ -z "$value" ]; then
            value="$default_value"
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

# Функции для работы с базовыми доменами (несколько DNS адресов для сервисов)
# base_domains хранится в конфиге как строка через запятую: "borisovai.ru,borisovai.tech"

get_base_domains() {
    local raw
    raw=$(get_config_value "base_domains")
    if [ -z "$raw" ]; then
        return 1
    fi
    echo "$raw" | tr -d '\r' | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$'
}

save_base_domains() {
    local domains="$1"
    local normalized
    normalized=$(echo "$domains" | tr '\n' ',' | tr -s ',' ',' | sed 's/^,//;s/,$//')
    save_config_value "base_domains" "$normalized"
}

# Строит полные домены для сервиса: prefix [+ middle.] + каждый базовый домен
# Использование: build_service_domains "gitlab" -> gitlab.borisovai.ru, gitlab.borisovai.tech
#               build_service_domains "gitlab" "dev" -> gitlab.dev.borisovai.ru, gitlab.dev.borisovai.tech
# При prefix="" возвращает apex-домены: borisovai.ru, borisovai.tech
build_service_domains() {
    local prefix="$1"
    local middle="${2:-}"
    local base
    if [ -z "$(get_config_value "base_domains")" ]; then
        return 1
    fi
    while IFS= read -r base; do
        [ -z "$base" ] && continue
        if [ -z "$prefix" ]; then
            echo "$base"
        elif [ -n "$middle" ]; then
            echo "${prefix}.${middle}.${base}"
        else
            echo "${prefix}.${base}"
        fi
    done < <(get_base_domains)
}

# Создаёт DNS записи для всех доменов сервиса (prefix + base_domains)
# Использование: create_dns_records_for_domains "gitlab" [ip]
# Если ip не передан, определяется автоматически
create_dns_records_for_domains() {
    local prefix="$1"
    local ip="${2:-}"
    local full_domain base
    if [ -z "$prefix" ]; then
        return 0
    fi
    if [ -z "$ip" ]; then
        ip=$(curl -s ifconfig.me 2>/dev/null || curl -s ifconfig.co 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')
    fi
    if [ -z "$ip" ]; then
        echo "  [Предупреждение] Не удалось определить IP для DNS записей"
        return 1
    fi
    if ! command -v curl &>/dev/null; then
        echo "  [Предупреждение] curl не найден, пропуск создания DNS записей"
        return 1
    fi
    local records_json=""
    local first=1
    while IFS= read -r full_domain; do
        [ -z "$full_domain" ] && continue
        base="${full_domain#$prefix.}"
        if [ -n "$records_json" ]; then
            records_json="${records_json},"
        fi
        records_json="${records_json}{\"subdomain\":\"${prefix}\",\"domain\":\"${base}\",\"ip\":\"${ip}\"}"
    done < <(build_service_domains "$prefix")
    if [ -z "$records_json" ]; then
        return 0
    fi
    if curl -s -X POST -H "Content-Type: application/json" -d "{\"records\":[${records_json}]}" \
        "http://127.0.0.1:5353/api/records/bulk" 2>/dev/null | grep -q '"records"'; then
        echo "  [OK] DNS записи созданы для $prefix (через bulk API)"
        return 0
    fi
    while IFS= read -r full_domain; do
        [ -z "$full_domain" ] && continue
        base="${full_domain#$prefix.}"
        if curl -s -X POST -H "Content-Type: application/json" \
            -d "{\"subdomain\":\"${prefix}\",\"domain\":\"${base}\",\"ip\":\"${ip}\"}" \
            "http://127.0.0.1:5353/api/records" 2>/dev/null | grep -q '"record"'; then
            echo "  [OK] $full_domain"
        fi
    done < <(build_service_domains "$prefix")
    return 0
}

# Обработка ошибок (для использования с trap)
handle_error() {
    local exit_code=$1
    local line=$2
    local script_name="${BASH_SOURCE[1]##*/}"
    
    echo ""
    echo "ОШИБКА: Ошибка в $script_name на строке $line (код выхода: $exit_code)"
    echo "Лог сохранен в: $INSTALL_LOG_FILE"
    echo ""
    echo "Для продолжения установки используйте:"
    echo "  sudo $0 --continue"
    echo ""
}
