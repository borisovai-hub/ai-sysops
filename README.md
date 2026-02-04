# BorisovAI Admin

Автоматизированная система для развертывания и управления сервисами (GitLab, Traefik, n8n, Mailu) на одной машине.

## Быстрый старт

**[README_SINGLE_MACHINE.md](README_SINGLE_MACHINE.md)** - Полная инструкция по установке

## Документация

### Установка и настройка

- **[docs/INSTALLATION.md](docs/INSTALLATION.md)** - Инструкция по установке (Proxmox)
- **[docs/PROXMOX_SETUP.md](docs/PROXMOX_SETUP.md)** - Настройка Proxmox VE 7
- **[docs/QUICK_START_GUIDE.md](docs/QUICK_START_GUIDE.md)** - Быстрое руководство
- **[docs/REMOTE_WORK.md](docs/REMOTE_WORK.md)** - Работа с сервером через Remote-SSH

### Инструкции для агентов

- **[docs/AGENT_ORCHESTRATOR.md](docs/AGENT_ORCHESTRATOR.md)** - Регистрация проектов (One-Click Publish)
- **[docs/AGENT_GITOPS.md](docs/AGENT_GITOPS.md)** - CI/CD деплой borisovai-admin
- **[docs/AGENT_SERVICES.md](docs/AGENT_SERVICES.md)** - Управление сервисами и DNS
- **[docs/AGENT_API_GUIDE.md](docs/AGENT_API_GUIDE.md)** - Публикация контента через Strapi API
- **[docs/AGENT_PUBLISH_SETUP.md](docs/AGENT_PUBLISH_SETUP.md)** - Настройка деплоя borisovai-site

### Прочее

- **[docs/POWERSHELL_SETUP.md](docs/POWERSHELL_SETUP.md)** - Настройка PowerShell
- **[docs/POWERSHELL_ENCODING.md](docs/POWERSHELL_ENCODING.md)** - Проблемы с кодировкой PowerShell
- **[docs/INSTALL_SSH_COPY_ID.md](docs/INSTALL_SSH_COPY_ID.md)** - Установка ssh-copy-id
- **[docs/UPLOAD_EXAMPLES.md](docs/UPLOAD_EXAMPLES.md)** - Примеры скриптов загрузки
- **[docs/VSCODE_FIX.md](docs/VSCODE_FIX.md)** - Исправление ошибки ICU в VS Code
- **[docs/CHANGELOG_SINGLE_MACHINE.md](docs/CHANGELOG_SINGLE_MACHINE.md)** - История изменений

## Структура проекта

```
borisovai-admin/
├── .gitlab-ci.yml            # CI/CD pipeline (validate → deploy → verify)
├── management-ui/            # Веб-интерфейс управления (Express.js)
│   ├── server.js             # API сервер
│   ├── public/               # UI страницы (index, dns, projects)
│   └── templates/            # CI-шаблоны для целевых проектов
├── scripts/
│   ├── single-machine/       # Скрипты установки на сервер
│   ├── dns-api/              # DNS API сервер (dnsmasq)
│   ├── ci/                   # CI/CD скрипты деплоя
│   └── upload-single-machine.*  # Ручная загрузка на сервер
├── config/
│   └── single-machine/       # Шаблоны конфигов (GitOps)
└── docs/                     # Документация и инструкции
```

## Лицензия

MIT
