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
is_service_installed() {
    local service="$1"
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
        local exit_code=$?
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

get_config_value() {
    local key="$1"
    if [ -f "$INSTALL_CONFIG_FILE" ]; then
        grep -o "\"$key\": \"[^\"]*\"" "$INSTALL_CONFIG_FILE" 2>/dev/null | cut -d'"' -f4 || echo ""
    else
        echo ""
    fi
}

save_config_value() {
    local key="$1"
    local value="$2"
    
    mkdir -p "$(dirname "$INSTALL_CONFIG_FILE")"
    
    # Экранируем специальные символы в значении для JSON
    value=$(echo "$value" | sed 's/\\/\\\\/g' | sed 's/"/\\"/g')
    
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
