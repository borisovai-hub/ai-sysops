# BorisovAI Admin

Автоматизированная система для развертывания и управления сервисами (GitLab, Traefik, n8n, Mailu) на одной машине.

## Быстрый старт

**[README_SINGLE_MACHINE.md](README_SINGLE_MACHINE.md)** - Полная инструкция по установке

## Документация

### Установка и настройка

- **[docs/setup/INSTALLATION.md](docs/setup/INSTALLATION.md)** - Инструкция по установке (Proxmox)
- **[docs/setup/PROXMOX_SETUP.md](docs/setup/PROXMOX_SETUP.md)** - Настройка Proxmox VE 7
- **[docs/setup/QUICK_START_GUIDE.md](docs/setup/QUICK_START_GUIDE.md)** - Быстрое руководство
- **[docs/setup/REMOTE_WORK.md](docs/setup/REMOTE_WORK.md)** - Работа с сервером через Remote-SSH

### Инструкции для агентов

- **[docs/agents/AGENT_ORCHESTRATOR.md](docs/agents/AGENT_ORCHESTRATOR.md)** - Регистрация проектов (One-Click Publish)
- **[docs/agents/AGENT_GITOPS.md](docs/agents/AGENT_GITOPS.md)** - CI/CD деплой borisovai-admin
- **[docs/agents/AGENT_SERVICES.md](docs/agents/AGENT_SERVICES.md)** - Управление сервисами и DNS
- **[docs/agents/AGENT_API_GUIDE.md](docs/agents/AGENT_API_GUIDE.md)** - Публикация контента через Strapi API
- **[docs/agents/AGENT_PUBLISH_SETUP.md](docs/agents/AGENT_PUBLISH_SETUP.md)** - Настройка деплоя borisovai-site

### DNS

- **[docs/dns/DNS_MAIL_SETUP.md](docs/dns/DNS_MAIL_SETUP.md)** - DNS для Mailu (MX, SPF, DKIM, DMARC)
- **[docs/dns/DNS_SITE_SETUP.md](docs/dns/DNS_SITE_SETUP.md)** - DNS для сайта (NS, A-записи, Cloudflare)
- **[docs/dns/DNS_TROUBLESHOOTING.md](docs/dns/DNS_TROUBLESHOOTING.md)** - Диагностика DNS

### Прочее

- **[docs/troubleshooting/POWERSHELL_SETUP.md](docs/troubleshooting/POWERSHELL_SETUP.md)** - Настройка PowerShell
- **[docs/troubleshooting/POWERSHELL_ENCODING.md](docs/troubleshooting/POWERSHELL_ENCODING.md)** - Проблемы с кодировкой PowerShell
- **[docs/setup/INSTALL_SSH_COPY_ID.md](docs/setup/INSTALL_SSH_COPY_ID.md)** - Установка ssh-copy-id
- **[docs/UPLOAD_EXAMPLES.md](docs/UPLOAD_EXAMPLES.md)** - Примеры скриптов загрузки
- **[docs/troubleshooting/VSCODE_FIX.md](docs/troubleshooting/VSCODE_FIX.md)** - Исправление ошибки ICU в VS Code
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
