#!/bin/bash
# Скрипт для установки ssh-copy-id в Git Bash на Windows

set -e

echo "=== Установка ssh-copy-id для Git Bash ==="
echo ""

# Определение пути к Git Bash
if [ -z "$GIT_BASH_PATH" ]; then
    # Попытка найти Git Bash автоматически
    if [ -d "/c/Program Files/Git" ]; then
        GIT_BASH_PATH="/c/Program Files/Git"
    elif [ -d "/c/Program Files (x86)/Git" ]; then
        GIT_BASH_PATH="/c/Program Files (x86)/Git"
    else
        echo "Не удалось найти Git Bash автоматически."
        read -p "Введите путь к Git (например, /c/Program Files/Git): " GIT_BASH_PATH
    fi
fi

if [ ! -d "$GIT_BASH_PATH" ]; then
    echo "Ошибка: Директория Git не найдена: $GIT_BASH_PATH"
    exit 1
fi

# Путь к директории с исполняемыми файлами
BIN_PATH="$GIT_BASH_PATH/usr/bin"

if [ ! -d "$BIN_PATH" ]; then
    echo "Ошибка: Директория $BIN_PATH не найдена"
    exit 1
fi

echo "Найден Git Bash: $GIT_BASH_PATH"
echo "Директория для установки: $BIN_PATH"
echo ""

# Проверка наличия ssh-copy-id
if [ -f "$BIN_PATH/ssh-copy-id" ]; then
    echo "ssh-copy-id уже установлен в $BIN_PATH"
    read -p "Перезаписать? (y/n): " OVERWRITE
    if [ "$OVERWRITE" != "y" ] && [ "$OVERWRITE" != "Y" ]; then
        echo "Установка отменена"
        exit 0
    fi
fi

# Копирование скрипта ssh-copy-id
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SSH_COPY_ID_SOURCE="$SCRIPT_DIR/ssh-copy-id"

if [ ! -f "$SSH_COPY_ID_SOURCE" ]; then
    echo "Ошибка: Файл ssh-copy-id не найден в текущей директории"
    echo "Убедитесь, что файл ssh-copy-id находится рядом с этим скриптом"
    exit 1
fi

echo "Копирование ssh-copy-id..."
cp "$SSH_COPY_ID_SOURCE" "$BIN_PATH/ssh-copy-id"
chmod +x "$BIN_PATH/ssh-copy-id"

echo ""
echo "✓ ssh-copy-id успешно установлен!"
echo ""
echo "Использование:"
echo "  ssh-copy-id user@hostname"
echo ""
echo "Или с указанием ключа:"
echo "  ssh-copy-id -i ~/.ssh/id_rsa.pub user@hostname"
echo ""
