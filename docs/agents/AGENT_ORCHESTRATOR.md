# AGENT_ORCHESTRATOR — legacy endpoint `POST /api/publish/projects`

> **Legacy reference.** Для новых публикаций используйте [AGENT_PUBLISH.md](AGENT_PUBLISH.md) (единый контракт + правила + LLM-оркестратор).
> Этот документ описывает только **текущий** legacy endpoint `POST /api/publish/projects`, который работает как thin-wrapper над новым API. Правила публикации (мульти-домен, Authelia 6 точек, idempotency, Docker uid и т.д.) — **не дублируются** здесь, смотри `AGENT_PUBLISH.md` → раздел "Правила публикации".

Оркестратор автоматически настраивает DNS, Traefik, CI/CD, директории и Strapi в зависимости от типа проекта.

## 1. Подключение

```
Base URL:  https://admin.borisovai.ru  или  https://admin.borisovai.tech
           http://127.0.0.1:3000  (с сервера)
Формат:    Content-Type: application/json
```

### Аутентификация

Два метода (cookie-сессии убраны):

| Метод | Заголовок | Когда использовать |
|-------|-----------|-------------------|
| **Bearer-токен** | `Authorization: Bearer <токен>` | Агенты, скрипты, CI |
| **Authelia ForwardAuth** | `Remote-User: admin` (проставляет Traefik) | Браузер через SSO |

Токены создаются в UI (страница "Токены") или через `POST /api/auth/tokens`.

```bash
# Проверить аутентификацию
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/publish/config
```

**Мульти-домен**: если домен не указан явно, оркестратор генерирует домены для всех `base_domains` из `/etc/install-config.json`. Для slug `my-app` создаются `my-app.borisovai.ru` и `my-app.borisovai.tech`.

## 2. Быстрый старт

```bash
TOKEN="ваш-bearer-токен"

curl -X POST http://127.0.0.1:3000/api/publish/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "gitlabProjectId": 5,
    "slug": "my-app",
    "projectType": "deploy",
    "appType": "frontend",
    "title": "My Application"
  }'
```

API принимает оба стиля именования полей:

| Каноническое | Альтернативное | Описание |
|-------------|----------------|----------|
| `gitlabProjectId` (число) | `gitlabProject` (строка `"group/name"` или число) | ID или путь проекта в GitLab |
| `projectType` | `type` | Тип проекта |

Если передан `gitlabProject` как строка вида `"group/name"`, API автоматически резолвит его в числовой ID через GitLab API.

## 3. API endpoints

Все endpoints требуют авторизации (Bearer или Authelia).

### GET /api/publish/config

Конфигурация оркестратора.

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/publish/config
```

Ответ: `baseDomain`, `baseDomains` (массив), `runnerTag`, `gitlabConfigured`, `strapiConfigured`.

### GET /api/publish/projects

Список зарегистрированных проектов.

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/publish/projects
```

### POST /api/publish/projects

Зарегистрировать (опубликовать) проект. Основной endpoint оркестратора.

```bash
curl -X POST http://127.0.0.1:3000/api/publish/projects \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "gitlabProjectId": 5,
    "slug": "my-app",
    "projectType": "deploy",
    "appType": "frontend",
    "title": "My Application",
    "description": "Описание проекта",
    "authelia": true,
    "force": false
  }'
```

| Параметр | Тип | Обязательный | Описание |
|----------|-----|-------------|----------|
| `slug` | string | да | Уникальный идентификатор (строчные буквы, цифры, дефисы) |
| `gitlabProjectId` | number | да* | ID проекта в GitLab |
| `gitlabProject` | string/number | да* | Путь `"group/name"` или ID (альтернатива `gitlabProjectId`) |
| `projectType` | string | да* | `deploy`, `docs`, `infra`, `product` |
| `type` | string | да* | Альтернатива `projectType` |
| `appType` | string | нет | `frontend` (по умолчанию), `backend`, `fullstack` |
| `title` | string | да | Название проекта |
| `description` | string | нет | Описание |
| `authelia` | boolean | нет | Добавить Authelia middleware в Traefik (по умолчанию `true`) |
| `force` | boolean | нет | Перерегистрировать если slug уже существует |

*Обязательно одно из пары: `gitlabProjectId` или `gitlabProject`; `projectType` или `type`.

### DELETE /api/publish/projects/:slug

Удалить проект из реестра + откатить DNS, Traefik, CI файлы. Директории остаются.

```bash
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/api/publish/projects/my-app
```

### PUT /api/publish/projects/:slug/retry

Повторить неуспешные шаги (status: "partial").

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/api/publish/projects/my-app/retry
```

### PUT /api/publish/projects/:slug/update-ci

Перегенерировать CI файлы из актуального шаблона.

```bash
curl -X PUT -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/api/publish/projects/my-app/update-ci
```

### POST /api/publish/projects/:slug/release

Записать релиз (webhook из CI или вручную). Обновляет Strapi как draft.

```bash
curl -X POST http://127.0.0.1:3000/api/publish/projects/my-app/release \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "v1.2.0",
    "downloadUrl": "/downloads/my-app/v1.2.0/",
    "changelog": "Описание изменений",
    "source": "agent"
  }'
```

| Параметр | Тип | Обязательный | Описание |
|----------|-----|-------------|----------|
| `version` | string | да | Версия (например `v1.2.0`) |
| `downloadUrl` | string | нет | URL загрузки |
| `changelog` | string | нет | Описание изменений |
| `source` | string | нет | `ci`, `agent`, `admin`, `unknown` (по умолчанию `admin`) |
| `action` | string | нет | `release`, `publish`, `unpublish` (по умолчанию `release`) |

### GET /api/publish/projects/:slug/releases

История релизов проекта.

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/api/publish/projects/my-app/releases
```

## 4. Типы проектов

### deploy -- веб-приложение с деплоем

Полный цикл: DNS + Traefik + директории + CI/CD + CI переменные.

Шаблон CI зависит от `appType`: `frontend` / `backend` / `fullstack`.

**Что делает оркестратор:**
1. **DNS** -- A-запись `<slug>` для всех base_domains
2. **Traefik** -- конфиг `/etc/traefik/dynamic/<slug>.yml` (с `authelia@file` если `authelia: true`)
3. **Директории** -- `mkdir -p /var/www/<slug>`, chown gitlab-runner
4. **CI** -- пушит `.gitlab-ci.yml` + `.gitlab/ci/pipeline.yml` в GitLab
5. **CI переменные** -- `DEPLOY_PATH`, `PM2_APP_NAME`
6. **Порт** -- автоматически выделяется начиная с `base_port`

### docs -- документация

Strapi + CI/CD для статической документации.

**Шаги:** Strapi запись + директории (`/var/www/docs/<slug>`) + CI файлы + CI переменные (`DOCS_DEPLOY_PATH`, `PROJECT_SLUG`, `MANAGEMENT_UI_URL`, `MANAGEMENT_UI_TOKEN`).

### infra -- инфраструктурный проект

Только CI/CD (валидация, линтинг). Strapi опционально (если настроен).

**Шаги:** CI файлы (шаблон `validate.gitlab-ci.yml`) + Strapi запись (опционально).

### product -- продукт с загрузками

Strapi + CI/CD + директория загрузок.

**Шаги:** Strapi запись + директории (`/var/www/downloads/<slug>`) + CI файлы + CI переменные (`MANAGEMENT_UI_URL`, `MANAGEMENT_UI_TOKEN`, `PROJECT_SLUG`, `DOWNLOADS_PATH`).

## 5. Шаги оркестратора

При регистрации `deploy`-проекта оркестратор выполняет до 5 шагов последовательно:

| Шаг | Что делает | Где хранится |
|-----|-----------|-------------|
| `dns` | A-запись через DNS API (порт 5353) | `/etc/management-ui/records.json` |
| `traefik` | YAML-конфиг роутера + сервиса | `/etc/traefik/dynamic/<slug>.yml` |
| `directories` | `mkdir -p` + `chown gitlab-runner` | `/var/www/<slug>/` |
| `ci` | Пуш `.gitlab-ci.yml` + `.gitlab/ci/pipeline.yml` через GitLab Repository Files API | Целевой GitLab-репозиторий |
| `variables` | CI-переменные через GitLab API | GitLab CI/CD Variables |

Если `authelia: true` (по умолчанию), в Traefik-конфиг добавляется middleware `authelia@file`.

Каждый шаг независим -- при ошибке одного остальные продолжаются. Частичный результат сохраняется в реестр (`status: "partial"`).

## 6. Ответ API

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
    "authelia": true,
    "pathWithNamespace": "group/my-app",
    "defaultBranch": "main",
    "ports": { "frontend": 4010 },
    "status": "ok",
    "steps": {
      "dns": { "done": true, "detail": "A запись my-app создана" },
      "traefik": { "done": true, "detail": "Конфиг создан" },
      "directories": { "done": true, "detail": "/var/www/my-app" },
      "ci": { "done": true, "detail": "CI файлы загружены" },
      "variables": { "done": true, "detail": "DEPLOY_PATH, PM2_APP_NAME" }
    },
    "createdAt": "2026-03-04T12:00:00.000Z"
  }
}
```

- `status`: `"ok"` -- все шаги выполнены, `"partial"` -- есть ошибки.
- В `steps` каждый шаг содержит `done: true/false`. При ошибке -- `error` с описанием.
- Данные проектов хранятся в `/etc/management-ui/projects.json` (JSON-файл, не БД).

## 7. Релизы и версионирование

Агент **не обновляет Strapi напрямую**. Все обновления проходят через release endpoint.

### Через CI (автоматически)

```
git tag v1.2.0 && git push --tags  ->  CI pipeline  ->
  POST /api/publish/projects/:slug/release (webhook)  ->
  Strapi draft  ->  Администратор публикует через UI
```

### Через API (вручную)

```bash
curl -X POST http://127.0.0.1:3000/api/publish/projects/my-app/release \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "version": "v1.2.0", "changelog": "Новые функции", "source": "agent" }'
```

Релиз попадает как draft. Публикация на сайте -- через одобрение в Management UI.

### Посмотреть историю релизов

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/api/publish/projects/my-app/releases | jq
```

## 8. Кастомные CI-пайплайны

Шаблоны оркестратора рассчитаны на типовой стек (Next.js, Node.js). Если проект использует другой стек (Python, Go, Rust):

1. **Зарегистрировать проект** через оркестратор -- это создаст DNS, Traefik, директории, CI-переменные
2. **Написать свой `.gitlab/ci/pipeline.yml`** под реальный стек
3. **Запушить** через feature-ветку + Merge Request (main защищена, прямой push запрещён)
4. **Не использовать** `update-ci` -- он перезапишет кастомный pipeline шаблоном

Плейсхолдеры в шаблонах: `{{RUNNER_TAG}}`, `{{DEFAULT_BRANCH}}`. Остальные параметры (порт, домен, путь) передаются через CI-переменные GitLab.

## 9. Типичные ошибки

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `409 Conflict: slug уже существует` | Проект с таким slug есть в реестре | Добавить `"force": true` или удалить + создать заново |
| `status: "partial"` | Часть шагов не выполнилась | `PUT /api/publish/projects/:slug/retry` |
| Pipeline "pending (stuck)" | Runner принимает задачи только с protected branches | Смержить в main |
| `git push` rejected: protected branch | Прямой push в main запрещён | Feature-ветка + Merge Request |
| `update-ci` затирает кастомный pipeline | `update-ci` применяет шаблон | Не использовать для кастомных проектов |
| `401 Требуется авторизация` | Невалидный или отсутствующий Bearer-токен | Проверить токен в UI "Токены" |
| `authelia: false` не работает для существующего сервиса | Traefik-конфиг не обновляется при retry | Удалить + перерегистрировать с `force: true` |

## 10. Связанные инструкции

- **[AGENT_PUBLISH.md](AGENT_PUBLISH.md) — основной документ для публикации (правила, сценарии, новый API).**
- [AGENT_PUBLISH_API.md](AGENT_PUBLISH_API.md) — контракт нового API (`/api/publish/service`, `/project`, `/verify`, `/rollback`).
- [AGENT_PUBLISH_AI.md](AGENT_PUBLISH_AI.md) — LLM-оркестратор `/api/publish/ai` (SSE).
- [AGENT_API_GUIDE.md](AGENT_API_GUIDE.md) — публикация контента через Strapi API.
- [AGENT_GITOPS.md](AGENT_GITOPS.md) — CI/CD деплой borisovai-admin.
- [AGENT_SERVICES.md](AGENT_SERVICES.md) — CRUD Traefik/DNS (низкоуровневое ручное вмешательство).
- [AGENT_ANALYTICS.md](AGENT_ANALYTICS.md) — интеграция Umami Analytics.

### AI-агент Management UI: доступные инструменты

Вместо curl можно использовать встроенные инструменты AI-агента (через UI "Агент"):

| Инструмент | Описание | Tier |
|------------|----------|------|
| `services_list` | Список Traefik-сервисов | auto |
| `service_create` | Создать Traefik-сервис | approve |
| `dns_list` | Список DNS-записей | auto |
| `dns_create` | Создать DNS-запись для всех base_domains | approve |
| `git_status` | Git status репозитория | auto |
| `git_commit` | Создать git коммит | approve |
| `git_push` | Git push в remote | approve |
| `monitoring_status` | Статус мониторинга сервисов | auto |
| `monitoring_check` | Немедленная проверка здоровья | auto |

Инструменты с tier `approve` требуют подтверждения администратора в UI перед выполнением.
