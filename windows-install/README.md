# Установка Windows на VPS Contabo

Скрипты для автоматической установки Windows на VPS Contabo с использованием RescueCD.

## Описание

Этот набор скриптов позволяет установить Windows на VPS Contabo, который изначально работает под Linux. Процесс установки выполняется через RescueCD (Debian).

## Быстрый старт

### 1. Загрузка скриптов на сервер

**Windows (BAT файл):**
```cmd
upload-to-server.bat
```

**Windows (PowerShell):**
```powershell
.\upload-to-server.ps1
```

**Linux/Mac:**
```bash
chmod +x upload-to-server.sh
./upload-to-server.sh
```

### 2. На сервере

```bash
cd ~/windows-install
chmod +x *.sh
sudo su
./install-windows.sh
```

## Файлы

- `install-windows.sh` - Основной скрипт установки Windows
- `setup-grub.sh` - Настройка GRUB для загрузки Windows
- `download-windows-iso.sh` - Скачивание драйверов VirtIO
- `upload-to-server.*` - Скрипты для загрузки файлов на сервер

## Документация

- **[INSTRUCTION.md](INSTRUCTION.md)** - Подробная пошаговая инструкция
- **[QUICK_START.md](QUICK_START.md)** - Быстрая шпаргалка с командами

## Требования

- VPS Contabo с KVM-виртуализацией
- Доступ к панели управления Contabo
- Доступ по VNC
- Windows ISO (Windows 10/11)

## Важные замечания

⚠️ **Все данные на диске будут удалены!** Сделайте резервную копию перед началом.

⚠️ Убедитесь, что используете **RescueCD (Debian)** в панели управления.

⚠️ После перезагрузки **переключите загрузку обратно** с RescueCD.

## Источники

- [Оригинальная статья на форуме ZennoClub](https://zenno.club/discussion/threads/kopeechnyj-server-pod-zennoposter-ustanovka-windows-na-vps-contabo.80744/)
- [Официальный сайт Contabo](https://contabo.com)
- [Драйверы VirtIO](https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/)
