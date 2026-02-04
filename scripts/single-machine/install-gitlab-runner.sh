#!/bin/bash
# Скрипт установки GitLab Runner на одну машину
# Использование: sudo ./install-gitlab-runner.sh [--force]
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
FORCE_MODE=false

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
    esac
done

echo "=== Установка GitLab Runner ==="
echo ""

# Проверка существования GitLab Runner
if [ "$FORCE_MODE" != true ]; then
    if is_command_exists "gitlab-runner" && is_service_installed "gitlab-runner.service"; then
        echo "  [Пропуск] GitLab Runner уже установлен"
        if is_service_running "gitlab-runner.service"; then
            echo "  [OK] GitLab Runner запущен"
        else
            echo "  [Предупреждение] GitLab Runner установлен, но не запущен"
            echo "  Запуск сервиса..."
            systemctl start gitlab-runner
        fi
        exit 0
    fi
fi

# Обновление системы
echo "[1/5] Обновление системы..."
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get upgrade -y

# Установка зависимостей
echo ""
echo "[2/5] Установка зависимостей..."
apt-get install -y curl wget

# Скачивание и установка GitLab Runner
echo ""
echo "[3/5] Скачивание GitLab Runner..."
RUNNER_BINARY="/usr/local/bin/gitlab-runner"
if [ "$FORCE_MODE" = true ] || [ ! -f "$RUNNER_BINARY" ]; then
    curl -L --output "$RUNNER_BINARY" "https://gitlab-runner-downloads.s3.amazonaws.com/latest/binaries/gitlab-runner-linux-amd64"
    if [ $? -ne 0 ]; then
        echo "Ошибка: Не удалось скачать GitLab Runner"
        exit 1
    fi
    chmod +x "$RUNNER_BINARY"
    echo "  [OK] GitLab Runner скачан"
else
    echo "  [Пропуск] GitLab Runner уже установлен"
fi

# Создание пользователя gitlab-runner
echo ""
echo "[4/5] Создание пользователя gitlab-runner..."
if ! id -u gitlab-runner &>/dev/null; then
    useradd --comment 'GitLab Runner' --create-home gitlab-runner --shell /bin/bash
    echo "  [OK] Пользователь gitlab-runner создан"
else
    echo "  [Пропуск] Пользователь gitlab-runner уже существует"
fi

# Установка и запуск сервиса
echo ""
echo "[5/5] Установка и запуск сервиса GitLab Runner..."
if [ "$FORCE_MODE" = true ] || ! is_service_installed "gitlab-runner.service"; then
    gitlab-runner install --user=gitlab-runner --working-directory=/home/gitlab-runner
    if [ $? -ne 0 ]; then
        echo "Ошибка: Не удалось установить GitLab Runner как сервис"
        exit 1
    fi
    
    systemctl enable gitlab-runner
    systemctl start gitlab-runner
    
    if systemctl is-active --quiet gitlab-runner; then
        echo "  [OK] GitLab Runner запущен"
    else
        echo "  [Предупреждение] GitLab Runner установлен, но не запущен"
        echo "  Попытка запуска..."
        systemctl start gitlab-runner
        sleep 2
        if systemctl is-active --quiet gitlab-runner; then
            echo "  [OK] GitLab Runner запущен после повторной попытки"
        else
            echo "  [ОШИБКА] Не удалось запустить GitLab Runner"
            echo "  Проверьте логи: journalctl -u gitlab-runner -n 50"
        fi
    fi
else
    echo "  [Пропуск] Сервис GitLab Runner уже установлен"
    if ! systemctl is-active --quiet gitlab-runner; then
        systemctl start gitlab-runner
        echo "  [OK] GitLab Runner запущен"
    fi
fi

# Проверка статуса
echo ""
echo "=== Установка GitLab Runner завершена! ==="
echo ""
echo "Проверка статуса:"
systemctl status gitlab-runner --no-pager | head -10
echo ""
echo "Следующие шаги:"
echo "  1. Зарегистрируйте runner: sudo ./setup-cicd.sh"
echo "  2. Или вручную: sudo gitlab-runner register"
echo ""
echo "Проверка версии:"
gitlab-runner --version
echo ""
