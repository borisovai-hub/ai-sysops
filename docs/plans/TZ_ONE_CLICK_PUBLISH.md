# ТЗ: публикация проектов в один клик

## 1. Цели и границы

**Цель**: после загрузки кода в GitLab новый проект автоматически появляется на сайте: DNS, Traefik, CI/CD, деплой — без ручных шагов.

**Ограничения**: не менять базовый стек (Traefik, GitLab, DNS API / `manage-dns`). Оркестратор — часть Management UI v2.

**Стек Management UI v2**: Fastify v5 (backend), React 19 + Vite (frontend), Drizzle ORM + SQLite, shared Zod-схемы.

---

## 2. Текущее состояние

- Один сервер: Traefik (file provider, watch), GitLab, n8n, Mailu, Management UI, DNS API, Authelia SSO
- Деплой borisovai-site: настроен вручную (CI, DNS, Traefik, директории)
- Новый сервис: через Management UI (`POST /api/services`) — DNS + Traefik YAML
- **Проблема**: для каждого нового проекта вручную нужны: `.gitlab-ci.yml`, CI variables, Traefik, DNS, директории

---

## 3. Целевой сценарий

1. Пользователь в UI выбирает GitLab-репозиторий, тип проекта, домен
2. Оркестратор: DNS + Traefik + CI + директории + Strapi (по сценарию)
3. Push в репо запускает CI/CD, проект доступен по домену с SSL

**Триггер**: кнопка в UI (MVP). Webhook — следующая фаза.

---

## 4. Четыре сценария

### Сценарий 1: Документация (docs)
- Strapi запись (sourceUrl, slug)
- CI файлы (шаблон docs) в репо
- CI Variable: `DOCS_DEPLOY_PATH`
- Директория: `<main_site_path>/frontend/public/docs/<slug>`
- DNS/Traefik: не нужны (доки на основном сайте `/docs/<slug>/`)

### Сценарий 2: Build & Deploy (deploy)
- DNS запись (A record)
- Traefik YAML (с `authelia@file` если `authelia=true`)
- Директории: `/var/www/<slug>/{frontend,backend}`
- CI файлы (шаблон deploy) в репо
- CI Variables: `DEPLOY_PATH`, `PM2_APP_NAME`, порты, `.env`
- Опц.: Strapi запись

### Сценарий 3: Инфраструктура (infra)
- CI файлы (шаблон validate) в репо
- Опц.: Strapi запись (sourceUrl)

### Сценарий 4: Продуктовая страница (product)
- Strapi запись (title, slug, sourceUrl)
- CI файлы (шаблон product) в репо
- CI Variables: `STRAPI_API_URL`, `STRAPI_API_TOKEN`, `PROJECT_SLUG`, `DOWNLOADS_PATH`
- Директория: `<main_site_path>/frontend/public/downloads/<slug>`

### Сводка

| Действие | docs | deploy | infra | product |
|----------|:----:|:------:|:-----:|:-------:|
| DNS | - | + | - | - |
| Traefik | - | + | - | - |
| Authelia | - | настраиваемый | - | - |
| Директории | docs | app | - | downloads |
| CI файлы | docs | deploy | validate | product |
| CI Variables | docs path | deploy path, ports | - | strapi, downloads |
| Strapi | + | опц. | опц. | + |

---

## 5. Ключевые файлы

### Shared (типы и валидация)
- `shared/src/types/projects.ts` — ProjectRecord, PublishRequest, ReleaseRequest
- `shared/src/validation/schemas.ts` — publishProjectSchema, releaseSchema (Zod)

### Backend
- `backend/src/routes/projects.routes.ts` — Fastify routes
- `backend/src/services/projects.service.ts` — бизнес-логика оркестратора
- `backend/src/lib/gitlab.ts` — GitLab API (pushFile, setCiVariable, getProjects)
- `backend/src/lib/strapi.ts` — Strapi API (createOrUpdateProject)
- `backend/src/lib/traefik.ts` — Traefik YAML CRUD + reload
- `backend/src/lib/dns.ts` — DNS record CRUD
- `backend/src/lib/ports.ts` — аллокация портов

### Frontend
- `frontend/src/pages/ProjectsPage.tsx` — UI страница
- `frontend/src/api/queries/projects.ts` — useProjects, useGitlabProjects
- `frontend/src/api/mutations/projects.ts` — usePublishProject, useDeleteProject, useRelease

### CI-шаблоны
- `management-ui/templates/*.gitlab-ci.yml` — frontend, backend, fullstack, docs, validate, product

### Данные
- `/etc/management-ui/projects.json` — реестр проектов (JSON)
- `/etc/management-ui/config.json` — gitlab_url, gitlab_token, strapi_url, strapi_token, base_port, runner_tag

---

## 6. Поле `authelia`

- Тип: `boolean`, default `true`
- При `authelia=true` и сценарии deploy: Traefik YAML включает `middlewares: [authelia@file]`
- При `authelia=false`: публичный доступ (без middleware)
- Также обновляется Authelia `access_control` при необходимости

---

## 7. Release endpoints

- `POST /api/publish/projects/:slug/release` — создать релиз (обновить version/downloadUrl в Strapi)
- `GET /api/publish/projects/:slug/releases` — история релизов

---

## 8. CI-шаблоны: доставка в проекты

`include:project` в GitLab CE работает только с PUBLIC repos. Решение: `include:local`.

Оркестратор пушит через GitLab Repository Files API:
- `.gitlab-ci.yml` — минимальный (`include: local: '.gitlab/ci/pipeline.yml'`)
- `.gitlab/ci/pipeline.yml` — полный пайплайн из шаблона с `{{RUNNER_TAG}}`, `{{DEFAULT_BRANCH}}`

---

## 9. Strapi интеграция

Content type `project` уже есть: title, slug, description, downloadUrl, version, externalId и др.

- REST API: `/api/projects` (CRUD)
- Auth: API Token из config.json (`strapi_token`)
- Порт: 1337 (localhost)

---

## 10. Критерии приёмки

1. Все 4 сценария работают через UI
2. Deploy-сценарий: push в репо запускает CI, проект доступен по домену с SSL
3. Authelia: при `authelia=true` проект защищён SSO, при `false` — публичный
4. Удаление проекта откатывает DNS + Traefik
5. Повторная регистрация идемпотентна (пропуск выполненных шагов)
6. Release endpoint обновляет версию в Strapi
7. Существующие endpoints Management UI работают без изменений

---

## 11. Мульти-сервер (фаза 2)

Структура заложена в `config/servers/<vm-id>/env.yml`. При регистрации проекта — выбор целевого хоста по тегу Runner. Один Traefik, бэкенды на разных VM. Реализация — после стабильного MVP на одном сервере.
