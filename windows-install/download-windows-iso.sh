#!/bin/bash
# Скрипт для скачивания Windows ISO и драйверов VirtIO

set -e

echo "=== Скачивание файлов для установки Windows ==="
echo ""

# Создание директории
mkdir -p ~/windows-install
cd ~/windows-install

# Скачивание драйверов VirtIO
echo "[1/2] Скачивание драйверов VirtIO..."
VIRTIO_URL="https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"
if [ -f "virtio-win.iso" ]; then
    echo "Файл virtio-win.iso уже существует, пропускаем..."
else
    wget -O virtio-win.iso "$VIRTIO_URL" || {
        echo "Ошибка при скачивании VirtIO. Попробуйте скачать вручную:"
        echo "$VIRTIO_URL"
        exit 1
    }
    echo "Драйверы VirtIO скачаны успешно!"
fi

# Инструкции по скачиванию Windows ISO
echo ""
echo "[2/2] Скачивание Windows ISO..."
echo ""
echo "Windows ISO нужно скачать вручную одним из способов:"
echo ""
echo "Вариант 1: Официальный сайт Microsoft"
echo "  https://www.microsoft.com/software-download/windows10"
echo "  или"
echo "  https://www.microsoft.com/software-download/windows11"
echo ""
echo "Вариант 2: Использовать существующий ISO файл"
echo "  Скопируйте ISO на сервер через SFTP/FileZilla"
echo ""
echo "Вариант 3: Скачать через wget (если есть прямая ссылка)"
echo "  wget -O windows.iso 'URL_К_ISO_ФАЙЛУ'"
echo ""
echo "После скачивания Windows ISO, поместите его в текущую директорию:"
echo "  $(pwd)"
echo ""
echo "Или укажите путь к ISO при запуске install-windows.sh"
echo ""
echo "Текущие файлы в директории:"
ls -lh
