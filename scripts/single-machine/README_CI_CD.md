# CI/CD настройка для автоматического деплоя

## Обзор

Скрипты для настройки автоматического деплоя проектов через GitLab CI/CD.

## Компоненты

1. **GitLab Runner** - выполняет CI/CD пайплайны
2. **PM2** - управляет Node.js процессами (frontend/backend)
3. **Traefik** - роутинг для frontend и backend
4. **Структура деплоя** - `/var/www/borisovai-site/{frontend,backend}`

## Установка

### Автоматическая установка (рекомендуется)

```bash
sudo ./install-all.sh
# При установке GitLab будет предложено настроить CI/CD
```

### Ручная установка

```bash
# 1. Установка GitLab Runner
sudo ./install-gitlab-runner.sh

# 2. Настройка CI/CD (регистрация runner, создание директорий)
sudo ./setup-cicd.sh

# 3. Настройка Traefik для frontend/backend
sudo ./configure-traefik-deploy.sh <frontend-domain> <backend-domain>
```

## Настройка GitLab

### 1. Получение Registration Token

1. Откройте GitLab: `https://gitlab.dev.borisovai.ru`
2. Перейдите в проект: `tools/borisovai-site`
3. Settings → CI/CD → Runners → Expand
4. Скопируйте Registration Token

### 2. Добавление переменных окружения

Settings → CI/CD → Variables:

- `DEPLOY_PATH` = `/var/www/borisovai-site`

### 3. Добавление SSH ключа gitlab-runner

После выполнения `setup-cicd.sh` будет выведен публичный SSH ключ. Добавьте его:

1. Settings → SSH Keys → Add SSH Key
2. Вставьте публичный ключ из вывода скрипта

## Структура деплоя

```
/var/www/borisovai-site/
├── frontend/
│   ├── .env.local          # Переменные окружения frontend
│   └── [файлы проекта]
└── backend/
    ├── .env                # Переменные окружения backend
    └── [файлы проекта]
```

## Настройка .env файлов

После установки отредактируйте файлы:

```bash
# Frontend
nano /var/www/borisovai-site/frontend/.env.local

# Backend
nano /var/www/borisovai-site/backend/.env
```

Примеры шаблонов находятся в `config/single-machine/cicd/`.

## PM2 управление

```bash
# Просмотр процессов
pm2 list

# Просмотр логов
pm2 logs

# Перезапуск
pm2 restart all

# Остановка
pm2 stop all
```

## Traefik конфигурация

После настройки Traefik создаются конфигурации:

- `/etc/traefik/dynamic/borisovai-frontend.yml` - для frontend
- `/etc/traefik/dynamic/borisovai-backend.yml` - для backend

SSL сертификаты получаются автоматически через Let's Encrypt.

## GitLab CI/CD пример

Пример `.gitlab-ci.yml` для проекта:

```yaml
stages:
  - deploy

deploy_staging:
  stage: deploy
  script:
    - cd /var/www/borisovai-site/frontend
    - git pull origin dev
    - npm install
    - npm run build
    - pm2 restart frontend
  only:
    - dev
  tags:
    - deploy-production

deploy_production:
  stage: deploy
  script:
    - cd /var/www/borisovai-site/frontend
    - git pull origin main
    - npm install
    - npm run build
    - pm2 restart frontend
  when: manual
  only:
    - main
  tags:
    - deploy-production
```

## Проверка

```bash
# Проверка GitLab Runner
gitlab-runner list
gitlab-runner status

# Проверка PM2
pm2 list

# Проверка Traefik
systemctl status traefik
cat /etc/traefik/dynamic/borisovai-frontend.yml
cat /etc/traefik/dynamic/borisovai-backend.yml
```

## Устранение проблем

### GitLab Runner не запускается

```bash
systemctl status gitlab-runner
journalctl -u gitlab-runner -n 50
```

### PM2 процессы не запускаются

```bash
pm2 logs
pm2 describe frontend
pm2 describe backend
```

### Traefik не проксирует запросы

```bash
# Проверка конфигурации
cat /etc/traefik/dynamic/borisovai-frontend.yml
systemctl reload traefik

# Проверка логов
journalctl -u traefik -n 50
```

## Дополнительная информация

- Репозиторий: `git@gitlab.dev.borisovai.ru:tools/borisovai-site.git`
- GitLab URL: `https://gitlab.dev.borisovai.ru`
- Deploy path: `/var/www/borisovai-site`
