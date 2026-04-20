# AGENT_PUBLISH_API — контракт API публикации

Детальный контракт всех `POST /api/publish/*` endpoint'ов. Правила и сценарии — [AGENT_PUBLISH.md](AGENT_PUBLISH.md). LLM-loop — [AGENT_PUBLISH_AI.md](AGENT_PUBLISH_AI.md).

**Источник истины схем:** [management-ui/shared/src/validation/publish-schemas.ts](../../management-ui/shared/src/validation/publish-schemas.ts). Runtime endpoint `GET /api/publish/schema` отдаёт JSON Schema (auto-generated из zod).

---

## Аутентификация

Единственный способ — bearer-токен в заголовке `Authorization: Bearer <token>`. Scope `publish:write`. Cookie-сессии на `/api/publish/*` не принимаются.

```bash
TOKEN="<bearer>"
BASE="http://127.0.0.1:3000"  # с сервера
# или https://admin.borisovai.ru / https://admin.borisovai.tech
```

---

## Payload — единая схема

Все endpoint'ы публикации (`/service`, `/project`) принимают один и тот же payload, различаются только обязательные поля по `type`.

### Top-level поля

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `slug` | string | да | `^[a-z0-9]([a-z0-9-]*[a-z0-9])?$`, 1-63 символов |
| `type` | enum | да | `service` \| `deploy` \| `docs` \| `infra` \| `product` |
| `title` | string | да | Человекочитаемое имя, 1-200 символов |
| `description` | string | нет (default `""`) | До 1000 символов |
| `domain` | object | да | `{ prefix, middle? }`; оба TLD строятся автоматом |
| `backend` | object | по типу | `{ internalIp, port }` — обязателен для `service` |
| `appType` | enum | нет (default `frontend`) | `frontend` \| `backend` \| `fullstack` |
| `authelia` | object | нет | `{ enabled, policy, oidcClientId? }` |
| `ruProxy` | object | нет | `{ enabled, backendScheme }` |
| `dns` | object | нет | `{ ip: "auto"\|<ip>, recordType }` |
| `docker` | object | нет | `{ composePath, volumeName, volumeUid, volumeGid }` |
| `strapi` | object | по типу | `{ contentType, entry }` — для `docs`/`product` |
| `gitlab` | object | по типу | `{ projectId\|projectPath, template, variables, frontendEnv, backendEnv }` |
| `install` | object | нет | `{ scriptName, forceReinstall, preserveSecrets }` |
| `release` | object | нет | `{ version, changelog, artifacts[], setAsCurrent, ... }` — если указан, создаётся релиз в рамках публикации |
| `idempotencyKey` | string | да | Уникальный ключ прогона, 1-128 символов |
| `dryRun` | boolean | нет (default `false`) | План без выполнения |
| `force` | boolean | нет (default `false`) | Перезаписать существующий ресурс |

### Матрица обязательных блоков по type

| type | domain | backend | gitlab | strapi | install |
|---|:-:|:-:|:-:|:-:|:-:|
| `service` | ✅ | ✅ | — | — | опц. |
| `deploy` | ✅ | опц. | ✅ | — | — |
| `docs` | ✅ | — | ✅ | ✅ | — |
| `product` | ✅ | — | ✅ | ✅ | — |
| `infra` | ✅ | — | ✅ | опц. | — |

### Вложенные объекты

#### `domain`
```json
{ "prefix": "grafana", "middle": "dev" }
```
- `prefix` — первый сегмент (обязательно).
- `middle` — необязательный средний сегмент. Если указан, сохраняется в `/etc/install-config.json` как `<slug>_middle`.
- API сам подставляет `base_domains` → два полных домена.

#### `backend`
```json
{ "internalIp": "127.0.0.1", "port": 3000 }
```

#### `authelia`
```json
{ "enabled": true, "policy": "two_factor", "oidcClientId": "grafana" }
```
- `policy`: `bypass` \| `one_factor` \| `two_factor` (default).
- `oidcClientId` — нужен если сервис использует OIDC (а не только ForwardAuth). При `forceReinstall` — автоочистка SQLite OIDC-кеша.

#### `ruProxy`
```json
{ "enabled": true, "backendScheme": "https" }
```
- `backendScheme` — протокол на бэкенд (Traefik на Contabo). Обычно `https`, Caddy использует `tls_insecure_skip_verify`.

#### `dns`
```json
{ "ip": "auto", "recordType": "A" }
```
- `"auto"` → API сам определяет external IP сервера через helper.
- Иначе — любой валидный IP.

#### `docker`
```json
{ "composePath": "/etc/grafana/docker-compose.yml",
  "volumeName": "grafana-data",
  "volumeUid": 472, "volumeGid": 472 }
```
Если указан `volumeUid` — `docker.ensureVolume` tool `chown` volume перед первым `up -d`.

#### `strapi`
```json
{ "contentType": "docs",
  "entry": { "slug": "my-docs", "title": "Docs", "description": "..." } }
```
- `contentType`: `project` \| `docs` \| `product`.
- `entry` — произвольные поля Strapi content-type; API заполнит `slug` из top-level slug автоматически.

#### `gitlab`
```json
{ "projectPath": "group/my-app",
  "template": "frontend",
  "variables": { "CUSTOM_VAR": "value" },
  "frontendEnv": "NEXT_PUBLIC_API=https://api...",
  "backendEnv": "DB_URL=postgres://..." }
```
- `projectId` (number) или `projectPath` (string) — одно из двух.
- `template`: `frontend` \| `backend` \| `fullstack` \| `docs` \| `validate` \| `product`.
- `variables` — дополнительные к автогенерируемым (`DEPLOY_PATH`, `PM2_APP_NAME` и т.д.).
- `frontendEnv`/`backendEnv` — содержимое file-variables (тип File в GitLab, **masked в логах**).

#### `install`
```json
{ "scriptName": "grafana", "forceReinstall": false, "preserveSecrets": true }
```
- `scriptName` — базовое имя, API вызовет `scripts/single-machine/install-<scriptName>.sh` через `systemd-run`.
- `forceReinstall` → `--force` флаг.
- `preserveSecrets: true` (default) — сохраняет SMTP notifier Authelia, OIDC ключи, пользовательские правки.

#### `release`
Создаёт версию в рамках публикации — загружает артефакты и обновляет Strapi entry `version`/`changelog`/`downloads[]`. Подробности API — ниже в разделе [Release / Upload endpoints](#release--upload-endpoints).

```json
{
  "version": "v1.2.0",
  "changelog": "Исправлены баги...",
  "source": "ci",
  "action": "release",
  "setAsCurrent": true,
  "releasedAt": "2026-04-20T12:00:00Z",
  "artifacts": [
    {
      "artifact": {
        "sourceUrl": "https://ci.../artifacts/my-installer-1.2.0.exe",
        "filename": "my-installer-1.2.0.exe",
        "checksumSha256": "abc...",
        "sizeBytes": 52428800
      },
      "storage": { "kind": "downloads", "visibility": "public" },
      "label": "Windows installer",
      "platform": "windows"
    }
  ]
}
```

Поля:
- `version` — тег/семвер.
- `setAsCurrent` — обновлять ли поле текущей версии (иначе запись только в историю).
- `source` — `ci` \| `agent` \| `admin` \| `unknown` — кто инициировал.
- `action` — `release` \| `publish` \| `unpublish`.
- `artifacts[].artifact` — один из `sourceUrl`, `sourcePath`, `uploadHandle`.
- `artifacts[].storage` — где хранить: `kind` (`downloads`/`docs`/`media`/`custom`), `visibility` (`public`/`authelia`/`token`).

---

## POST /api/publish/service

Публикация инфраструктурного сервиса.

**Request:**
```bash
curl -X POST $BASE/api/publish/service \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d @payload.json
```

**Success (201):**
```json
{
  "publishId": "pub_01HXXXXXXX",
  "slug": "grafana",
  "status": "ok",
  "dryRun": false,
  "steps": [
    { "kind": "dns", "status": "ok", "startedAt": "...", "finishedAt": "...", "detail": "2 records created (grafana.dev on borisovai.ru, borisovai.tech)" },
    { "kind": "traefik", "status": "ok", "detail": "/etc/traefik/dynamic/grafana.yml written, rule covers both TLDs + authelia@file" },
    { "kind": "authelia", "status": "ok", "detail": "access_control + middleware + 4 scripts updated atomically" },
    { "kind": "ru_proxy", "status": "ok", "detail": "grafana.dev.borisovai.ru → https://grafana.dev.borisovai.tech" },
    { "kind": "docker_volume", "status": "ok", "detail": "grafana-data chowned to 472:472" },
    { "kind": "install_script", "status": "ok", "detail": "install-grafana.sh completed in 42s" },
    { "kind": "verify", "status": "ok", "detail": "both TLDs respond 302 to auth.*, SSL valid" }
  ],
  "errors": []
}
```

**Partial (207) / Failed (500):**
```json
{
  "publishId": "pub_01HXXXXXXX",
  "status": "partial",
  "steps": [
    { "kind": "dns", "status": "ok" },
    { "kind": "traefik", "status": "ok" },
    { "kind": "authelia", "status": "error",
      "error": "access_control update failed: /etc/authelia/configuration.yml not writable",
      "detail": "Step aborted; subsequent steps skipped. Fix and POST again with same idempotencyKey to resume." }
  ],
  "errors": ["authelia: /etc/authelia/configuration.yml not writable"]
}
```

**Guard rejection (400):**
```json
{
  "error": "TRAEFIK_GUARD_VIOLATION",
  "message": "Traefik rule must include all base_domains (borisovai.ru, borisovai.tech). Missing: borisovai.ru",
  "hint": "Pass only domain.prefix; API builds the rule. Do not pass a pre-built rule."
}
```

**Dry-run (200):**
`"dryRun": true` в payload → возвращается тот же объект, но все шаги в статусе `pending` с `detail` описанием планируемого действия и `before`/`after` предсказанием.

---

## POST /api/publish/project

Пользовательский GitLab-проект. Идентичен `/service` по payload, но обязателен блок `gitlab`.

Новый endpoint заменяет legacy `POST /api/publish/projects` (см. [AGENT_ORCHESTRATOR.md](AGENT_ORCHESTRATOR.md)). Legacy продолжает работать как thin-wrapper: маппинг старых полей (`gitlabProjectId`, `projectType`) в новый payload, `idempotencyKey` генерируется как `${slug}-legacy-${timestamp}`.

---

## POST /api/publish/verify/:slug

Проверка после публикации. Не требует payload.

**Response (200):**
```json
{
  "slug": "grafana",
  "overall": "ok",
  "checks": [
    { "name": "http-ru", "domain": "grafana.dev.borisovai.ru", "ok": true, "httpStatus": 302, "sslOk": true, "ssoRedirect": true },
    { "name": "http-tech", "domain": "grafana.dev.borisovai.tech", "ok": true, "httpStatus": 302, "sslOk": true, "ssoRedirect": true },
    { "name": "backend-health", "ok": true, "detail": "127.0.0.1:3000 returned 200" },
    { "name": "dns-both-tlds", "ok": true, "detail": "A-records resolved for both base_domains" },
    { "name": "authelia-rule", "ok": true, "detail": "access_control contains both domains" }
  ]
}
```

`overall`: `ok` (все OK) \| `degraded` (≥1 fail, критичные OK) \| `failed` (критичные fail).

---

## POST /api/publish/rollback/:publishId

Откат публикации. Обязательный payload:

```json
{ "confirmDestructive": true, "onlyKinds": ["dns", "traefik"] }
```

- `confirmDestructive` — обязательно `true` если среди шагов есть DELETE (DNS, Strapi entry, CI files).
- `onlyKinds` — опциональный массив, откатить только указанные виды шагов.

Rollback выполняется в **обратном порядке** добавления. Каждый tool имеет свой `rollback(stepState)`. Если rollback step сам падает — оставляет другие шаги как есть, возвращает `partial_rollback`.

---

## GET /api/publish/runs

Список последних прогонов. Query params:
- `limit` (default 50, max 200)
- `offset` (default 0)
- `slug` — фильтр по slug
- `status` — фильтр по статусу

**Response:**
```json
{
  "runs": [
    { "id": "pub_01...", "slug": "grafana", "type": "service", "status": "ok",
      "createdAt": "...", "updatedAt": "...", "dryRun": false }
  ],
  "total": 42
}
```

---

## GET /api/publish/runs/:id

Полный объект прогона (payload, все шаги, ошибки). Формат = `PublishRun` из `publish-schemas.ts`.

---

## GET /api/publish/schema

JSON Schema всех payload'ов — для генерации форм, внешних LLM, валидации CLI.

```json
{
  "publishPayload": { "$schema": "...", "type": "object", "properties": { ... } },
  "publishRun": { ... },
  "publishAiRequest": { ... },
  "verifyResult": { ... }
}
```

---

## Release / Upload endpoints

Отдельные endpoint'ы для управления релизами существующего проекта и загрузки артефактов. Используются, когда проект уже опубликован и нужно выпустить новую версию без повторной регистрации.

### POST /api/publish/releases/:slug

Создать релиз для существующего проекта.

**Request body** — [createReleaseRequestSchema](../../management-ui/shared/src/validation/publish-schemas.ts):

```json
{
  "idempotencyKey": "my-installer-v1.2.0",
  "dryRun": false,
  "updateStrapi": true,
  "publishToSite": false,
  "release": {
    "version": "v1.2.0",
    "changelog": "Исправлены баги...",
    "source": "ci",
    "action": "release",
    "setAsCurrent": true,
    "artifacts": [
      {
        "artifact": {
          "uploadHandle": "upl_01...",
          "filename": "my-installer-1.2.0.zip"
        },
        "storage": { "kind": "downloads", "visibility": "public" },
        "label": "Portable ZIP",
        "platform": "cross-platform"
      }
    ]
  }
}
```

**Success (201)** — `ReleaseInfo`:

```json
{
  "slug": "my-installer",
  "version": "v1.2.0",
  "action": "release",
  "source": "ci",
  "changelog": "Исправлены баги...",
  "releasedAt": "2026-04-20T12:00:00Z",
  "strapiDocumentId": "abc123",
  "strapiStatus": "draft",
  "artifacts": [
    {
      "filename": "my-installer-1.2.0.zip",
      "label": "Portable ZIP",
      "platform": "cross-platform",
      "sizeBytes": 524288000,
      "checksumSha256": "abc...",
      "storagePath": "/var/www/downloads/my-installer/v1.2.0/my-installer-1.2.0.zip",
      "downloadUrl": "https://my-installer.borisovai.tech/downloads/v1.2.0/my-installer-1.2.0.zip",
      "visibility": "public"
    }
  ],
  "createdAt": "2026-04-20T12:00:01Z"
}
```

**Шаги под капотом:**
1. `storage_upload` — загрузить/скачать каждый артефакт, проверить checksum, положить в `/var/www/<kind>/<slug>/<version>/<filename>`.
2. `strapi_release` — добавить запись в таблицу `releases` + обновить Strapi entry (`version`, `changelog`, `downloads[]`) если `updateStrapi: true`.
3. `strapi_publish` — если `publishToSite: true`, публикует draft сразу; иначе остаётся в draft.
4. `verify` — HEAD-запрос на `downloadUrl` каждого артефакта → 200.

### GET /api/publish/releases/:slug

История релизов проекта.

**Response:**
```json
{
  "releases": [
    { "version": "v1.2.0", "strapiStatus": "draft", "releasedAt": "...", "artifactsCount": 3 },
    { "version": "v1.1.0", "strapiStatus": "published", "releasedAt": "...", "artifactsCount": 2 }
  ],
  "current": "v1.1.0"
}
```

### PATCH /api/publish/releases/:slug/:version

Изменить статус или метаданные релиза.

```json
{ "action": "publish" }
// или
{ "action": "unpublish" }
// или
{ "changelog": "Обновлённое описание..." }
```

### DELETE /api/publish/releases/:slug/:version

Удалить релиз. Body обязателен:

```json
{
  "confirmDestructive": true,
  "removeArtifacts": true,
  "removeStrapi": false
}
```

- `removeArtifacts: true` — удалить файлы из storage.
- `removeStrapi: true` — удалить Strapi entry; `false` (default) — оставить entry, убрать только эту версию из `downloads[]`.

### POST /api/publish/uploads/init

Инициализировать resumable chunked upload.

**Request** — [uploadInitRequestSchema](../../management-ui/shared/src/validation/publish-schemas.ts):
```json
{
  "slug": "my-installer",
  "filename": "my-installer-1.2.0.zip",
  "sizeBytes": 524288000,
  "contentType": "application/zip",
  "checksumSha256": "abc...",
  "storage": { "kind": "downloads", "visibility": "public" },
  "version": "v1.2.0"
}
```

**Response:**
```json
{
  "uploadHandle": "upl_01HXXX...",
  "chunkSize": 8388608,
  "expiresAt": "2026-04-20T13:00:00Z"
}
```

- `chunkSize` — рекомендуемый размер chunk (обычно 8MB).
- `expiresAt` — истечение handle (1 час). После можно переинициализировать с тем же checksum → получить resume.

### PUT /api/publish/uploads/:handle/chunk?offset=<bytes>

Загрузить chunk. Body — raw `application/octet-stream`.

**Response (200):**
```json
{ "uploadHandle": "upl_01...", "offset": 8388608, "received": 8388608, "remaining": 515899392 }
```

При потере соединения клиент повторяет с последним подтверждённым `offset`.

### POST /api/publish/uploads/:handle/complete

Финализировать upload. API проверяет суммарный размер и checksum (sha256).

**Response (200):**
```json
{
  "uploadHandle": "upl_01...",
  "storagePath": "/var/www/downloads/my-installer/v1.2.0/my-installer-1.2.0.zip",
  "downloadUrl": "https://my-installer.borisovai.tech/downloads/v1.2.0/my-installer-1.2.0.zip",
  "checksumSha256": "abc...",
  "sizeBytes": 524288000
}
```

**Ошибки:**
- `400 CHECKSUM_MISMATCH` — sha256 не совпадает → upload отклонён, chunks удаляются.
- `400 SIZE_MISMATCH` — суммарный size != заявленному.
- `409 UPLOAD_EXPIRED` — handle истёк, переинициализировать.

`uploadHandle` после `complete` становится валидным для использования в `release.artifacts[].artifact.uploadHandle` в течение 24 часов.

---

## POST /api/publish/ai (SSE)

LLM-оркестратор. Детальный контракт — [AGENT_PUBLISH_AI.md](AGENT_PUBLISH_AI.md).

```bash
curl -N -X POST $BASE/api/publish/ai \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: text/event-stream" \
  -d '{ "prompt": "Опубликуй Grafana на grafana.dev с SSO", "approvals": "auto_safe" }'
```

Ответ — Server-Sent Events stream (`event: plan`, `tool_call`, `tool_result`, `approval_required`, `progress`, `done`, `error`).

---

## Коды ошибок

| HTTP | Код в body | Описание |
|---|---|---|
| 200 | — | Успех (с dryRun) |
| 201 | — | Публикация создана, все шаги `ok` |
| 207 | `PARTIAL_SUCCESS` | Часть шагов упала; возвращается `publishId` для retry |
| 400 | `VALIDATION_ERROR` | Payload не соответствует schema (zod errors в `details`) |
| 400 | `TRAEFIK_GUARD_VIOLATION` | Правило Traefik не содержит все base_domains |
| 400 | `AUTHELIA_GUARD_VIOLATION` | Authelia middleware без access_control rule |
| 400 | `DNS_DUPLICATE` | Существующая запись с другим IP |
| 400 | `DOCKER_VOLUME_PERMISSION` | Не удалось chown volume на заданный uid |
| 401 | `UNAUTHORIZED` | Отсутствует/невалидный bearer |
| 403 | `INSUFFICIENT_SCOPE` | Токен без `publish:write` |
| 409 | `RUN_IN_PROGRESS` | Прогон с этим idempotencyKey уже выполняется |
| 409 | `SLUG_EXISTS` | Слуг занят, передайте `force: true` |
| 422 | `CONFIG_DRIFT` | Реальное состояние не совпадает с registry (требует ручной intervention) |
| 400 | `CHECKSUM_MISMATCH` | sha256 артефакта не совпадает с заявленным |
| 400 | `SIZE_MISMATCH` | Суммарный размер upload != заявленному |
| 400 | `STORAGE_PATH_FORBIDDEN` | `storage.basePath` вне разрешённых баз |
| 404 | `RELEASE_NOT_FOUND` | Нет релиза с такой версией для этого slug |
| 409 | `RELEASE_VERSION_EXISTS` | Релиз с этой версией уже опубликован; используйте PATCH или другую версию |
| 409 | `UPLOAD_EXPIRED` | Upload handle истёк |
| 500 | `INTERNAL_ERROR` | Ошибка tool'а, логи в `/var/log/management-ui/` |

Тело ошибки:
```json
{
  "error": "VALIDATION_ERROR",
  "message": "Invalid payload",
  "details": [
    { "path": ["domain", "prefix"], "message": "Префикс домена обязателен" }
  ]
}
```

---

## Примеры end-to-end

### Публикация Grafana (service, с SSO, dry-run + execute)

```bash
# 1. Dry-run: увидеть план
curl -X POST $BASE/api/publish/service \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "slug": "grafana", "type": "service", "title": "Grafana",
    "domain": { "prefix": "grafana", "middle": "dev" },
    "backend": { "internalIp": "127.0.0.1", "port": 3000 },
    "authelia": { "enabled": true, "policy": "two_factor", "oidcClientId": "grafana" },
    "ruProxy": { "enabled": true },
    "docker": { "volumeName": "grafana-data", "volumeUid": 472, "volumeGid": 472 },
    "install": { "scriptName": "grafana" },
    "idempotencyKey": "grafana-init-v1",
    "dryRun": true
  }' | jq .

# 2. Выполнить
curl -X POST $BASE/api/publish/service \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @grafana-payload.json | jq .

# 3. Проверить
curl -X POST -H "Authorization: Bearer $TOKEN" \
  $BASE/api/publish/verify/grafana | jq .
```

### Публикация docs-проекта

```bash
curl -X POST $BASE/api/publish/project \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{
    "slug": "borisovai-docs",
    "type": "docs",
    "title": "Документация borisovai",
    "domain": { "prefix": "borisovai-docs" },
    "strapi": {
      "contentType": "docs",
      "entry": { "title": "Документация borisovai", "description": "Главная дока" }
    },
    "gitlab": { "projectPath": "borisovai/borisovai-docs", "template": "docs" },
    "idempotencyKey": "borisovai-docs-v1"
  }'
```

### Retry упавшего прогона

Если первый вызов вернул `status: partial`:

```bash
# Тот же payload, тот же idempotencyKey → API resume с упавшего шага
curl -X POST $BASE/api/publish/service \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d @grafana-payload.json   # idempotencyKey не менять
```

### Rollback

```bash
curl -X POST $BASE/api/publish/rollback/pub_01HXXXXXXX \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{ "confirmDestructive": true }'
```

---

## Rate limits

| Endpoint | Лимит |
|---|---|
| `POST /api/publish/service`, `/project` | 30/мин на токен |
| `POST /api/publish/releases/:slug` | 60/мин на токен |
| `PATCH /api/publish/releases/:slug/:version` | 60/мин на токен |
| `POST /api/publish/ai` | 5/мин на токен |
| `POST /api/publish/verify/:slug` | 60/мин на токен |
| `POST /api/publish/uploads/init` | 30/мин на токен |
| `PUT /api/publish/uploads/:handle/chunk` | без лимита (ограничение — max chunk size 32MB) |
| `GET /api/publish/runs`, `releases`, `schema` | 120/мин на токен |
