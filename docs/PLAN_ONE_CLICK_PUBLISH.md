# Plan: One-Click Project Publishing — Полный план (Phase 1)

## Архитектурный анализ

### Ключевые технические решения

**1. CI-шаблоны: как доставлять в целевые проекты**

`include:project` в GitLab CE работает **только с PUBLIC проектами**. `borisovai-admin` — приватный. `include:remote` тоже требует аутентификации для приватных. Единственный надёжный вариант — `include:local`.

**Решение:** Оркестратор пушит файлы прямо в целевой репозиторий через GitLab Repository Files API:
- `.gitlab-ci.yml` — минимальный, содержит `include:local` на `.gitlab/ci/pipeline.yml`
- `.gitlab/ci/pipeline.yml` — полный пайплайн, сгенерированный из шаблона по типу проекта

Это даёт модульность: `.gitlab-ci.yml` пользователь может расширять, а `.gitlab/ci/pipeline.yml` оркестратор может обновлять.

**2. Интеграция со Strapi (сайт borisovai-site)**

Strapi уже имеет content type `project` с полями:
- `title`, `slug`, `description`, `fullDescription` (richtext)
- `downloadUrl`, `demoUrl`, `sourceUrl`, `version`
- `documentation` (richtext)
- `thumbnail`, `screenshots`, `downloadFile`
- `categories` (relation), `techStack` (JSON), `tags` (JSON)
- `status` (active/completed/archived), `featured`
- `externalId` (unique) — используем как GitLab project ID

**Вывод:** Для сценариев 1 и 4 НЕ нужно создавать новые content types. Достаточно создавать/обновлять записи `project` через Strapi REST API (`POST /api/projects`, `PUT /api/projects/:id`).

**3. Strapi API доступ**

- REST API: `/api/projects` (стандартные CRUD-эндпоинты Strapi)
- Аутентификация: API Token (задаётся в настройках Strapi Admin)
- Strapi работает на порту 1337 (бэкенд borisovai-site), доступен локально
- БД: PostgreSQL

---

## Хранение данных — детальная схема

### Где что хранится

```
/etc/management-ui/
├── config.json              # Конфигурация Management UI (существует)
├── auth.json                # Учётные данные (существует)
└── projects.json            # НОВЫЙ: реестр зарегистрированных проектов

/opt/management-ui/          # Развёрнутое приложение (копируется из management-ui/)
├── server.js                # Главный сервер
├── templates/               # НОВЫЙ: CI-шаблоны (копируются при установке)
│   ├── frontend.gitlab-ci.yml
│   ├── backend.gitlab-ci.yml
│   ├── fullstack.gitlab-ci.yml
│   ├── docs.gitlab-ci.yml
│   ├── validate.gitlab-ci.yml
│   └── product.gitlab-ci.yml
└── public/
    ├── index.html
    ├── dns.html
    ├── login.html
    └── projects.html        # НОВЫЙ: UI страница

/etc/traefik/dynamic/        # Traefik конфиги (существует)
├── gitlab.yml
├── <service>.yml            # Существующие сервисы
└── <project-slug>.yml       # НОВЫЙ: конфиги для задеплоенных проектов

/var/www/                    # Директории деплоя
├── borisovai-site/          # Основной сайт (существует)
│   ├── frontend/
│   │   └── public/
│   │       ├── docs/<slug>/ # НОВЫЙ: документация проектов (сценарий 1)
│   │       └── downloads/<slug>/ # НОВЫЙ: артефакты продуктов (сценарий 4)
│   └── backend/
└── <project-slug>/          # НОВЫЙ: директории проектов (сценарий 2)
    ├── frontend/
    └── backend/

# В репозитории borisovai-admin (dev-time):
management-ui/
├── templates/               # НОВЫЙ: шаблоны CI (при установке копируются в /opt)
│   └── *.gitlab-ci.yml
└── public/
    └── projects.html        # НОВЫЙ

config/servers/vm1/          # НОВЫЙ: placeholder для мульти-сервера
└── env.yml

# В целевых проектах GitLab (создаётся оркестратором):
.gitlab-ci.yml               # Минимальный: include:local
.gitlab/ci/pipeline.yml      # Полный пайплайн из шаблона
```

### Почему шаблоны внутри `management-ui/templates/`

Скрипт `install-management-ui.sh` (строка 130) копирует **всё** из `management-ui/` в `/opt/management-ui/`:
```bash
cp -r "$MANAGEMENT_UI_PATH"/* "$APP_DIR/"
```
Поэтому шаблоны размещаются внутри `management-ui/templates/` — они автоматически попадают в `/opt/management-ui/templates/` при установке. Никаких изменений в install-скрипте не нужно.

В `server.js` путь к шаблонам: `path.join(__dirname, 'templates')`.

### Конфигурация — `/etc/management-ui/config.json`

**Существующие поля** (не трогаем):
```json
{
  "base_domains": "...",
  "ui_prefix": "..."
}
```

**Новые поля** (добавляются при настройке):
```json
{
  "gitlab_url": "https://gitlab.example.com",
  "gitlab_token": "glpat-xxx",
  "strapi_url": "http://127.0.0.1:1337",
  "strapi_token": "xxx",
  "base_port": 4010,
  "runner_tag": "deploy-production",
  "main_site_path": "/var/www/borisovai-site",
  "deploy_base_path": "/var/www"
}
```

Сервер читает `config.json` при старте (строки 35-42 server.js). Новые поля просто добавляются в тот же файл — без изменения логики загрузки.

### Реестр проектов — `/etc/management-ui/projects.json`

**Формат:**
```json
[
  {
    "slug": "my-app",
    "gitlabProjectId": 42,
    "gitlabProjectPath": "group/my-app",
    "gitlabDefaultBranch": "main",
    "projectType": "deploy",
    "appType": "frontend",
    "domain": "my-app.example.com",
    "deployPath": "/var/www/my-app",
    "ports": { "frontend": 4010, "backend": null },
    "strapiProjectId": null,
    "title": "My App",
    "registeredAt": "2026-02-04T12:00:00Z",
    "status": "active",
    "steps": {
      "dns": { "done": true, "detail": "A record created" },
      "traefik": { "done": true, "detail": "my-app.yml" },
      "directories": { "done": true, "detail": "/var/www/my-app/frontend" },
      "ciVariables": { "done": true, "detail": "DEPLOY_PATH, PM2_APP_NAME" },
      "ciFiles": { "done": true, "detail": ".gitlab-ci.yml, .gitlab/ci/pipeline.yml" },
      "strapi": { "done": false, "detail": null }
    }
  }
]
```

**Поле `steps`** — трекинг каждого шага регистрации. Позволяет:
- Показывать в UI статус каждого шага (✓/✗)
- При ошибке — понимать, какие шаги выполнены, какие нет
- При повторной регистрации — идемпотентно пропускать уже сделанное
- При удалении — знать, что нужно откатить

**Инициализация:** если файл не существует, сервер создаёт его с `[]`.

**Операции:**
- `loadProjects()` — чтение JSON файла
- `saveProjects(projects)` — запись JSON файла
- Блокировка записи не нужна (одновременные запросы маловероятны в Management UI)

### Аллокация портов

**Логика:** `base_port` из конфигурации (по умолчанию 4010). Для каждого нового проекта:
- `frontend` порт = следующий свободный
- `backend` порт = следующий свободный после frontend

**Реализация:** проход по реестру `projects.json`, сбор всех занятых портов, выделение следующего свободного.

---

## Все 4 сценария — что делает оркестратор

### Сценарий 1: Исходники и документация

| Шаг | Действие | Хранение результата |
|-----|----------|---------------------|
| 1 | Создать запись в Strapi (`project`) с `sourceUrl`, `slug` | Strapi DB (PostgreSQL) |
| 2 | Запушить `.gitlab-ci.yml` + `.gitlab/ci/pipeline.yml` (шаблон docs) | Целевой GitLab репозиторий |
| 3 | Задать CI Variables: `DOCS_DEPLOY_PATH` | GitLab Project Variables |
| 4 | Создать директорию `<main_site_path>/frontend/public/docs/<slug>` | Файловая система сервера |
| 5 | Сохранить в реестр | `/etc/management-ui/projects.json` |

**CI-шаблон (docs):** build docs → копировать артефакт в `$DOCS_DEPLOY_PATH` через shell runner.
**DNS/Traefik:** не нужны — доки на основном сайте под `/docs/<slug>/`.

### Сценарий 2: Build & Deploy (running app)

| Шаг | Действие | Хранение результата |
|-----|----------|---------------------|
| 1 | Создать DNS запись | DNS провайдер (через `manage-dns`) |
| 2 | Создать Traefik конфиг | `/etc/traefik/dynamic/<slug>.yml` |
| 3 | Перезагрузить Traefik | systemd |
| 4 | Создать директории `/var/www/<slug>/{frontend,backend}` | Файловая система |
| 5 | Запушить CI файлы (шаблон deploy) | Целевой GitLab репозиторий |
| 6 | Задать CI Variables: `DEPLOY_PATH`, `PM2_APP_NAME`, порты, `.env` files | GitLab Project Variables |
| 7 | Опционально: создать запись в Strapi | Strapi DB |
| 8 | Сохранить в реестр | `projects.json` |

### Сценарий 3: Инфраструктура (validate only)

| Шаг | Действие | Хранение результата |
|-----|----------|---------------------|
| 1 | Запушить CI файлы (шаблон validate) | Целевой GitLab репозиторий |
| 2 | Опционально: создать запись в Strapi с `sourceUrl` | Strapi DB |
| 3 | Сохранить в реестр | `projects.json` |

### Сценарий 4: Продуктовая страница + артефакты

| Шаг | Действие | Хранение результата |
|-----|----------|---------------------|
| 1 | Создать запись в Strapi (`project`) с `title`, `slug`, `sourceUrl` | Strapi DB |
| 2 | Запушить CI файлы (шаблон product) | Целевой GitLab репозиторий |
| 3 | Задать CI Variables: `STRAPI_API_URL`, `STRAPI_API_TOKEN`, `PROJECT_SLUG`, `DOWNLOADS_PATH` | GitLab Project Variables |
| 4 | Создать директорию `<main_site_path>/frontend/public/downloads/<slug>` | Файловая система |
| 5 | Сохранить в реестр | `projects.json` |

**CI-шаблон (product):** при теге (`v*`) → build артефактов → копировать в `$DOWNLOADS_PATH` → вызвать Strapi API для обновления `version`, `downloadUrl`.

### Сводка

| Действие | Сц.1 | Сц.2 | Сц.3 | Сц.4 |
|----------|:----:|:----:|:----:|:----:|
| DNS | — | ✓ | — | — |
| Traefik YAML | — | ✓ | — | — |
| Директории | docs dir | app dir | — | downloads dir |
| CI файлы в репо | docs | deploy | validate | product |
| CI Variables | docs path | deploy path, ports, env | — | strapi, downloads |
| Strapi запись | ✓ | опц. | опц. | ✓ |
| projects.json | ✓ | ✓ | ✓ | ✓ |

---

## Архитектура оркестратора

Оркестратор — новые endpoints в [management-ui/server.js](management-ui/server.js).

### Helpers (переиспользуемые функции)

**Извлечь из текущего `POST /api/services`** (строки 265-355 server.js):

```js
// DNS
async function getExternalIp()                      // строки 289-295
async function createDnsRecord(subdomain, ip)        // строки 297-304
async function deleteDnsRecord(subdomain)            // из DELETE /api/services

// Traefik
async function createTraefikConfig(name, domain, internalIp, port)  // строки 307-332
async function deleteTraefikConfig(name)             // из DELETE /api/services
async function reloadTraefik()                       // строки 334-338
```

**Новые helpers:**

```js
// GitLab API
async function gitlabApi(method, endpoint, data)
// Обёртка: axios({ method, url: `${config.gitlab_url}/api/v4${endpoint}`,
//   headers: { 'PRIVATE-TOKEN': config.gitlab_token }, data })

async function pushFileToGitlab(projectId, filePath, content, branch, commitMessage)
// POST или PUT /projects/:id/repository/files/:path
// Сначала GET чтобы проверить, существует ли файл → POST (create) или PUT (update)
// Content передаётся как base64

async function setGitlabCiVariable(projectId, key, value, options)
// POST /projects/:id/variables
// options: { masked, protected, variable_type: 'env_var'|'file' }

// Strapi API
async function strapiApi(method, endpoint, data)
// Обёртка: axios({ method, url: `${config.strapi_url}/api${endpoint}`,
//   headers: { Authorization: `Bearer ${config.strapi_token}` }, data })

async function createOrUpdateStrapiProject(slug, fields)
// Ищет проект по externalId или slug, создаёт или обновляет

// Шаблоны
function loadTemplate(templateName)
// fs.readFileSync(path.join(__dirname, 'templates', templateName), 'utf8')

function renderTemplate(template, vars)
// Простая замена {{VAR}} → value
// Единственная подстановка для MVP: {{RUNNER_TAG}}, {{DEFAULT_BRANCH}}

// Реестр проектов
function loadProjects()    // JSON.parse из /etc/management-ui/projects.json
function saveProjects(arr) // JSON.stringify в /etc/management-ui/projects.json
function allocatePort()    // Проход по реестру, следующий свободный после base_port

// Директории
async function createDeployDirs(basePath, appType)
// mkdir -p + chown gitlab-runner:gitlab-runner
```

### Новые API endpoints

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/gitlab/projects` | GET | Список проектов из GitLab API (для select) |
| `/api/publish/projects` | GET | Зарегистрированные проекты из `projects.json` |
| `/api/publish/projects` | POST | **Главный**: регистрация проекта |
| `/api/publish/projects/:slug` | DELETE | Удаление (откат всех шагов) |
| `/api/publish/projects/:slug/update-ci` | PUT | Обновить CI в проекте из свежего шаблона |
| `/api/publish/config` | GET | Вернуть конфигурацию (base_domain, runner_tag) для UI |
| `/projects.html` | GET | Страница (с `requireAuth`) |

### POST /api/publish/projects — детальный flow

**Вход:**
```json
{
  "gitlabProjectId": 42,
  "slug": "my-app",
  "projectType": "deploy",
  "appType": "frontend",
  "domain": "my-app.example.com",
  "title": "My App",
  "description": "Optional description"
}
```

**Алгоритм:**
```
1. Валидация:
   - slug уникален в projects.json
   - gitlabProjectId существует в GitLab (GET /projects/:id)
   - slug соответствует isSafeServiceName()

2. Получить данные проекта из GitLab:
   - default_branch, path_with_namespace

3. Инициализировать запись в реестре (status: "registering", все steps: done=false)

4. Выполнить шаги по сценарию (см. таблицу сценариев выше):
   - Каждый шаг обёрнут в try/catch
   - При успехе: обновить steps[шаг].done = true
   - При ошибке: записать ошибку в steps[шаг].error, продолжить

5. Если все критические шаги выполнены:
   - status = "active"
   - Сохранить в projects.json

6. Вернуть результат:
   { success: true/false, project: {...}, errors: [...] }
```

**Идемпотентность:** при повторном вызове с тем же slug — проверяем steps, выполняем только те, которые не done.

### DELETE /api/publish/projects/:slug — детальный flow

```
1. Найти проект в projects.json по slug
2. По steps откатить:
   - traefik: удалить /etc/traefik/dynamic/<slug>.yml, reload
   - dns: manage-dns delete <subdomain>
   - ciFiles: НЕ удаляем из GitLab (пользователь может хотеть сохранить)
   - ciVariables: НЕ удаляем (безопаснее оставить)
   - strapi: опционально — удалить или пометить archived
   - directories: НЕ удаляем (безопасность данных)
3. Удалить из projects.json
```

---

## CI-шаблоны — детально

### Размещение в репозитории

```
management-ui/templates/          # В репозитории (dev-time)
  frontend.gitlab-ci.yml          # → копируется в /opt/management-ui/templates/
  backend.gitlab-ci.yml
  fullstack.gitlab-ci.yml
  docs.gitlab-ci.yml
  validate.gitlab-ci.yml
  product.gitlab-ci.yml
```

При установке (`install-management-ui.sh`, строка 130: `cp -r ... $APP_DIR/`) шаблоны автоматически попадают в `/opt/management-ui/templates/`.

### Что генерирует оркестратор

**Для каждого проекта пушатся 2 файла:**

**Файл 1: `.gitlab-ci.yml`** (минимальный, пользователь может расширять)
```yaml
# Автоматически создан оркестратором. Можно дополнять.
include:
  - local: '.gitlab/ci/pipeline.yml'
```

**Файл 2: `.gitlab/ci/pipeline.yml`** (полный пайплайн, оркестратор обновляет)
Генерируется из шаблона с подстановкой `{{RUNNER_TAG}}` и `{{DEFAULT_BRANCH}}`.

### Шаблон frontend.gitlab-ci.yml (на основе borisovai-site)

```yaml
stages:
  - build
  - deploy

variables:
  NODE_VERSION: "20"

build:
  stage: build
  image: node:${NODE_VERSION}-alpine
  cache:
    key: deps-${CI_COMMIT_REF_SLUG}
    paths:
      - node_modules/
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - .next/
      - package.json
      - package-lock.json
      - next.config.*
      - public/
      - src/
    expire_in: 1 hour
  rules:
    - if: $CI_COMMIT_BRANCH == "{{DEFAULT_BRANCH}}"

deploy:
  stage: deploy
  tags:
    - {{RUNNER_TAG}}
  dependencies:
    - build
  script:
    - mkdir -p $DEPLOY_PATH
    - rm -rf $DEPLOY_PATH/.next
    - cp -r .next $DEPLOY_PATH/.next
    - cp -r src $DEPLOY_PATH/src 2>/dev/null || true
    - cp -r public $DEPLOY_PATH/public 2>/dev/null || true
    - cp package.json $DEPLOY_PATH/package.json
    - cp package-lock.json $DEPLOY_PATH/package-lock.json
    - cp next.config.* $DEPLOY_PATH/ 2>/dev/null || true
    - test -f "$FRONTEND_ENV" && cp "$FRONTEND_ENV" $DEPLOY_PATH/.env.local || true
    - cd $DEPLOY_PATH
    - npm ci --omit=dev
    - pm2 restart $PM2_APP_NAME || pm2 start npm --name $PM2_APP_NAME -- start
    - pm2 save
  rules:
    - if: $CI_COMMIT_BRANCH == "{{DEFAULT_BRANCH}}"
```

### Шаблон docs.gitlab-ci.yml

```yaml
stages:
  - build
  - deploy

build:docs:
  stage: build
  image: node:20-alpine
  script:
    - npm ci
    - npm run docs:build    # или mkdocs build, vitepress build и т.д.
  artifacts:
    paths:
      - docs/.vitepress/dist/  # или site/, public/, build/ — зависит от генератора
    expire_in: 1 hour
  rules:
    - if: $CI_COMMIT_BRANCH == "{{DEFAULT_BRANCH}}"

deploy:docs:
  stage: deploy
  tags:
    - {{RUNNER_TAG}}
  script:
    - mkdir -p $DOCS_DEPLOY_PATH
    - rm -rf $DOCS_DEPLOY_PATH/*
    - cp -r docs/.vitepress/dist/* $DOCS_DEPLOY_PATH/ 2>/dev/null || cp -r site/* $DOCS_DEPLOY_PATH/ 2>/dev/null || cp -r public/* $DOCS_DEPLOY_PATH/ 2>/dev/null || true
  rules:
    - if: $CI_COMMIT_BRANCH == "{{DEFAULT_BRANCH}}"
```

### Шаблон product.gitlab-ci.yml

```yaml
stages:
  - build
  - publish

build:artifacts:
  stage: build
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/
    expire_in: 1 week
  rules:
    - if: $CI_COMMIT_TAG =~ /^v/

publish:
  stage: publish
  tags:
    - {{RUNNER_TAG}}
  script:
    - mkdir -p $DOWNLOADS_PATH
    - cp -r dist/* $DOWNLOADS_PATH/ 2>/dev/null || true
    # Обновление Strapi — версия и ссылка
    - |
      if [ -n "$STRAPI_API_URL" ] && [ -n "$STRAPI_API_TOKEN" ]; then
        STRAPI_PROJECT_ID=$(curl -s -H "Authorization: Bearer $STRAPI_API_TOKEN" \
          "$STRAPI_API_URL/api/projects?filters[slug][$eq]=$PROJECT_SLUG" | \
          python3 -c "import sys,json; print(json.load(sys.stdin)['data'][0]['id'])" 2>/dev/null)
        if [ -n "$STRAPI_PROJECT_ID" ]; then
          curl -s -X PUT -H "Authorization: Bearer $STRAPI_API_TOKEN" \
            -H "Content-Type: application/json" \
            -d "{\"data\":{\"version\":\"$CI_COMMIT_TAG\",\"downloadUrl\":\"/downloads/$PROJECT_SLUG/\"}}" \
            "$STRAPI_API_URL/api/projects/$STRAPI_PROJECT_ID"
        fi
      fi
  rules:
    - if: $CI_COMMIT_TAG =~ /^v/
```

### Шаблон validate.gitlab-ci.yml

```yaml
stages:
  - validate

lint:
  stage: validate
  image: node:20-alpine
  script:
    - npm ci
    - npm run lint 2>/dev/null || echo "No lint script"
    - npm run validate 2>/dev/null || echo "No validate script"
  rules:
    - if: $CI_COMMIT_BRANCH == "{{DEFAULT_BRANCH}}" || $CI_MERGE_REQUEST_ID
```

---

## UI страница — projects.html

### Структура

По образцу [index.html](../management-ui/public/index.html) и [dns.html](../management-ui/public/dns.html): vanilla HTML/CSS/JS.

**Таблица зарегистрированных проектов:**
| Колонка | Источник |
|---------|----------|
| Slug | projects.json |
| Тип | projectType |
| Domain | domain (или "—") |
| GitLab | gitlabProjectPath (ссылка) |
| Шаги | steps — иконки ✓/✗ |
| Действия | Delete, Update CI |

**Модальная форма «Зарегистрировать проект»:**

| Поле | Тип | Видимость | Источник данных |
|------|-----|-----------|-----------------|
| Тип проекта | select | всегда | static: deploy, docs, infra, product |
| GitLab Repository | select с поиском | всегда | `GET /api/gitlab/projects` |
| Slug | text (авто из repo name) | всегда | автозаполнение |
| Title | text | всегда | автозаполнение из repo name |
| App Type | select | только deploy | static: frontend, backend, fullstack |
| Domain | text (авто: slug.base) | только deploy | авто из `GET /api/publish/config` |
| Description | textarea | всегда | — |

**Динамические поля:** при смене типа проекта — JS показывает/скрывает поля App Type и Domain.

**Результат после submit:** пошаговый лог:
```
✓ DNS запись создана
✓ Traefik конфиг создан
✓ Директории созданы
✓ CI Variables заданы
✓ CI файлы запушены в репозиторий
✗ Strapi запись — пропущено (опционально)
```

---

## Файлы

### Создать

| Файл | Назначение |
|------|-----------|
| `management-ui/templates/frontend.gitlab-ci.yml` | CI: frontend deploy |
| `management-ui/templates/backend.gitlab-ci.yml` | CI: backend deploy |
| `management-ui/templates/fullstack.gitlab-ci.yml` | CI: fullstack deploy |
| `management-ui/templates/docs.gitlab-ci.yml` | CI: документация |
| `management-ui/templates/validate.gitlab-ci.yml` | CI: lint/validate |
| `management-ui/templates/product.gitlab-ci.yml` | CI: артефакты + Strapi |
| `management-ui/public/projects.html` | UI: регистрация проектов |
| `config/servers/vm1/env.yml` | Placeholder: мульти-сервер |

### Модифицировать

| Файл | Изменения |
|------|----------|
| [management-ui/server.js](../management-ui/server.js) | Извлечь DNS/Traefik функции; добавить helpers (GitLab API, Strapi API, templates, registry); 7 новых endpoints; route для projects.html |
| [management-ui/public/index.html](../management-ui/public/index.html) | Навигация: ссылка на projects.html |
| [management-ui/public/dns.html](../management-ui/public/dns.html) | Навигация: ссылка на projects.html |

---

## Порядок реализации

1. **CI-шаблоны** — создать `management-ui/templates/` с 6 файлами
2. **Рефакторинг server.js** — извлечь DNS/Traefik в функции (без изменения поведения)
3. **Helpers** — GitLab API, Strapi API, templates, registry, port allocation
4. **Реестр проектов** — loadProjects/saveProjects, инициализация `projects.json`
5. **Endpoint POST /api/publish/projects** — основная логика оркестратора по всем 4 сценариям
6. **Остальные endpoints** — GET gitlab/projects, GET/DELETE publish/projects, PUT update-ci, GET config
7. **UI страница** — `projects.html` с формой, таблицей, динамическими полями
8. **Навигация** — ссылки в index.html и dns.html
9. **config/servers/vm1/env.yml** — placeholder

---

## Верификация

1. Запустить Management UI, проверить что существующие endpoints (`/api/services`, `/api/dns`) работают без изменений
2. `GET /api/gitlab/projects` → список проектов из GitLab
3. `GET /api/publish/config` → base_domain, runner_tag
4. Тест каждого сценария через UI:
   - **Сценарий 2 (deploy):** DNS ✓ → Traefik YAML ✓ → директории ✓ → CI Variables в GitLab ✓ → CI файлы в репо ✓ → push кода → пайплайн → сайт по домену
   - **Сценарий 1 (docs):** директория docs ✓ → CI в репо ✓ → Strapi запись ✓ → push → доки на `/docs/<slug>/`
   - **Сценарий 3 (infra):** CI в репо ✓ → push → пайплайн валидации
   - **Сценарий 4 (product):** Strapi запись ✓ → CI в репо ✓ → тег `v1.0.0` → артефакт + Strapi обновлён
5. Удаление проекта → Traefik/DNS откатываются, реестр обновлён
6. Повторная регистрация того же slug → идемпотентность (пропуск выполненных шагов)
