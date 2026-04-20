# AGENT_PUBLISH — публикация сервисов и проектов

Единая точка входа для публикации в инфраструктуре borisovai-admin. Этот документ — источник истины правил для людей и для LLM. API читает `publish-schemas.ts`, LLM-агент загружает этот документ в system prompt (с prompt caching).

> **Статус**: Фаза 1 (контракт API, правила, сценарии). API-реализация — Фаза 2 (см. [docs/plans/PLAN_AI_PUBLISHER.md] после миграции).
> До готовности нового API используйте legacy-endpoint `POST /api/publish/projects` из [AGENT_ORCHESTRATOR.md](AGENT_ORCHESTRATOR.md) с чеклистами из раздела "Правила публикации" ниже.

---

## Quick Start

```
1. Получить bearer-токен          → UI "Токены" или POST /api/auth/tokens
2. Выбрать endpoint                → /api/publish/service или /api/publish/project
3. Собрать payload                 → обязательные поля по типу (см. "Сценарии")
4. POST с dryRun=true              → проверить план
5. POST без dryRun                 → выполнить
6. POST /api/publish/verify/:slug  → убедиться что всё работает
```

### Минимальный пример (сервис с SSO)

```bash
TOKEN="<bearer>"
curl -X POST http://127.0.0.1:3000/api/publish/service \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "slug": "grafana",
    "type": "service",
    "title": "Grafana",
    "domain": { "prefix": "grafana", "middle": "dev" },
    "backend": { "internalIp": "127.0.0.1", "port": 3000 },
    "authelia": { "enabled": true, "policy": "two_factor" },
    "ruProxy": { "enabled": true },
    "idempotencyKey": "grafana-init-v1"
  }'
```

---

## Endpoints

| Endpoint | Метод | Назначение |
|---|---|---|
| `/api/publish/service` | POST | Инфрасервис на сервере (DNS + Traefik + Authelia + RU Proxy + install-script) |
| `/api/publish/project` | POST | Пользовательский GitLab-проект (DNS + Traefik + Dir + CI + Strapi + release) |
| `/api/publish/verify/:slug` | POST | Curl обоих доменов, SSL, SSO redirect, health-check |
| `/api/publish/rollback/:publishId` | POST | Откат всех шагов в обратном порядке |
| `/api/publish/runs` | GET | Список последних публикаций |
| `/api/publish/runs/:id` | GET | Детали прогона (шаги, логи, ошибки) |
| `/api/publish/schema` | GET | JSON Schema всех payload'ов (для UI и внешних LLM) |
| `/api/publish/ai` | POST (SSE) | LLM-оркестратор: prompt → план → исполнение |
| `/api/publish/releases/:slug` | POST | Создать релиз: версия + changelog + артефакты + обновление Strapi |
| `/api/publish/releases/:slug` | GET | История релизов проекта |
| `/api/publish/releases/:slug/:version` | PATCH | Изменить release (publish/unpublish/updateChangelog) |
| `/api/publish/releases/:slug/:version` | DELETE | Удалить релиз (artifacts + Strapi draft) |
| `/api/publish/uploads/init` | POST | Инициализировать chunked upload артефакта, вернуть `uploadHandle` |
| `/api/publish/uploads/:handle/chunk` | PUT | Загрузить chunk (resumable) |
| `/api/publish/uploads/:handle/complete` | POST | Завершить upload, вернуть checksum и финальный путь |

Полный контракт, JSON-схемы и примеры ответов — [AGENT_PUBLISH_API.md](AGENT_PUBLISH_API.md).
LLM-оркестратор и формат SSE — [AGENT_PUBLISH_AI.md](AGENT_PUBLISH_AI.md).

---

## Правила публикации (нарушение = поломка)

Эти правила выведены из реальных ошибок (~60 fix-коммитов). API их **гарантирует кодом** через guards — отказывает в публикации, если правило нарушено. Документация объясняет **почему** — чтобы LLM и человек понимали, когда правило применимо.

### 1. Мульти-домен: каждый Traefik-роутер обязан содержать оба TLD

**Правило.** Любой роутер обязан иметь правило вида:

```yaml
rule: Host(`x.borisovai.ru`) || Host(`x.borisovai.tech`)
```

**Почему.** DNS для `.ru` указывает на RU Proxy (`82.146.56.174`), который проксирует на Contabo. Если в Traefik нет `.ru` домена — RU Proxy получит 404 от Traefik. Забытый `.ru` = неработающий сервис для российских пользователей.

**Как применяется.** `traefik.createRouter` tool отклоняет payload, если хотя бы один из `base_domains` (из `/etc/install-config.json`) не попал в rule. Пользователь/LLM передаёт только `domain.prefix`; оба TLD подставляются автоматом.

### 2. Authelia SSO: 6 точек обновляются атомарно

Если `authelia.enabled: true` — API обновляет **все 6 точек за один вызов** (раньше эти шаги делались вручную, каждый шаг-риск что забудут):

1. **Traefik router** — `middlewares: [authelia@file]`.
2. **Authelia `access_control`** — `/etc/authelia/configuration.yml`, правило для **обоих** доменов с указанной политикой.
3. **`install-authelia.sh`** — добавить домены в генерацию `access_control` (env `*_DOMAINS`).
4. **`deploy-authelia.sh`** — `_ensure_authelia_middleware` для нового YAML.
5. **`install-<service>.sh`** — генерация Traefik YAML включает `authelia@file`.
6. **`deploy-<service>.sh`** — аналогично.

**Почему.** Если обновить только Traefik middleware, но не добавить правило в `access_control` → Authelia вернёт 403 (не 302). Если не обновить install/deploy скрипты — при следующей переустановке middleware пропадёт. Пример регресса: analytics.dev.* получал 403 вместо 302 после добавления сервиса без `access_control`.

**При переустановке OIDC-клиента** (vikunja, strapi и т.п.) — **очистить SQLite OIDC-кеш Authelia**:

```sql
DELETE FROM oauth2_access_token_session;
DELETE FROM oauth2_authorization_code_session;
DELETE FROM oauth2_openid_connect_session;
DELETE FROM oauth2_pkce_request_session;
```

Иначе старые токены продолжают валидироваться по кешу. `authelia.registerRule` tool делает это автоматически при `forceReinstall: true`.

### 3. DNS: GET перед POST, запись для каждого base_domain

**Правило.** Перед созданием DNS записи — проверять существующие через `GET /api/dns/records`; создавать только отсутствующие. Для каждого base_domain — отдельная запись.

**Почему.** Повторный `POST` без проверки создаёт дубликаты → несколько A-записей на один домен, случайный выбор dnsmasq. Пример: коммит `1a3e0dc` добавил этот чек в install-umami.sh после продакшн-инцидента.

**Как применяется.** `dns.createRecords` tool: GET существующие → для каждого `(subdomain, base_domain)` создаёт запись если её нет с тем же IP; **никогда** не удаляет существующие (rollback делает отдельный tool с подтверждением).

### 4. Docker volumes: chown на uid контейнера до первого `up -d`

**Правило.** Контейнеры работают не как root (Umami uid=1001, Vikunja uid=1000). Volume при `docker volume create` принадлежит root. Без `chown` контейнер не может писать → restart loop.

**Как применяется.** `docker.ensureVolume` tool выполняет `docker run --rm --entrypoint='' <image> id` для определения uid/gid, затем `chown -R <uid>:<gid> <volume_path>` до первого `up -d`.

**Чек существующего контейнера** — `docker ps -a` (не `docker ps` — он показывает только running).

### 5. install-config.json: middle-сегмент сохранять

**Правило.** Dev-сервисы используют формат `<prefix>.<middle>.<base_domain>` (например `analytics.dev.borisovai.ru`). Middle-сегмент — не хардкод, а конфиг-переменная, которая **сохраняется в `/etc/install-config.json`** после первого ответа пользователя.

**Почему.** Без сохранения: повторный запуск install-скрипта снова спрашивает middle → риск, что человек ответит иначе → домены расходятся с существующими DNS.

**Как применяется.** `install.runScript` tool: проверяет `install-config.json`, если ключ `<service>_middle` отсутствует — требует передать в payload `domain.middle`; после выполнения — записывает в конфиг.

### 6. install-authelia.sh --force: preserve SMTP и секреты

**Правило.** Переустановка Authelia (`--force`) **не должна** перезаписывать SMTP notifier и секреты в `/etc/authelia/secrets/`.

**Почему.** SMTP настраивается вручную после первой установки (хост, порт, пароль Mailu). Regenerating → пустой notifier → Authelia не отправляет email-коды → пользователи не могут войти.

**Как применяется.** `install.runScript` tool передаёт `preserveSecrets: true` (по умолчанию) → install-скрипт читает текущий конфиг и мержит только новые поля.

### 7. Config repo: атомарные коммиты, additive-only при sync

**Правило.** Любой commit в `tools/server-configs` — атомарный: stash local → pull → apply → push. Sync из config repo на сервер — **additive-only**: не удаляет существующие DNS/Traefik записи, только добавляет/обновляет.

**Почему.** Прошлый инцидент: deploy-скрипт удалил 27 prod DNS записей потому что config repo содержал только тестовые (коммиты `0e78043`, `31337c7`). Теперь `configRepo.commit` не удаляет незарегистрированные в конфиге записи.

### 8. Multi-router YAML: поиск через findServiceConfig, не по имени файла

**Правило.** Один YAML файл может содержать несколько роутеров (`site.yml` → `site` + `site-api`, `analytics.yml` → `analytics-ru` + `analytics-tech`). PUT/DELETE/поиск — через `findServiceConfig(routerName)`, который сканирует все YAML внутри.

**Почему.** Попытка искать `analytics-ru.yml` провалится — файл называется `analytics.yml`. Два YAML на один домен (`admin.yml` + `management-ui.yml`) = конфликт приоритетов Traefik.

### 9. Обязательные CI-переменные по типу проекта

| Тип | Обязательные переменные |
|---|---|
| `deploy` | `DEPLOY_PATH`, `PM2_APP_NAME` |
| `docs` | `DOCS_DEPLOY_PATH`, `PROJECT_SLUG`, `MANAGEMENT_UI_URL`, `MANAGEMENT_UI_TOKEN` (masked) |
| `product` | `DOWNLOADS_PATH`, `PROJECT_SLUG`, `MANAGEMENT_UI_URL`, `MANAGEMENT_UI_TOKEN` (masked) |
| `infra` | — (только валидация) |

`*_ENV` переменные (`FRONTEND_ENV`, `BACKEND_ENV`) — тип **File** в GitLab, иначе содержимое утечёт в логи.

### 10. Релизы и версии: Strapi — единственный источник актуальной версии

**Правило.** Актуальная версия проекта и список всех версий хранятся в Strapi (в content-type `project`/`product`/`docs`). Агент **не пишет в Strapi напрямую** — только через API публикации (`POST /api/publish/releases/:slug` или блок `release` внутри `publish/project`). API сам обновляет поля `version`, `changelog`, `downloads[]` в entry и создаёт запись в таблице `releases` (история).

**Почему.** Ранее агенты обновляли Strapi напрямую — это приводило к расхождениям: Strapi содержал `v1.2`, а артефакт в `/var/www/downloads/` лежал от `v1.1`. Единый transactional release step: загрузка артефакта → обновление Strapi → добавление в history происходит atomically.

**`setAsCurrent: true`** — обновляет публикуемую версию проекта (default). `false` — добавляет запись только в историю версий, не меняя "текущую" (hotfix, preview).

**`publishToSite: false`** (default) — Strapi entry остаётся в draft, ждёт одобрения в UI. `true` — публикуется сразу (например, доверенный CI).

### 11. Артефакты: загрузка только через API upload, без ручного scp

**Правило.** Файлы продукта (инсталляторы, архивы) загружаются **только** через `/api/publish/uploads/*` или указанием `sourceUrl` в релизе. Запрещено: класть файлы напрямую в `/var/www/downloads/` в обход API.

**Почему.** API при upload:
- Проверяет checksum (sha256) — защита от битого transfer.
- Пишет в правильную базу (`/var/www/<kind>/<slug>/<version>/<filename>`) с правильными правами (`chown gitlab-runner`).
- Регистрирует файл в `releases.artifacts[]` → он попадает в Strapi `downloads[]` автоматически.
- Понимает `visibility` (public/authelia/token) и настраивает Traefik middleware соответственно.
- Откат (rollback release) корректно удаляет файлы.

Ручное копирование минует всё это — появляются "сиротские" файлы, не привязанные к релизу.

**Chunked resumable upload.** Большие файлы (>50MB) загружаются через три шага: `POST /uploads/init` → `PUT /uploads/:handle/chunk` (×N) → `POST /uploads/:handle/complete`. Клиент получает `uploadHandle`, который потом передаёт в `release.artifacts[].artifact.uploadHandle`.

Для CI artifacts (GitLab) и внешних ссылок (GitHub Releases) — указать `sourceUrl` в артефакте; API скачает сам.

### 12. Authentication: bearer-токен — единственный способ

**Правило.** API `/api/publish/*` принимает только `Authorization: Bearer <token>`. Токены — в `/etc/management-ui/auth.json`, создаются через UI "Токены" или `POST /api/auth/tokens`.

**Почему.** Cookie-сессии убраны после миграции на Authelia. Все вызовы публикации — машина-к-машине (CI, агент, LLM).

**Scope `publish:write`** — отдельная роль, не все токены её имеют (минимум привилегий для агентов).

---

## Сценарии

Каждый сценарий = минимальный payload + что произойдёт. Полная схема — [AGENT_PUBLISH_API.md](AGENT_PUBLISH_API.md).

### service — инфрасервис на сервере

Используется для добавления сервера-резидента: Grafana, Vikunja, Umami.

**Что делает API:** DNS (оба TLD) → Traefik (оба TLD + middleware) → Authelia (6 точек, если enabled) → RU Proxy домен → install-script (если указан) → verify.

**Payload:**

```json
{
  "slug": "grafana",
  "type": "service",
  "title": "Grafana",
  "description": "Мониторинг и дашборды",
  "domain": { "prefix": "grafana", "middle": "dev" },
  "backend": { "internalIp": "127.0.0.1", "port": 3000 },
  "authelia": { "enabled": true, "policy": "two_factor" },
  "ruProxy": { "enabled": true },
  "docker": { "volumeName": "grafana-data", "volumeUid": 472, "volumeGid": 472 },
  "install": { "scriptName": "grafana", "forceReinstall": false },
  "idempotencyKey": "grafana-v1"
}
```

### deploy — веб-приложение пользователя

Фронт или бэк с деплоем на сервер через GitLab CI.

**Что делает API:** allocate port → DNS → Traefik (c authelia если нужно) → mkdir /var/www/{slug} → push `.gitlab-ci.yml` + `.gitlab/ci/pipeline.yml` → CI variables (`DEPLOY_PATH`, `PM2_APP_NAME`).

```json
{
  "slug": "my-app",
  "type": "deploy",
  "title": "My App",
  "domain": { "prefix": "my-app" },
  "appType": "frontend",
  "authelia": { "enabled": false },
  "gitlab": {
    "projectPath": "group/my-app",
    "template": "frontend"
  },
  "idempotencyKey": "my-app-deploy-v1"
}
```

### docs — статическая документация

**Что делает API:** Strapi запись (draft) → mkdir /var/www/docs/{slug} → push CI → CI variables (`DOCS_DEPLOY_PATH`, `PROJECT_SLUG`, `MANAGEMENT_UI_URL`, `MANAGEMENT_UI_TOKEN`).

```json
{
  "slug": "my-docs",
  "type": "docs",
  "title": "Документация My App",
  "domain": { "prefix": "my-docs" },
  "strapi": {
    "contentType": "docs",
    "entry": { "slug": "my-docs", "title": "Документация My App" }
  },
  "gitlab": { "projectPath": "group/my-docs", "template": "docs" },
  "idempotencyKey": "my-docs-v1"
}
```

### product — продукт с загрузками

**Что делает API:** Strapi запись → mkdir /var/www/downloads/{slug} → CI (шаблон `product`) → CI variables (+ `DOWNLOADS_PATH`). Если передан блок `release` — сразу создаёт первый релиз, загружает артефакты и прописывает их в Strapi `downloads[]`.

```json
{
  "slug": "my-installer",
  "type": "product",
  "title": "My Installer",
  "domain": { "prefix": "my-installer" },
  "strapi": {
    "contentType": "product",
    "entry": { "title": "My Installer", "description": "CLI installer" }
  },
  "gitlab": { "projectPath": "group/my-installer", "template": "product" },
  "release": {
    "version": "v1.0.0",
    "changelog": "Первый публичный релиз",
    "source": "admin",
    "action": "release",
    "setAsCurrent": true,
    "artifacts": [
      {
        "artifact": { "sourceUrl": "https://ci.../job/42/artifacts/my-installer-1.0.0.exe",
                      "filename": "my-installer-1.0.0.exe" },
        "storage": { "kind": "downloads", "visibility": "public" },
        "label": "Windows installer",
        "platform": "windows"
      }
    ]
  },
  "idempotencyKey": "my-installer-v1.0.0"
}
```

### infra — только CI-валидация

**Что делает API:** push CI (шаблон `validate`) → Strapi (опционально). Без деплоя, DNS, Traefik.

```json
{
  "slug": "terraform-modules",
  "type": "infra",
  "title": "Terraform Modules",
  "domain": { "prefix": "terraform-modules" },
  "gitlab": { "projectPath": "infra/terraform-modules", "template": "validate" },
  "idempotencyKey": "tf-modules-v1"
}
```

---

## Идемпотентность и rollback

### idempotencyKey

Каждый запрос обязан содержать `idempotencyKey` (строка, 1-128 символов). API хранит прогоны в SQLite `publish_runs`. Повторный POST с тем же ключом:
- **run в статусе `ok`** → возвращает сохранённый результат (без повторных операций).
- **run в статусе `partial`/`failed`** → продолжает с упавшего шага (skip уже `ok`).
- **run в статусе `running`** → 409 Conflict.

Пример ключа: `grafana-init-v1`, `my-app-deploy-2026q2`, `hotfix-rollout-20260420`.

### Dry-run

`"dryRun": true` → API возвращает план (list of `Step[]`) без выполнения. Обязательно использовать перед первой публикацией, особенно через LLM.

### Rollback

`POST /api/publish/rollback/:publishId` — шаги исполняются в обратном порядке, каждый tool экспортирует `rollback(stepState)`. Destructive (DELETE DNS, rm volume) требует `confirmDestructive: true`.

---

## Релизы и версии (workflow)

Публикация проекта — это не только первичная регистрация. Это также **каждое обновление материала** на сайте (новая версия, обновлённый changelog, загрузка артефактов).

### Типичные сценарии

**A. Первая публикация с релизом (product):**

```bash
# Один запрос: создаст проект + upload артефактов + Strapi entry с downloads[]
curl -X POST $BASE/api/publish/project \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @product-initial.json
```

**B. Обновление версии (выпуск новой):**

```bash
# Проект уже зарегистрирован. Создаём новый релиз.
curl -X POST $BASE/api/publish/releases/my-installer \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "idempotencyKey": "my-installer-v1.1.0",
    "release": {
      "version": "v1.1.0",
      "changelog": "Исправлены баги установки на Windows 11",
      "source": "ci",
      "setAsCurrent": true,
      "artifacts": [
        { "artifact": { "sourceUrl": "https://ci.../my-installer-1.1.0.exe",
                        "filename": "my-installer-1.1.0.exe" },
          "storage": { "kind": "downloads", "visibility": "public" },
          "label": "Windows installer", "platform": "windows" }
      ]
    },
    "updateStrapi": true,
    "publishToSite": false
  }'
```

Response — [ReleaseInfo](../../management-ui/shared/src/validation/publish-schemas.ts): ссылки на `downloadUrl`, checksum, `strapiStatus: "draft"`.

**C. Публикация draft-релиза (после модерации):**

```bash
curl -X PATCH $BASE/api/publish/releases/my-installer/v1.1.0 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "action": "publish" }'
```

**D. Откат релиза (unpublish + удаление артефактов):**

```bash
curl -X DELETE $BASE/api/publish/releases/my-installer/v1.1.0 \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "confirmDestructive": true, "removeArtifacts": true }'
```

### Chunked upload больших артефактов

Для файлов >50MB или сетей с потерями используется 3-шаговый resumable upload:

```bash
# 1. Init — вернёт uploadHandle
curl -X POST $BASE/api/publish/uploads/init \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "slug": "my-installer",
    "filename": "my-installer-1.2.0.zip",
    "sizeBytes": 524288000,
    "contentType": "application/zip",
    "checksumSha256": "<sha256>",
    "storage": { "kind": "downloads", "visibility": "public" },
    "version": "v1.2.0"
  }'
# → { "uploadHandle": "upl_01...", "chunkSize": 8388608, "expiresAt": "..." }

# 2. Chunks (повторяемые, с offset)
curl -X PUT "$BASE/api/publish/uploads/upl_01.../chunk?offset=0" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @chunk0.bin

# 3. Complete — проверяет checksum, кладёт файл в storage
curl -X POST $BASE/api/publish/uploads/upl_01.../complete \
  -H "Authorization: Bearer $TOKEN"
# → { "storagePath": "/var/www/downloads/my-installer/v1.2.0/my-installer-1.2.0.zip",
#     "downloadUrl": "https://my-installer.borisovai.tech/downloads/...",
#     "checksumSha256": "..." }

# 4. Использовать handle в релизе
curl -X POST $BASE/api/publish/releases/my-installer \
  -d '{ "idempotencyKey": "...", "release": { ...,
        "artifacts": [{ "artifact": { "uploadHandle": "upl_01...",
                                      "filename": "my-installer-1.2.0.zip" },
                        "storage": { "kind": "downloads", "visibility": "public" },
                        "label": "Portable ZIP", "platform": "cross-platform" }] } }'
```

### Источники артефактов

| Источник | Поле в `artifact` | Когда использовать |
|---|---|---|
| Resumable upload | `uploadHandle` | Большие файлы, ручная загрузка из UI, нестабильная сеть |
| Внешний URL | `sourceUrl` | GitHub Releases, внешние CDN — API скачает и перепроверит |
| CI artifact | `sourceUrl` с GitLab API токеном | GitLab Runner job artifacts (добавить `Private-Token` в config) |
| Локальный путь | `sourcePath` | Только при вызове с сервера (install-скрипт, self-hosted runner) |

### Storage layout и visibility

Путь артефакта формируется:
```
/var/www/<kind>/<slug>/<version>/<filename>
```

- `kind: "downloads"` → `/var/www/downloads/<slug>/<version>/<file>` → URL `https://<slug>.borisovai.tech/downloads/<version>/<file>`
- `kind: "docs"` → `/var/www/docs/<slug>/<version>/<file>` → URL `https://<slug>-docs.borisovai.tech/...`
- `kind: "media"` → `/var/www/media/<slug>/<file>` (без версии, общая медиа-библиотека)
- `kind: "custom"` → требует явный `basePath` + валидация, что он в разрешённой базе

**Visibility:**
- `public` — без middleware, прямой Traefik. Для публичных загрузок.
- `authelia` — Traefik + `authelia@file`, только залогиненные пользователи.
- `token` — custom middleware с проверкой bearer-токена (для CI-скачивания).

---

## Verification

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://127.0.0.1:3000/api/publish/verify/grafana
```

Проверяет:
- `https://<prefix>.<middle>.borisovai.ru` — HTTP 200 или 302 (если SSO).
- `https://<prefix>.<middle>.borisovai.tech` — то же.
- SSL-сертификат выдан (Let's Encrypt на Contabo, auto-LE на RU Proxy).
- Если `authelia.enabled` — редирект на `auth.borisovai.ru`/`.tech` (302).
- Если `backend.port` — локальный `curl http://127.0.0.1:<port>/` возвращает не-5xx.

---

## Типичные ошибки и как их избежать

| Ошибка | Причина | Решение |
|---|---|---|
| `409 slug exists` | Повторная публикация без `force` или неверный `idempotencyKey` | Уникальный ключ или `"force": true` |
| `400 traefik guard: missing .ru domain` | Ручной payload с готовым Traefik-rule | Передавать только `domain.prefix`, API построит rule сам |
| `500 authelia: access_control missing domain` | Guard сработал до записи: конфиг уже повреждён вручную | Запустить `install-authelia --force` с `preserveSecrets: true` |
| `500 dns: duplicate record` | Запись существует с другим IP | Удалить вручную через `/api/dns/records/:id` и повторить |
| `500 docker volume permission denied` | Volume создан без chown | Передать `docker.volumeUid`/`volumeGid`; API выполнит chown |
| `status: partial, step=ci: 401 GitLab API` | `GITLAB_TOKEN` не передан/истёк | Обновить токен в `/etc/management-ui/config.json` |
| `verify: SSL handshake failed` | Let's Encrypt не выпустил сертификат (DNS ещё не распространился) | Подождать 1-2 мин, повторить verify |

---

## Для LLM-агента

Этот документ + [AGENT_PUBLISH_API.md](AGENT_PUBLISH_API.md) загружаются в system prompt LLM-агента (`POST /api/publish/ai`) с включённым prompt caching. Подробности формата SSE, approval-gate, tool-definitions — [AGENT_PUBLISH_AI.md](AGENT_PUBLISH_AI.md).

Базовая стратегия LLM:
1. Читает user prompt ("опубликуй Grafana на grafana.dev с SSO").
2. Вызывает `publish_dry_run` → показывает план пользователю.
3. При `approvals: manual` — ждёт approval на каждый destructive шаг.
4. При `approvals: auto_safe` — auto-approve для `dns/traefik/authelia/create`, manual для `rollback/DELETE/force`.
5. По завершению — `verify` и возврат отчёта.

---

## Связанные документы

- [AGENT_PUBLISH_API.md](AGENT_PUBLISH_API.md) — JSON-схемы, примеры запросов и ответов по каждому endpoint.
- [AGENT_PUBLISH_AI.md](AGENT_PUBLISH_AI.md) — формат LLM-loop, SSE-события, approval-gate.
- [AGENT_ORCHESTRATOR.md](AGENT_ORCHESTRATOR.md) — legacy endpoint `POST /api/publish/projects` (thin-wrapper над новым).
- [AGENT_SERVICES.md](AGENT_SERVICES.md) — низкоуровневый CRUD Traefik/DNS для ручного вмешательства.
- [AGENT_GITOPS.md](AGENT_GITOPS.md) — CI/CD borisovai-admin самого (отдельная тема).
