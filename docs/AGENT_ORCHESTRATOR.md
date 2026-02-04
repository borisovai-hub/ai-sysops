# Инструкция для агента: регистрация проектов (One-Click Publish)

Руководство для агента по регистрации новых проектов через Management UI API. Оркестратор автоматически настраивает DNS, Traefik, CI/CD и Strapi в зависимости от типа проекта.

## Подключение

```
Base URL:  https://admin.borisovai.ru  (или http://127.0.0.1:3000 с сервера)
Auth:      Cookie-based session (POST /login)
```

## Аутентификация

```bash
# Получить сессию
curl -c cookies.txt -X POST http://127.0.0.1:3000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "password=<пароль из /etc/management-ui/auth.json>"

# Все дальнейшие запросы с -b cookies.txt
```

## Быстрый старт: зарегистрировать проект

```bash
curl -b cookies.txt -X POST http://127.0.0.1:3000/api/publish/projects \
  -H "Content-Type: application/json" \
  -d '{
    "gitlabProjectId": 5,
    "slug": "my-app",
    "projectType": "deploy",
    "appType": "frontend",
    "title": "My Application",
    "description": "Описание проекта"
  }'
```

## Типы проектов (`projectType`)

### deploy — веб-приложение с деплоем

Полный цикл: DNS → Traefik → CI/CD → директории → CI переменные.

| Параметр | Обязательный | Описание |
|----------|-------------|----------|
| `gitlabProjectId` | да | ID проекта в GitLab |
| `slug` | да | Уникальный идентификатор (латиница, дефисы) |
| `projectType` | да | `"deploy"` |
| `appType` | нет | `"frontend"` (по умолчанию), `"backend"`, `"fullstack"` |
| `domain` | нет | Домен (по умолчанию: `<slug>.<base_domain>`) |
| `title` | нет | Название (по умолчанию: slug) |
| `description` | нет | Описание |

**Что делает оркестратор:**

1. **DNS** — создаёт A-запись `<slug>` → внешний IP сервера
2. **Traefik** — создаёт конфиг `/etc/traefik/dynamic/<slug>.yml` с роутером и сервисом
3. **Директории** — `mkdir -p /var/www/<slug>`, chown gitlab-runner
4. **CI файлы** — пушит `.gitlab-ci.yml` + `.gitlab/ci/pipeline.yml` в GitLab-репозиторий
5. **CI переменные** — устанавливает `DEPLOY_PATH`, `PM2_APP_NAME` в GitLab
6. **Порт** — автоматически выделяет порт (начиная с `base_port` из config.json)

**Шаблон CI**: зависит от `appType`:
- `frontend` → `frontend.gitlab-ci.yml`
- `backend` → `backend.gitlab-ci.yml`
- `fullstack` → `fullstack.gitlab-ci.yml`

### docs — документация

Strapi + CI/CD для статической документации.

| Параметр | Обязательный | Описание |
|----------|-------------|----------|
| `gitlabProjectId` | да | ID проекта в GitLab |
| `slug` | да | Уникальный идентификатор |
| `projectType` | да | `"docs"` |
| `title` | нет | Название |
| `description` | нет | Описание |

**Что делает:**

1. **Strapi** — создаёт/обновляет запись проекта в Strapi
2. **Директории** — `mkdir -p /var/www/docs/<slug>`
3. **CI файлы** — пушит пайплайн с шаблоном `docs.gitlab-ci.yml`
4. **CI переменные** — `DOCS_DEPLOY_PATH`

### infra — инфраструктурный проект

Только CI/CD (валидация, линтинг), опционально Strapi.

| Параметр | Обязательный | Описание |
|----------|-------------|----------|
| `gitlabProjectId` | да | ID проекта в GitLab |
| `slug` | да | Уникальный идентификатор |
| `projectType` | да | `"infra"` |

**Что делает:**

1. **CI файлы** — пушит пайплайн с шаблоном `validate.gitlab-ci.yml`
2. **Strapi** — создаёт запись (если Strapi настроен)

### product — продукт с загрузками

Strapi + CI/CD + директория загрузок + переменные для Strapi API.

| Параметр | Обязательный | Описание |
|----------|-------------|----------|
| `gitlabProjectId` | да | ID проекта в GitLab |
| `slug` | да | Уникальный идентификатор |
| `projectType` | да | `"product"` |
| `title` | нет | Название |
| `description` | нет | Описание |

**Что делает:**

1. **Strapi** — создаёт/обновляет запись проекта
2. **Директории** — `mkdir -p /var/www/downloads/<slug>`
3. **CI файлы** — пушит пайплайн с шаблоном `product.gitlab-ci.yml`
4. **CI переменные** — `STRAPI_API_URL`, `STRAPI_API_TOKEN` (masked), `PROJECT_SLUG`, `DOWNLOADS_PATH`

## Ответ API

```json
{
  "success": true,
  "project": {
    "slug": "my-app",
    "gitlabProjectId": 5,
    "projectType": "deploy",
    "appType": "frontend",
    "domain": "my-app.borisovai.ru",
    "title": "My Application",
    "description": "",
    "pathWithNamespace": "group/my-app",
    "defaultBranch": "main",
    "createdAt": "2026-02-04T12:00:00.000Z",
    "ports": { "frontend": 4010 },
    "steps": {
      "dns": { "done": true, "detail": "A запись my-app создана" },
      "traefik": { "done": true, "detail": "Конфиг создан" },
      "directories": { "done": true, "detail": "/var/www/my-app" },
      "ci": { "done": true, "detail": "CI файлы загружены" },
      "variables": { "done": true, "detail": "DEPLOY_PATH, PM2_APP_NAME" }
    }
  }
}
```

Каждый шаг (`steps`) содержит `done: true/false`. При ошибке — `error` с описанием. Частичный успех возможен: проект сохраняется в реестр даже если часть шагов не выполнилась.

## Другие endpoints

### Получить список зарегистрированных проектов

```bash
curl -b cookies.txt http://127.0.0.1:3000/api/publish/projects
```

### Получить конфигурацию оркестратора

```bash
curl -b cookies.txt http://127.0.0.1:3000/api/publish/config
```

Ответ: `baseDomain`, `runnerTag`, `gitlabConfigured`, `strapiConfigured`.

### Получить список проектов GitLab

```bash
curl -b cookies.txt http://127.0.0.1:3000/api/gitlab/projects
```

### Удалить проект из реестра

```bash
curl -b cookies.txt -X DELETE http://127.0.0.1:3000/api/publish/projects/my-app
```

> Удаляет только запись из реестра. DNS, Traefik, директории и CI файлы не удаляются автоматически.

### Обновить CI файлы проекта

```bash
curl -b cookies.txt -X PUT http://127.0.0.1:3000/api/publish/projects/my-app/update-ci
```

Перегенерирует и пушит CI файлы из актуального шаблона.

## Предусловия

Перед использованием оркестратора на сервере должны быть настроены:

1. **Management UI** — установлен и запущен (`install-management-ui.sh`)
2. **config.json** — заполнены поля:
   - `gitlab_url` — URL GitLab (например `https://git.borisovai.ru`)
   - `gitlab_token` — Personal Access Token с правами `api`
   - `strapi_url` — URL Strapi API (если нужны docs/product сценарии)
   - `strapi_token` — API токен Strapi
   - `base_port` — начальный порт для выделения (по умолчанию 4010)
   - `runner_tag` — тег GitLab Runner (по умолчанию `deploy-production`)
3. **DNS API** — запущен (для сценария deploy)
4. **Traefik** — установлен с file provider и watch (для сценария deploy)
5. **GitLab Runner** — зарегистрирован с тегом `deploy-production`, shell executor

## CI шаблоны

Шаблоны хранятся в `management-ui/templates/`. Используемые плейсхолдеры:

| Плейсхолдер | Описание |
|-------------|----------|
| `{{SLUG}}` | Идентификатор проекта |
| `{{DOMAIN}}` | Домен проекта |
| `{{PORT}}` | Выделенный порт |
| `{{RUNNER_TAG}}` | Тег runner'а |
| `{{DEFAULT_BRANCH}}` | Основная ветка (main/master) |
| `{{APP_TYPE}}` | Тип приложения (frontend/backend/fullstack) |

Шаблоны пушатся в целевой репозиторий как `.gitlab/ci/pipeline.yml`, а `.gitlab-ci.yml` содержит только `include: local: '.gitlab/ci/pipeline.yml'`.

## Рекомендации

1. **Проверяй slug** — должен быть уникальным, латиница и дефисы
2. **Проверяй steps** — каждый шаг может завершиться ошибкой независимо
3. **deploy** — самый комплексный сценарий, проверяй DNS и Traefik после регистрации
4. **Повторная регистрация** — slug должен быть уникальным, удали старый проект перед повторной
5. **update-ci** — используй для обновления CI после изменения шаблонов
