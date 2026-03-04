# Plan: One-Click Project Publishing

## Архитектура

Оркестратор регистрации проектов — часть Management UI v2 (monorepo).

### Стек

- **Backend**: Fastify v5, TypeScript, Drizzle ORM
- **Frontend**: React 19, Vite, TanStack Query, React Router v7
- **Shared**: Zod-схемы, TypeScript-типы
- **Data**: `/etc/management-ui/projects.json` (JSON файл)
- **Templates**: `management-ui/templates/*.gitlab-ci.yml`

---

## Файловая структура

```
management-ui/
├── shared/src/
│   ├── types/projects.ts          # ProjectRecord, ProjectStep, PublishRequest
│   └── validation/schemas.ts      # Zod: publishProjectSchema, releaseSchema
├── backend/src/
│   ├── routes/projects.routes.ts  # Fastify routes: /api/publish/*
│   ├── services/projects.service.ts # Бизнес-логика оркестратора
│   └── lib/
│       ├── gitlab.ts              # GitLab API (pushFile, setCiVariable, getProjects)
│       ├── strapi.ts              # Strapi API (createOrUpdateProject)
│       ├── traefik.ts             # Traefik YAML CRUD + reload
│       ├── dns.ts                 # DNS record CRUD
│       └── ports.ts               # Аллокация портов из projects.json
├── frontend/src/
│   ├── pages/ProjectsPage.tsx     # UI страница проектов
│   └── api/
│       ├── queries/projects.ts    # useProjects, useGitlabProjects, usePublishConfig
│       └── mutations/projects.ts  # usePublishProject, useDeleteProject, useUpdateCi, useRelease
└── templates/
    ├── frontend.gitlab-ci.yml
    ├── backend.gitlab-ci.yml
    ├── fullstack.gitlab-ci.yml
    ├── docs.gitlab-ci.yml
    ├── validate.gitlab-ci.yml
    └── product.gitlab-ci.yml
```

---

## 4 сценария

| Действие | deploy | docs | infra | product |
|----------|:------:|:----:|:-----:|:-------:|
| DNS | + | - | - | - |
| Traefik YAML | + | - | - | - |
| Authelia middleware | + (если `authelia=true`) | - | - | - |
| Директории | app dir | docs dir | - | downloads dir |
| CI файлы в репо | deploy | docs | validate | product |
| CI Variables | deploy path, ports, env | docs path | - | strapi, downloads |
| Strapi запись | опц. | + | опц. | + |
| projects.json | + | + | + | + |

### Поле `authelia`

- Тип: `boolean`, default `true`
- При `authelia=true` в сценарии deploy: Traefik YAML включает `middlewares: [authelia@file]`
- При `authelia=false`: Traefik YAML без Authelia (публичный доступ)
- Сохраняется в `projects.json` как поле записи

---

## API endpoints

| Endpoint | Метод | Описание |
|----------|-------|----------|
| `/api/gitlab/projects` | GET | Список проектов из GitLab API |
| `/api/publish/projects` | GET | Зарегистрированные проекты |
| `/api/publish/projects` | POST | Регистрация проекта (оркестратор) |
| `/api/publish/projects/:slug` | DELETE | Удаление (откат шагов) |
| `/api/publish/projects/:slug/update-ci` | PUT | Обновить CI из шаблона |
| `/api/publish/projects/:slug/release` | POST | Создать релиз |
| `/api/publish/projects/:slug/releases` | GET | Список релизов проекта |
| `/api/publish/config` | GET | Конфигурация для UI |

Детали API: см. [AGENT_ORCHESTRATOR.md](../agents/AGENT_ORCHESTRATOR.md).

---

## Orchestration flow (POST /api/publish/projects)

```
1. Валидация (Zod: publishProjectSchema)
   - slug уникален в projects.json
   - gitlabProjectId существует в GitLab
   - slug safe (isSafeServiceName)

2. Получить default_branch, path_with_namespace из GitLab

3. Создать запись в projects.json (status: "registering", все steps: done=false)

4. Выполнить шаги по сценарию:
   - Каждый шаг в try/catch
   - Успех: steps[шаг].done = true
   - Ошибка: steps[шаг].error, продолжить
   - Для deploy + authelia=true: добавить authelia@file в Traefik YAML

5. status = "active" если критические шаги ОК

6. Ответ: { success, project, errors }
```

**Идемпотентность**: повторный вызов с тем же slug пропускает выполненные шаги.

---

## Реестр проектов — `/etc/management-ui/projects.json`

```json
[
  {
    "slug": "my-app",
    "gitlabProjectId": 42,
    "gitlabProjectPath": "group/my-app",
    "gitlabDefaultBranch": "main",
    "projectType": "deploy",
    "appType": "frontend",
    "domain": "my-app.borisovai.ru",
    "deployPath": "/var/www/my-app",
    "ports": { "frontend": 4010, "backend": null },
    "authelia": true,
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

---

## CI-шаблоны

Хранятся в `management-ui/templates/`. При установке (`install-management-ui.sh`) копируются в `/opt/management-ui/templates/`.

Для каждого проекта пушатся 2 файла через GitLab Repository Files API:
- `.gitlab-ci.yml` — минимальный (`include: local: '.gitlab/ci/pipeline.yml'`)
- `.gitlab/ci/pipeline.yml` — полный пайплайн из шаблона с подстановкой `{{RUNNER_TAG}}`, `{{DEFAULT_BRANCH}}`

---

## Release endpoints

**POST /api/publish/projects/:slug/release** — ручной релиз:
- Обновляет version в Strapi
- Обновляет downloadUrl
- Сохраняет запись о релизе

**GET /api/publish/projects/:slug/releases** — история релизов проекта.

---

## Порядок реализации

1. Shared: типы и Zod-схемы (`projects.ts`, `schemas.ts`)
2. Backend: lib-модули (gitlab, strapi, traefik, dns, ports)
3. Backend: `projects.service.ts` — оркестрация по 4 сценариям
4. Backend: `projects.routes.ts` — все endpoints
5. CI-шаблоны: 6 файлов в `templates/`
6. Frontend: `ProjectsPage.tsx` + queries/mutations
7. Навигация: ссылка в sidebar

---

## Верификация

1. Существующие endpoints работают без изменений
2. `GET /api/gitlab/projects` возвращает список из GitLab
3. Тест каждого сценария через UI:
   - **deploy**: DNS + Traefik (с/без authelia) + директории + CI + push = сайт по домену
   - **docs**: директория + CI + Strapi = доки на `/docs/<slug>/`
   - **infra**: CI в репо = пайплайн валидации
   - **product**: Strapi + CI = тег `v1.0.0` обновляет артефакт + версию
4. Удаление проекта: Traefik/DNS откатываются
5. Повторная регистрация: идемпотентность
6. Release: POST создает релиз, GET возвращает историю
