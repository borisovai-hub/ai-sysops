# Инструкция по установке Windows на VPS Contabo

Основано на статье: [Копеечный сервер под Zennoposter. Установка Windows на VPS Contabo](https://zenno.club/discussion/threads/kopeechnyj-server-pod-zennoposter-ustanovka-windows-na-vps-contabo.80744/)

## Подготовка

1. Закажите VPS на [Contabo](https://contabo.com) с предустановленным Linux
2. В панели управления выберите загрузку с **RescueCD (Debian)**
3. Подключитесь по **VNC** к серверу

## Автоматическая установка (рекомендуется)

### Шаг 1: Загрузка скриптов

Скопируйте скрипты на сервер или создайте их вручную:

```bash
# Создайте файлы install-windows.sh и setup-grub.sh
# Сделайте их исполняемыми
chmod +x install-windows.sh setup-grub.sh
```

### Шаг 2: Запуск установки

```bash
sudo su
./install-windows.sh
```

Скрипт проведет вас через все этапы установки.

## Ручная установка (пошагово)

### Шаг 1: Получение прав root

```bash
sudo su
```

### Шаг 2: Установка необходимых пакетов

```bash
apt install gparted filezilla grub2 wimtools gdisk -y
```

При настройке grub:
- Нажмите **Ok**
- Отметьте диск для установки
- Подтвердите
- Выберите **Yes**

### Шаг 3: Разметка диска через gparted

```bash
gparted
```

В gparted:
1. Удалите все существующие разделы
2. Создайте 3 раздела:
   - **Раздел 1**: Большой (80% диска) - **не размеченный** (для Windows)
   - **Раздел 2**: ~10-20 ГБ - **NTFS**
   - **Раздел 3**: ~10-20 ГБ - **NTFS**

### Шаг 4: Настройка загрузочного раздела через gdisk

```bash
gdisk /dev/sda
```

В gdisk выполните команды:
- `r` - recovery/transformation menu
- `g` - convert to GPT format
- `p` - print partition table (проверка)
- `w` - write table to disk
- `Y` - подтверждение

### Шаг 5: Монтирование раздела

```bash
mount /dev/sda1 /mnt
```

### Шаг 6: Создание рабочей директории

```bash
cd ~
mkdir disk
cd disk
```

### Шаг 7: Скачивание Windows ISO

Скачайте Windows ISO (Windows 10/11) одним из способов:

**Вариант 1: Прямая ссылка (если есть)**
```bash
wget -O windows.iso "URL_К_WINDOWS_ISO"
```

**Вариант 2: Через FileZilla**
- Запустите FileZilla на локальной машине
- Подключитесь к серверу по SFTP
- Загрузите Windows ISO на сервер

**Вариант 3: Использовать существующий ISO**
Если ISO уже на сервере, укажите путь к нему.

### Шаг 8: Скачивание драйверов VirtIO

```bash
wget -O virtio.iso "https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"
```

### Шаг 9: Монтирование ISO образов

```bash
mkdir -p /mnt/iso/windows /mnt/iso/virtio
mount -o loop windows.iso /mnt/iso/windows
mount -o loop virtio.iso /mnt/iso/virtio
```

### Шаг 10: Копирование файлов Windows

```bash
cp -r /mnt/iso/windows/* /mnt/
```

### Шаг 11: Копирование драйверов VirtIO

```bash
mkdir -p /mnt/virtio
cp -r /mnt/iso/virtio/* /mnt/virtio/
```

### Шаг 12: Установка GRUB

```bash
grub-install --target=i386-pc --boot-directory=/mnt/boot /dev/sda
```

### Шаг 13: Создание конфигурации GRUB

```bash
mkdir -p /mnt/boot/grub
```

Создайте файл `/mnt/boot/grub/grub.cfg`:

```bash
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

### Шаг 14: Перезагрузка

```bash
reboot
```

**ВАЖНО**: После перезагрузки в панели Contabo переключите загрузку обратно с RescueCD на обычный режим!

### Шаг 15: Завершение установки Windows

1. Подключитесь по **VNC** к серверу
2. Должен запуститься установщик Windows
3. При установке Windows, когда потребуется выбрать диск:
   - Нажмите **"Загрузить драйвер"**
   - Укажите путь к драйверам: `D:\virtio\` (или соответствующий диск)
   - Выберите драйвер для **сети (Ethernet Controller)**
   - Остальные драйверы можно установить после установки Windows

4. Завершите установку Windows

### Шаг 16: Установка остальных драйверов VirtIO

После установки Windows:

1. Откройте **Диспетчер устройств**
2. Найдите устройства с желтым восклицательным знаком
3. Обновите драйверы, указав путь к папке `virtio`
4. Или установите драйверы из папки `virtio` вручную

## Важные замечания

- ⚠️ **Все данные на диске будут удалены!** Сделайте резервную копию перед началом
- ⚠️ Убедитесь, что используете **RescueCD (Debian)** в панели управления
- ⚠️ После перезагрузки **переключите загрузку обратно** с RescueCD
- ⚠️ Драйверы VirtIO **обязательны** для работы Windows на KVM-виртуализации
- ⚠️ При копировании команд из браузера проверяйте на наличие лишних пробелов

## Решение проблем

### Проблема: Не запускается установка Windows после перезагрузки

- Проверьте, что переключили загрузку с RescueCD обратно
- Убедитесь, что GRUB установлен правильно
- Проверьте конфигурацию `/mnt/boot/grub/grub.cfg`

### Проблема: Не найдены драйверы VirtIO при установке Windows

- Убедитесь, что скопировали папку `virtio` на диск
- Проверьте путь к драйверам (обычно `D:\virtio\` или `E:\virtio\`)
- Выберите опцию "Искать во вложенных папках" при установке драйвера

### Проблема: Windows не видит сетевой адаптер

- Установите драйвер сетевого адаптера из папки `virtio`
- Путь: `virtio\NetKVM\w10\amd64\` (для Windows 10 x64)

## Полезные ссылки

- [Официальный сайт Contabo](https://contabo.com)
- [Драйверы VirtIO](https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/)
- [Оригинальная статья на форуме](https://zenno.club/discussion/threads/kopeechnyj-server-pod-zennoposter-ustanovka-windows-na-vps-contabo.80744/)
