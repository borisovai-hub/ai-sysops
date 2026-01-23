# Быстрая шпаргалка по установке Windows на VPS Contabo

## Подготовка

```bash
# 1. Переключите загрузку на RescueCD в панели Contabo
# 2. Подключитесь по VNC
# 3. Получите права root
sudo su
```

## Основные команды

### Установка пакетов
```bash
apt update
apt install -y gparted filezilla grub2 wimtools gdisk
```

### Разметка диска (интерактивно)
```bash
# 1. Через gparted
gparted
# Удалите все разделы, создайте 3 новых:
# - Раздел 1: большой, не размеченный (для Windows)
# - Раздел 2: ~10-20 ГБ, NTFS
# - Раздел 3: ~10-20 ГБ, NTFS

# 2. Конвертация в GPT через gdisk
gdisk /dev/sda
# Команды: r → g → p → w → Y
```

### Монтирование и подготовка
```bash
mount /dev/sda1 /mnt
cd ~
mkdir disk
cd disk
```

### Скачивание файлов
```bash
# Драйверы VirtIO
wget -O virtio.iso "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"

# Windows ISO (скачайте отдельно или через wget если есть ссылка)
# wget -O windows.iso "URL_К_WINDOWS_ISO"
```

### Монтирование ISO
```bash
mkdir -p /mnt/iso/windows /mnt/iso/virtio
mount -o loop windows.iso /mnt/iso/windows
mount -o loop virtio.iso /mnt/iso/virtio
```

### Копирование файлов
```bash
cp -r /mnt/iso/windows/* /mnt/
mkdir -p /mnt/virtio
cp -r /mnt/iso/virtio/* /mnt/virtio/
```

### Настройка GRUB
```bash
grub-install --target=i386-pc --boot-directory=/mnt/boot /dev/sda
mkdir -p /mnt/boot/grub

# Для GPT:
cat > /mnt/boot/grub/grub.cfg << 'EOF'
set timeout=10
set default=0

menuentry "Windows 10/11" {
    insmod part_gpt
    insmod ntfs
    set root='hd0,gpt1'
    chainloader +1
    boot
}
EOF

# Для MBR:
cat > /mnt/boot/grub/grub.cfg << 'EOF'
set timeout=10
set default=0

menuentry "Windows 10/11" {
    insmod part_msdos
    insmod ntfs
    set root='hd0,msdos1'
    chainloader +1
    boot
}
EOF
```

### Перезагрузка
```bash
reboot
```

**ВАЖНО**: После перезагрузки в панели Contabo переключите загрузку обратно с RescueCD!

## Использование автоматических скриптов

```bash
# 1. Скачивание драйверов
./download-windows-iso.sh

# 2. Основная установка
sudo su
./install-windows.sh

# 3. Настройка GRUB
./setup-grub.sh

# 4. Перезагрузка
reboot
```

## Полезные команды для диагностики

```bash
# Просмотр дисков
lsblk

# Просмотр смонтированных разделов
df -h

# Проверка типа таблицы разделов
parted /dev/sda print

# Просмотр разделов
fdisk -l /dev/sda
```

## После установки Windows

1. Подключитесь по VNC
2. При установке Windows нажмите "Загрузить драйвер"
3. Укажите путь: `D:\virtio\` (или соответствующий диск)
4. Выберите драйвер для сетевого адаптера (Ethernet Controller)
5. Завершите установку Windows
6. Установите остальные драйверы из папки `virtio`
