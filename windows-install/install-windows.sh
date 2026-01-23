#!/bin/bash
# Скрипт для установки Windows на VPS Contabo с Linux
# Основан на инструкции: https://zenno.club/discussion/threads/kopeechnyj-server-pod-zennoposter-ustanovka-windows-na-vps-contabo.80744/

set -e

echo "=== Установка Windows на VPS Contabo ==="
echo "ВНИМАНИЕ: Этот скрипт должен выполняться из RescueCD (Debian)"
echo ""

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo su)"
    exit 1
fi

# Шаг 1: Установка необходимых пакетов
echo "[1/10] Установка необходимых пакетов..."
apt update
apt install -y gparted filezilla grub2 wimtools gdisk

# Шаг 2: Информация о дисках
echo ""
echo "[2/10] Информация о дисках:"
lsblk
echo ""
read -p "Введите имя диска для установки (например, sda): " DISK
DISK="/dev/${DISK}"

# Шаг 3: Предупреждение о форматировании
echo ""
echo "ВНИМАНИЕ: Все данные на диске $DISK будут удалены!"
read -p "Продолжить? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
    echo "Установка отменена"
    exit 1
fi

# Шаг 4: Разметка диска через gparted
echo ""
echo "[3/10] Разметка диска через gparted..."
echo "ВНИМАНИЕ: Следующие шаги требуют интерактивного ввода в gparted:"
echo "  1. Удалите все существующие разделы"
echo "  2. Создайте раздел 1: большой (80% диска) - НЕ РАЗМЕЧЕННЫЙ (для Windows)"
echo "  3. Создайте раздел 2: ~10-20 ГБ - форматируйте как NTFS"
echo "  4. Создайте раздел 3: ~10-20 ГБ - форматируйте как NTFS"
echo "  5. Закройте gparted после завершения"
echo ""
read -p "Нажмите Enter для запуска gparted..."
gparted

# Шаг 4.5: Конвертация в GPT и настройка загрузочного раздела через gdisk
echo ""
echo "[3.5/10] Конвертация в GPT и настройка загрузочного раздела через gdisk..."
echo "ВНИМАНИЕ: Выполните следующие команды в gdisk:"
echo "  - r (recovery/transformation menu)"
echo "  - g (convert to GPT format)"
echo "  - p (print - проверка разделов)"
echo "  - w (write table to disk)"
echo "  - Y (подтверждение)"
echo ""
read -p "Нажмите Enter для запуска gdisk..."
gdisk $DISK

# Шаг 5: Проверка разделов и создание файловых систем (если нужно)
echo ""
echo "[4/10] Проверка разделов..."
lsblk
echo ""
echo "Если разделы 2 и 3 не отформатированы как NTFS, они будут отформатированы сейчас."
read -p "Продолжить? (yes/no): " FORMAT_CONFIRM
if [ "$FORMAT_CONFIRM" = "yes" ]; then
    if [ -b ${DISK}2 ]; then
        echo "Форматирование раздела 2..."
        mkfs.ntfs -f ${DISK}2 || echo "Предупреждение: не удалось отформатировать раздел 2"
    fi
    if [ -b ${DISK}3 ]; then
        echo "Форматирование раздела 3..."
        mkfs.ntfs -f ${DISK}3 || echo "Предупреждение: не удалось отформатировать раздел 3"
    fi
fi

# Шаг 6: Монтирование раздела
echo ""
echo "[5/10] Монтирование раздела..."
mkdir -p /mnt
if mountpoint -q /mnt; then
    echo "Раздел уже смонтирован, отмонтируем..."
    umount /mnt
fi
if [ ! -b ${DISK}1 ]; then
    echo "Ошибка: Раздел ${DISK}1 не найден!"
    echo "Проверьте разметку диска."
    exit 1
fi
mount ${DISK}1 /mnt || {
    echo "Ошибка: Не удалось смонтировать раздел ${DISK}1"
    echo "Проверьте, что раздел создан правильно."
    exit 1
}

# Шаг 7: Создание директорий
echo ""
echo "[6/10] Создание рабочих директорий..."
cd ~
mkdir -p disk
cd disk

# Шаг 8: Скачивание Windows ISO
echo ""
echo "[7/10] Скачивание Windows ISO..."
echo "Введите ссылку на Windows ISO или путь к файлу:"
read -p "ISO URL или путь: " ISO_URL

if [[ $ISO_URL == http* ]]; then
    echo "Скачивание ISO..."
    wget -O windows.iso "$ISO_URL"
    ISO_FILE="windows.iso"
else
    ISO_FILE="$ISO_URL"
fi

if [ ! -f "$ISO_FILE" ]; then
    echo "Ошибка: Файл ISO не найден: $ISO_FILE"
    exit 1
fi

# Шаг 9: Скачивание драйверов VirtIO
echo ""
echo "[8/10] Скачивание драйверов VirtIO..."
VIRTIO_URL="https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"
wget -O virtio.iso "$VIRTIO_URL"

# Шаг 10: Монтирование ISO
echo ""
echo "[9/10] Монтирование ISO образов..."
mkdir -p /mnt/iso/windows /mnt/iso/virtio
mount -o loop "$ISO_FILE" /mnt/iso/windows || {
    echo "Ошибка: Не удалось смонтировать Windows ISO"
    exit 1
}
mount -o loop virtio.iso /mnt/iso/virtio || {
    echo "Ошибка: Не удалось смонтировать VirtIO ISO"
    exit 1
}

# Шаг 11: Копирование файлов Windows
echo ""
echo "[10/10] Копирование файлов Windows на диск..."
echo "Это может занять некоторое время..."

# Копирование основных файлов Windows
echo "Копирование файлов Windows..."
if [ -d /mnt/iso/windows ]; then
    cp -r /mnt/iso/windows/* /mnt/ || {
        echo "Ошибка: Не удалось скопировать файлы Windows"
        exit 1
    }
else
    echo "Ошибка: Директория /mnt/iso/windows не найдена"
    exit 1
fi

# Копирование драйверов VirtIO
echo "Копирование драйверов VirtIO..."
mkdir -p /mnt/virtio
if [ -d /mnt/iso/virtio ]; then
    cp -r /mnt/iso/virtio/* /mnt/virtio/ || {
        echo "Ошибка: Не удалось скопировать драйверы VirtIO"
        exit 1
    }
else
    echo "Ошибка: Директория /mnt/iso/virtio не найдена"
    exit 1
fi

echo ""
echo "=== Подготовка завершена ==="
echo ""
echo "Следующие шаги:"
echo "1. Настройте GRUB для загрузки Windows:"
echo "   ./setup-grub.sh"
echo ""
echo "2. Перезагрузите сервер:"
echo "   reboot"
echo ""
echo "3. ВАЖНО: После перезагрузки в панели Contabo переключите"
echo "   загрузку обратно с RescueCD на обычный режим!"
echo ""
echo "4. Подключитесь по VNC и завершите установку Windows"
echo "   При установке укажите драйверы из папки virtio"
echo ""
