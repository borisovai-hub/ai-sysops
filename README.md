# BorisovAI Admin

Автоматизированная система для развертывания и управления сервисами (GitLab, Traefik, n8n) на одной машине или в среде Proxmox.

## Быстрый старт

### Установка на одну машину

Для установки всех сервисов на одной физической машине:

📖 **[README_SINGLE_MACHINE.md](README_SINGLE_MACHINE.md)** - Полная инструкция по установке на одну машину

### Установка на Proxmox

Для установки в виртуальной среде Proxmox:

📖 **[INSTALLATION.md](INSTALLATION.md)** - Инструкция по установке на Proxmox  
📖 **[PROXMOX_SETUP.md](PROXMOX_SETUP.md)** - Настройка Proxmox VE 7  
📖 **[QUICK_START_GUIDE.md](QUICK_START_GUIDE.md)** - Быстрое руководство

## Дополнительные инструкции

- **[POWERSHELL_SETUP.md](POWERSHELL_SETUP.md)** - Настройка PowerShell для запуска скриптов
- **[POWERSHELL_ENCODING.md](POWERSHELL_ENCODING.md)** - Решение проблем с кодировкой в PowerShell
- **[INSTALL_SSH_COPY_ID.md](INSTALL_SSH_COPY_ID.md)** - Установка ssh-copy-id для Git Bash
- **[UPLOAD_EXAMPLES.md](UPLOAD_EXAMPLES.md)** - Примеры использования скриптов загрузки

## Дополнительные инструменты

- **[windows-install/](windows-install/)** - Скрипты для установки Windows на VPS Contabo

## История изменений

- **[CHANGELOG_SINGLE_MACHINE.md](CHANGELOG_SINGLE_MACHINE.md)** - История изменений скриптов для установки на одну машину

## Структура проекта

```
borisovai-admin/
├── scripts/              # Скрипты установки
│   ├── single-machine/   # Установка на одну машину
│   ├── vm1-traefik/      # Скрипты для Traefik VM
│   └── vm2-gitlab/       # Скрипты для GitLab VM
├── config/               # Конфигурационные файлы
├── management-ui/        # Веб-интерфейс управления
└── windows-install/      # Скрипты для установки Windows
```

## Лицензия

MIT
