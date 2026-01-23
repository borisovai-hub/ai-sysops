#!/bin/bash
# Скрипт для настройки GRUB для загрузки Windows

set -e

if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo su)"
    exit 1
fi

echo "=== Настройка GRUB для загрузки Windows ==="
echo ""

# Автоматическое определение диска или запрос у пользователя
if mountpoint -q /mnt; then
    # Если /mnt уже смонтирован, определяем диск автоматически
    MOUNTED_DISK=$(df /mnt | tail -1 | awk '{print $1}' | sed 's/[0-9]*$//')
    echo "Обнаружен смонтированный диск: $MOUNTED_DISK"
    DISK=$MOUNTED_DISK
else
    echo "Доступные диски:"
    lsblk
    echo ""
    read -p "Введите имя диска (например, sda): " DISK_NAME
    DISK="/dev/${DISK_NAME}"
    
    # Монтирование раздела
    if [ ! -b ${DISK}1 ]; then
        echo "Ошибка: Раздел ${DISK}1 не найден!"
        exit 1
    fi
    mount ${DISK}1 /mnt || {
        echo "Ошибка: Не удалось смонтировать раздел ${DISK}1"
        exit 1
    }
fi

# Установка GRUB
echo "Установка GRUB на диск $DISK..."
grub-install --target=i386-pc --boot-directory=/mnt/boot $DISK

# Создание конфигурации GRUB
echo "Создание конфигурации GRUB..."
mkdir -p /mnt/boot/grub

# Определение типа таблицы разделов (GPT или MBR)
PART_TABLE_TYPE=$(parted $DISK print | grep "Partition Table" | awk '{print $3}')

if [ "$PART_TABLE_TYPE" = "gpt" ]; then
    echo "Обнаружена GPT таблица разделов"
    GRUB_CONFIG='set timeout=10
set default=0

menuentry "Windows 10/11" {
    insmod part_gpt
    insmod ntfs
    set root='\''hd0,gpt1'\''
    chainloader +1
    boot
}'
else
    echo "Обнаружена MBR таблица разделов"
    GRUB_CONFIG='set timeout=10
set default=0

menuentry "Windows 10/11" {
    insmod part_msdos
    insmod ntfs
    set root='\''hd0,msdos1'\''
    chainloader +1
    boot
}'
fi

cat > /mnt/boot/grub/grub.cfg << EOF
$GRUB_CONFIG
EOF

echo ""
echo "GRUB настроен успешно!"
echo "Теперь можно перезагрузить сервер:"
echo "  reboot"
echo ""
echo "После перезагрузки подключитесь по VNC и завершите установку Windows"
