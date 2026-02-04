# Инструкция для агента: настройка для публикации

Пошаговая инструкция для агента (скрипта, CI, бота) по подготовке проекта к публикации (деплой на staging/production). Публикация контента через API описана в [AGENT_API_GUIDE.md](AGENT_API_GUIDE.md).

---

## Содержание

1. [Предусловия](#1-предусловия)
2. [Переменные окружения для деплоя](#2-переменные-окружения-для-деплоя)
3. [Сборка (локально или в CI)](#3-сборка-локально-или-в-ci)
4. [Публикация (деплой)](#4-публикация-деплой)
5. [Первый запуск на сервере (однократно)](#5-первый-запуск-на-сервере-однократно)
6. [Чек-лист для агента перед публикацией](#6-чек-лист-для-агента-перед-публикацией)

---

## 1. Предусловия

- Репозиторий клонирован, ветки `dev` и `master` существуют.
- На сервере установлены: Node.js 20+, PM2, Nginx, GitLab Runner (см. [README.md](../README.md) — Production Deployment).
- В GitLab настроены CI/CD Variables (тип File): `FRONTEND_ENV`, `BACKEND_ENV`; Variable: `DEPLOY_PATH`.

---

## 2. Переменные окружения для деплоя

**GitLab → Settings → CI/CD → Variables** (Protected = Yes для production):

| Имя | Тип | Описание |
|-----|-----|----------|
| `DEPLOY_PATH` | Variable | Путь на сервере, например `/var/www/borisovai-site` |
| `FRONTEND_ENV` | File | Полное содержимое файла `.env.local` для frontend |
| `BACKEND_ENV` | File | Полное содержимое файла `.env` для backend |

**Минимальное содержимое FRONTEND_ENV (production):**

```env
STRAPI_URL=https://api.borisovai.tech
STRAPI_API_TOKEN=<токен из Strapi Admin>
REVALIDATION_SECRET=<openssl rand -hex 32>
DRAFT_SECRET=<openssl rand -hex 32>
NEXT_PUBLIC_SITE_URL=https://borisovai.tech
```

**Минимальное содержимое BACKEND_ENV (production):**

```env
HOST=0.0.0.0
PORT=4002
APP_KEYS=<key1_base64>,<key2_base64>
API_TOKEN_SALT=<openssl rand -base64 32>
ADMIN_JWT_SECRET=<openssl rand -base64 32>
TRANSFER_TOKEN_SALT=<openssl rand -base64 32>
JWT_SECRET=<openssl rand -base64 32>
PUBLIC_URL=https://api.borisovai.tech
ADMIN_URL=https://api.borisovai.tech/admin
```

Для автоматической ревалидации фронта после публикации контента добавьте в BACKEND_ENV: `PUBLISHER_SITE_URL=https://borisovai.tech` и `REVALIDATION_SECRET=<тот же что во FRONTEND_ENV>`.

---

## 3. Сборка (локально или в CI)

Команды выполняются из корня репозитория:

```bash
# Frontend
cd frontend
npm ci
npm run build

# Backend
cd ../backend
npm ci
npm run build
```

В GitLab CI этап `build` уже выполняет эти шаги; артефакты передаются в этап `deploy`.

---

## 4. Публикация (деплой)

| Окружение | Ветка | Действие |
|-----------|--------|----------|
| Staging | `dev` | Push в `dev` → автоматический деплой (job `deploy:staging`) |
| Production | `master` | Push в `master` → в GitLab: CI/CD → Pipelines → для pipeline нажать ▶️ у job `deploy:production` (ручной запуск) |

Runner должен быть с тегами `deploy-staging` или `deploy-production` и иметь доступ к `DEPLOY_PATH`, PM2 и переменным File (см. README).

---

## 5. Первый запуск на сервере (однократно)

Если деплой выполняется впервые на новом сервере:

1. Создать директории: `mkdir -p $DEPLOY_PATH/frontend $DEPLOY_PATH/backend $DEPLOY_PATH/uploads`
2. Настроить права: `chown -R gitlab-runner:www-data $DEPLOY_PATH`
3. Убедиться, что PM2 настроен для пользователя runner: `pm2 startup` и выполнить выведенную команду
4. После первого успешного деплоя: `pm2 save`

Подробнее: [README.md — Настройка сервера, GitLab CI/CD](../README.md).

---

## 6. Чек-лист для агента перед публикацией

- [ ] Переменные `DEPLOY_PATH`, `FRONTEND_ENV`, `BACKEND_ENV` заданы в GitLab CI/CD
- [ ] В `FRONTEND_ENV`: `STRAPI_URL`, `STRAPI_API_TOKEN`, `REVALIDATION_SECRET`, `DRAFT_SECRET`, `NEXT_PUBLIC_SITE_URL` заполнены
- [ ] В `BACKEND_ENV`: все ключи (APP_KEYS, API_TOKEN_SALT, ADMIN_JWT_SECRET, TRANSFER_TOKEN_SALT, JWT_SECRET), `PUBLIC_URL`, `ADMIN_URL` заполнены
- [ ] Strapi API токен создан в Admin и имеет нужные права (в т.ч. для v1 plugin при публикации заметок)
- [ ] Для staging: изменения в ветке `dev`, push запускает pipeline
- [ ] Для production: изменения в `master`, деплой запускается вручную из GitLab
- [ ] При проблемах деплоя: [DEPLOYMENT_ISSUES.md](DEPLOYMENT_ISSUES.md)
