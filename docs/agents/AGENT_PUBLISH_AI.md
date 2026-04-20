# AGENT_PUBLISH_AI — LLM-оркестратор публикации

Описание `POST /api/publish/ai` — SSE-endpoint, где LLM (Claude, Anthropic SDK) оркестрирует публикацию через whitelist tools. Правила — [AGENT_PUBLISH.md](AGENT_PUBLISH.md). API-контракт — [AGENT_PUBLISH_API.md](AGENT_PUBLISH_API.md).

---

## Назначение

Пользователь (человек или внешний агент) описывает задачу на естественном языке:

> _"Опубликуй Grafana на grafana.dev как сервис с SSO, порт 3000"_

LLM внутри Management UI:
1. Читает system prompt (`AGENT_PUBLISH.md` + `AGENT_PUBLISH_API.md`, закешированы).
2. Задаёт уточняющие вопросы (если нужно) через event `question`.
3. Вызывает `publish_dry_run` с собранным payload → показывает план.
4. По `approvals` policy выполняет шаги через `publish_execute` или ждёт подтверждения на destructive операциях.
5. После завершения — `verify` и итоговый отчёт.

LLM **не пишет произвольный shell-код**. Она оперирует только tools, которые за неё вызывают guarded-обёртки над существующими helpers.

---

## Request

```http
POST /api/publish/ai HTTP/1.1
Authorization: Bearer <token>
Content-Type: application/json
Accept: text/event-stream

{
  "prompt": "Опубликуй Grafana на grafana.dev как сервис с SSO, порт 3000",
  "approvals": "auto_safe",
  "context": {
    "gitlabProjectPath": "group/grafana",
    "preferredType": "service"
  }
}
```

### Поля

| Поле | Тип | Обязательно | Описание |
|---|---|---|---|
| `prompt` | string | да | Естественный язык, 1-4000 символов |
| `approvals` | enum | нет | `auto_safe` (default) \| `manual` \| `auto_all` |
| `context.gitlabProjectPath` | string | нет | Подсказка LLM для `gitlab.projectPath` |
| `context.preferredType` | enum | нет | Подсказка для `type` |

### Approvals policy

| Режим | Поведение |
|---|---|
| `auto_safe` | Безопасные шаги (create DNS, Traefik, Authelia rule, push CI) — auto. Destructive (`force: true`, DELETE, rollback, rm volume) — требуют approval. |
| `manual` | Каждый tool-call требует approval. Для отладки или первого запуска. |
| `auto_all` | Всё auto, без approval. **Только для доверенных агентов** (CI pipeline, scheduled job). |

---

## SSE Response

Content-Type: `text/event-stream`. Каждое сообщение — `event: <name>\ndata: <json>\n\n`.

### Типы событий

#### `event: session`
Начало сессии. Содержит `runId` (если LLM решит выполнять) и список загруженных tools.
```json
{ "sessionId": "sess_01H...", "model": "claude-opus-4-7",
  "cacheHit": true, "tools": ["publish_dry_run", "publish_execute", "verify", ...] }
```

#### `event: thinking`
Промежуточные размышления LLM (extended thinking, если включено). Опционально, UI может не рендерить.

#### `event: question`
LLM задаёт уточняющий вопрос.
```json
{ "question": "Не указан порт сервиса. Обычно Grafana = 3000. Использовать 3000?",
  "options": ["3000", "Другой"] }
```
Клиент отправляет ответ через `POST /api/publish/ai/answer/:sessionId` (body: `{ "answer": "3000" }`).

#### `event: plan`
Собранный payload + план шагов. Эквивалент `dryRun: true` результата.
```json
{
  "runId": "pub_01H...",
  "payload": { "slug": "grafana", "type": "service", ... },
  "steps": [
    { "kind": "dns", "status": "pending", "detail": "Create A-records grafana.dev on borisovai.ru, borisovai.tech → auto-IP" },
    { "kind": "traefik", "status": "pending", "detail": "Write /etc/traefik/dynamic/grafana.yml with both TLDs + authelia@file" },
    { "kind": "authelia", "status": "pending", "detail": "Atomic update: access_control + middleware + 4 scripts" },
    ...
  ]
}
```

#### `event: tool_call`
LLM вызывает tool.
```json
{ "toolName": "publish_execute", "toolUseId": "toolu_01...",
  "args": { "payload": {...} } }
```

#### `event: tool_result`
Результат tool.
```json
{ "toolUseId": "toolu_01...", "isError": false,
  "result": { "publishId": "pub_01...", "status": "ok", ... } }
```

#### `event: approval_required`
Destructive step требует подтверждения.
```json
{ "runId": "pub_01...", "stepKind": "dns", "action": "delete",
  "detail": "Rollback will delete A-records for grafana.dev on both TLDs",
  "approvalId": "apr_01..." }
```
Клиент отвечает:
```http
POST /api/publish/ai/approve/:sessionId
{ "approvalId": "apr_01...", "decision": "approve" }
```

#### `event: progress`
Прогресс исполнения step.
```json
{ "runId": "pub_01...", "stepKind": "install_script",
  "progress": 0.6, "detail": "install-grafana.sh: downloading image 3/5" }
```

#### `event: done`
Завершение (успех или финальная ошибка).
```json
{ "runId": "pub_01...", "status": "ok",
  "summary": "Grafana опубликован. Доступен: https://grafana.dev.borisovai.tech (302 → SSO). Verify: all checks passed." }
```

#### `event: error`
Некорректный запрос или фатальная ошибка LLM-loop.
```json
{ "code": "LLM_TIMEOUT", "message": "Anthropic API timeout after 120s" }
```

---

## Tools для LLM

LLM имеет доступ только к whitelisted tools. Определения генерируются из `publish-schemas.ts` + runtime.

### Read-only (auto-invokable всегда)

| Tool | Описание |
|---|---|
| `list_services` | Список Traefik-сервисов |
| `list_dns_records` | Список DNS-записей |
| `list_ru_proxy_domains` | Домены RU Proxy |
| `get_gitlab_project` | Инфо о GitLab-проекте (`projectId` или `projectPath`) |
| `get_install_config` | Текущий `/etc/install-config.json` |
| `list_publish_runs` | Недавние прогоны |
| `list_releases` | История релизов проекта (версии, статусы, артефакты) |
| `get_release` | Детали конкретной версии |
| `get_publish_schema` | JSON-схема payload (для самоконтроля) |

### Mutation (guarded)

| Tool | Описание | Approval по умолчанию |
|---|---|---|
| `publish_dry_run` | Построить план из payload, без выполнения | auto |
| `publish_execute` | Выполнить план | auto_safe → auto, иначе manual |
| `publish_resume` | Resume по `idempotencyKey` | auto_safe → auto |
| `verify_deployment` | Проверка после публикации | auto |
| `create_release` | Создать релиз (upload + Strapi draft) | auto_safe → auto |
| `publish_release_to_site` | Опубликовать draft-релиз на сайте | **manual** (меняет публичный контент) |
| `unpublish_release` | Снять релиз с публикации | **manual** |
| `delete_release` | Удалить релиз + артефакты | **manual** |
| `upload_init` / `upload_complete` | Сервисные для resumable upload | auto |
| `rollback_publish` | Откат всех шагов | **manual** всегда |
| `force_reinstall_service` | Install с `--force` | **manual** всегда |

Каждый mutation-tool внутри вызывает соответствующие Publish Tools (`dns.createRecords`, `traefik.createRouter` и т.д.) с теми же guards — LLM не может обойти правила.

---

## Prompt caching

System prompt LLM = содержимое `AGENT_PUBLISH.md` + `AGENT_PUBLISH_API.md` + tool-definitions.

Backend при старте:
1. `fs.readFile` обоих документов.
2. Собирает system prompt.
3. Помечает блок `cache_control: { type: "ephemeral" }` (Anthropic prompt caching, TTL 5 мин).
4. Первый вызов за 5-минутное окно: cache miss, загружает ~30KB.
5. Последующие вызовы в окне: cache hit → дёшево и быстро.

Target cache hit rate >90%. `session` event содержит `cacheHit: boolean`.

При изменении документов админ делает `POST /api/publish/ai/invalidate-cache` (admin scope only) — сбрасывает кеш на backend stale-time.

---

## Безопасность и границы

- LLM вызывается через **backend**, не через браузер. Ключ Anthropic — в `/etc/management-ui/config.json`, masked в UI и логах.
- LLM **не имеет произвольного shell/exec доступа**. Tool whitelist hardcoded.
- Rate limit: 5 вызовов `/api/publish/ai` в минуту на токен.
- Audit log: каждый `tool_call` пишется в `audit_log` SQLite вместе с `sessionId`, `toolName`, `args`, `result`, `tokenId`.
- Destructive ops требуют `approvals: manual` или `confirmDestructive: true` в args — backend enforce'ит даже при `auto_all`.
- LLM-promt injection: user prompt sanitized, не попадает в system prompt. Tool args проходят zod-валидацию перед вызовом.

---

## Пример: полный флоу

**User prompt:**
> "Опубликуй Grafana на grafana.dev как сервис с SSO"

**SSE stream:**

```
event: session
data: {"sessionId":"sess_01H","model":"claude-opus-4-7","cacheHit":true,"tools":[...]}

event: tool_call
data: {"toolName":"list_services","args":{}}

event: tool_result
data: {"result":[{"name":"management-ui",...}],...}

event: tool_call
data: {"toolName":"get_install_config","args":{}}

event: tool_result
data: {"result":{"base_domains":["borisovai.ru","borisovai.tech"],...}}

event: question
data: {"question":"Использовать стандартный порт Grafana 3000?","options":["3000","Другой"]}

# клиент отвечает "3000" через /answer

event: tool_call
data: {"toolName":"publish_dry_run","args":{"payload":{"slug":"grafana",...}}}

event: plan
data: {"runId":"pub_01H","payload":{...},"steps":[...]}

event: tool_call
data: {"toolName":"publish_execute","args":{"runId":"pub_01H"}}

event: progress
data: {"stepKind":"dns","progress":0.5,"detail":"A-record on borisovai.ru created"}

event: progress
data: {"stepKind":"traefik","progress":1.0,"detail":"YAML written"}

event: approval_required
data: {"stepKind":"install_script","action":"run","detail":"install-grafana.sh --force will restart service"}

# клиент → /approve

event: progress
data: {"stepKind":"install_script","progress":0.8,"detail":"docker compose up -d"}

event: tool_call
data: {"toolName":"verify_deployment","args":{"slug":"grafana"}}

event: tool_result
data: {"result":{"overall":"ok","checks":[...]}}

event: done
data: {"runId":"pub_01H","status":"ok","summary":"Grafana опубликован..."}
```

---

## UI интеграция

Frontend `management-ui/frontend/src/pages/Publish.tsx`:
- Поле ввода prompt + select `approvals`.
- Live-стрим `plan`/`progress`/`tool_*`/`question` с inline форм-инпутом для answers.
- Approval-кнопки на `approval_required` events.
- После `done` — кнопки "Verify again", "Rollback", "Open service".

---

## Связанные документы

- [AGENT_PUBLISH.md](AGENT_PUBLISH.md) — правила публикации (загружается в system prompt).
- [AGENT_PUBLISH_API.md](AGENT_PUBLISH_API.md) — контракт tools и payload-схем.
