# Инструкция для агента: регистрация проектов (One-Click Publish)

Руководство для агента по регистрации новых проектов через Management UI API. Оркестратор автоматически настраивает DNS, Traefik, CI/CD и Strapi в зависимости от типа проекта.

## Подключение

```
Base URL:  https://admin.borisovai.ru  или  https://admin.borisovai.tech  (или http://127.0.0.1:3000 с сервера)
Auth:      Bearer-токен (рекомендуется) или Cookie-сессия
```

**Мульти-домен**: если домен не указан явно, оркестратор генерирует домены для всех `base_domains` из `/etc/install-config.json`. Например, для slug `my-app` создаются `my-app.borisovai.ru` и `my-app.borisovai.tech`. Traefik и DNS настраиваются для всех доменов автоматически.

## Аутентификация

### Bearer-токен (рекомендуется для агентов)

Токены создаются администратором в UI (страница "Токены") или через API `POST /api/auth/tokens`.

```bash
# Все запросы с заголовком Authorization
curl -H "Authorization: Bearer <токен>" http://127.0.0.1:3000/api/publish/projects
```

### Cookie-сессия (альтернативный способ)

```bash
# Получить сессию
curl -c cookies.txt -X POST http://127.0.0.1:3000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "password=<пароль из /etc/management-ui/auth.json>"

# Все дальнейшие запросы с -b cookies.txt
```

## Быстрый старт: зарегистрировать проект

```bash
curl -H "Authorization: Bearer <токен>" -X POST http://127.0.0.1:3000/api/publish/projects \
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
    "domain": "my-app.borisovai.ru,my-app.borisovai.tech",
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

Ответ: `baseDomain`, `baseDomains` (массив), `runnerTag`, `gitlabConfigured`, `strapiConfigured`.

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
   - `gitlab_url` — URL GitLab (например `https://gitlab.dev.borisovai.ru`)
   - `gitlab_token` — Personal Access Token с правами `api`
   - `strapi_url` — URL Strapi API (если нужны docs/product сценарии)
   - `strapi_token` — API токен Strapi
   - `base_port` — начальный порт для выделения (по умолчанию 4010)
   - `runner_tag` — тег GitLab Runner (по умолчанию `deploy-production`)
3. **DNS API** — запущен (для сценария deploy)
4. **Traefik** — установлен с file provider и watch (для сценария deploy)
5. **GitLab Runner** — зарегистрирован с тегом `deploy-production`, shell executor

## CI шаблоны

Шаблоны хранятся в `management-ui/templates/`. Плейсхолдеры, используемые в шаблонах:

| Плейсхолдер | Описание |
|-------------|----------|
| `{{RUNNER_TAG}}` | Тег runner'а |
| `{{DEFAULT_BRANCH}}` | Основная ветка (main/master) |

> Остальные параметры (порт, домен, путь деплоя) передаются через CI-переменные GitLab, а не через плейсхолдеры шаблонов.

Шаблоны пушатся в целевой репозиторий как `.gitlab/ci/pipeline.yml`, а `.gitlab-ci.yml` содержит только `include: local: '.gitlab/ci/pipeline.yml'`.

## Рекомендации

1. **Проверяй slug** — должен быть уникальным, латиница и дефисы
2. **Проверяй steps** — каждый шаг может завершиться ошибкой независимо
3. **deploy** — самый комплексный сценарий, проверяй DNS и Traefik после регистрации
4. **Повторная регистрация** — slug должен быть уникальным, удали старый проект перед повторной
5. **update-ci** — используй для обновления CI после изменения шаблонов

## Защищённые ветки и Merge Request

Ветка `main` в GitLab защищена — прямой `git push` в неё запрещён. Для доставки изменений:

1. Коммитить в feature-ветку и пушить её:
   ```bash
   git checkout -b fix/my-changes
   git add . && git commit -m "описание"
   git push -u origin fix/my-changes
   ```
2. Создать Merge Request через GitLab UI (ссылка выводится в ответе `git push`)
3. Смержить MR в `main` — после этого CI/CD пайплайн запустится автоматически

> **Важно:** Runner с тегом `deploy-production` принимает задачи **только с защищённых веток** (main). Пайплайны на feature-ветках будут висеть в статусе "pending (stuck)".

## Кастомные CI-пайплайны (нестандартный стек)

Шаблоны оркестратора рассчитаны на типовой стек:
- `frontend` → Next.js в `frontend/`
- `backend` → Node.js в `backend/`
- `fullstack` → Next.js + Node.js

Если проект использует **другой стек** (Python, Go, Rust, нестандартные пути), шаблон нужно заменить вручную.

### Порядок действий

1. **Зарегистрировать проект** через оркестратор как обычно — это создаст DNS, Traefik, директории, CI-переменные (`DEPLOY_PATH`, `PM2_APP_NAME`), выделит порт
2. **Написать свой `.gitlab/ci/pipeline.yml`** под реальный стек проекта
3. **Запушить** через feature-ветку + Merge Request (см. выше)

### Пример: Python FastAPI + Vite React

Структура проекта:
```
api/              # Python FastAPI backend
src/              # Python модули
frontend/app/     # Vite + React (package.json здесь, не в frontend/)
requirements.txt
```

Кастомный `.gitlab/ci/pipeline.yml`:

```yaml
stages:
  - build
  - deploy

build:frontend:
  stage: build
  tags:
    - deploy-production
  script:
    - cd frontend/app      # НЕ cd frontend!
    - npm ci
    - npm run build
  artifacts:
    paths:
      - frontend/app/dist/
    expire_in: 1 hour
  rules:
    - if: $CI_COMMIT_BRANCH == "main"

deploy:
  stage: deploy
  tags:
    - deploy-production
  dependencies:
    - build:frontend
  script:
    # Бэкенд (Python)
    - mkdir -p $DEPLOY_PATH/api $DEPLOY_PATH/src $DEPLOY_PATH/data $DEPLOY_PATH/static
    - rsync -a --delete --exclude='__pycache__' --exclude='*.pyc' api/ $DEPLOY_PATH/api/
    - rsync -a --delete --exclude='__pycache__' --exclude='*.pyc' src/ $DEPLOY_PATH/src/
    - cp requirements.txt $DEPLOY_PATH/requirements.txt

    # Фронтенд (Vite build)
    - rsync -a --delete frontend/app/dist/ $DEPLOY_PATH/static/

    # Python venv
    - cd $DEPLOY_PATH
    - test -d venv || python3 -m venv venv
    - ./venv/bin/pip install -r requirements.txt --quiet

    # .env (опциональная CI-переменная типа File)
    - test -f "$BACKEND_ENV" && cp "$BACKEND_ENV" $DEPLOY_PATH/.env || true

    # PM2 ecosystem
    - |
      cat > $DEPLOY_PATH/ecosystem.config.js << PMEOF
      module.exports = {
        apps: [{
          name: '$PM2_APP_NAME',
          cwd: '$DEPLOY_PATH',
          script: './venv/bin/uvicorn',
          args: 'api.main:app --host 127.0.0.1 --port <ПОРТ>',
          env: { PYTHONPATH: '.' },
        }]
      };
      PMEOF

    # Запуск / перезапуск
    - |
      if pm2 describe $PM2_APP_NAME > /dev/null 2>&1; then
        cd $DEPLOY_PATH && pm2 reload ecosystem.config.js --update-env
      else
        cd $DEPLOY_PATH && pm2 start ecosystem.config.js
      fi
    - pm2 save
  rules:
    - if: $CI_COMMIT_BRANCH == "main"
```

> Замени `<ПОРТ>` на выделенный порт из ответа оркестратора (`ports.frontend`).

### SPA-раздача из FastAPI (для fullstack)

Если фронтенд — SPA (React, Vue, Svelte), бэкенд должен отдавать собранные статические файлы в production. Добавь в FastAPI-приложение:

```python
from pathlib import Path
from starlette.staticfiles import StaticFiles

_STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

# После всех роутеров, в конце файла:
if _STATIC_DIR.exists() and (_STATIC_DIR / "index.html").exists():
    class _SPAStaticFiles(StaticFiles):
        async def get_response(self, path: str, scope):
            try:
                response = await super().get_response(path, scope)
                if response.status_code == 404:
                    response = await super().get_response("index.html", scope)
                return response
            except Exception:
                return await super().get_response("index.html", scope)

    app.mount("/", _SPAStaticFiles(directory=str(_STATIC_DIR), html=True), name="spa")
```

Это монтируется **после** всех API-роутов, поэтому API-эндпоинты имеют приоритет. Для несуществующих путей отдаётся `index.html` (client-side routing).

Также добавь production-домен в CORS:
```python
allow_origins=[
    "http://localhost:5173",  # dev
    "https://<slug>.borisovai.ru",    # production
    "https://<slug>.borisovai.tech",  # production (alt)
]
```

## Домены и порты

- Домен проекта: `<slug>.borisovai.ru` и `<slug>.borisovai.tech` (оба генерируются автоматически)
- В ответе API `domain` содержит оба домена через запятую: `"my-app.borisovai.ru,my-app.borisovai.tech"`
- Порты выделяются автоматически начиная с `base_port` (по умолчанию 4010)
- Traefik маршрутизирует HTTPS-трафик с обоих доменов на `127.0.0.1:<порт>`
- Порт можно узнать из ответа регистрации: `response.project.ports.frontend`

## Типичные ошибки

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `npm error ENOENT: .../frontend/package.json` | Шаблон ожидает `frontend/package.json`, а в проекте `frontend/app/package.json` | Написать кастомный pipeline (см. выше) |
| `cd backend && npm install` fails | Бэкенд не Node.js (Python, Go и т.д.) | Кастомный pipeline |
| Pipeline "pending (stuck)" | Runner `deploy-production` не принимает задачи с feature-веток | Смержить в main |
| `git push` rejected: protected branch | Прямой пуш в main запрещён | Пушить в feature-ветку, мержить через MR |
| `update-ci` затирает кастомный pipeline | `update-ci` всегда применяет шаблон | Не использовать `update-ci` для проектов с кастомным pipeline |
