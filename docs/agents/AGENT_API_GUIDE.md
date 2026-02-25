# Agent API Guide — BorisovAI Blog Publishing

Практическое руководство для агента (бота, скрипта, Claude Code) по публикации заметок и потоков на сайт borisovai.tech через API.

## Подключение

```
Base URL:  https://api.borisovai.tech
Auth:      Authorization: Bearer <API_TOKEN>
Format:    Content-Type: application/json
```

> V1 plugin routes используют `content-api` тип маршрутов и принимают стандартные API токены Strapi. Убедись, что токен имеет права на `v1` plugin (`find`, `create` и т.д.) в настройках Settings → API Tokens.

## Быстрый старт: опубликовать заметку

```bash
curl -X POST https://api.borisovai.tech/api/v1/notes \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title_ru": "Заголовок на русском",
    "title_en": "Title in English",
    "content_ru": "Описание на русском",
    "content_en": "Description in English",
    "category": "feature_implementation",
    "tags": ["python", "api"],
    "source": "claude_code",
    "project": "my-project"
  }'
```

**Ответ (201):**

```json
{
  "id": "note_1738xxx_abc12",
  "title": "Заголовок на русском",
  "slug": "zagolovok-na-russkom",
  "url": "https://borisovai.tech/blog/zagolovok-na-russkom",
  "tags": ["python", "api"],
  "created_at": "2026-02-02T12:00:00.000Z"
}
```

Заметка сразу появляется на сайте: `url` из ответа.

## Поля заметки

### Обязательные (хотя бы одно из каждой пары)

| Поле | Тип | Описание |
|------|-----|----------|
| `title` или `title_ru` | string | Заголовок (ru). `title` = алиас для `title_ru` |
| `title_en` | string | Заголовок (en). Если не указан, используется `title_ru` |
| `content` или `content_ru` | string | Текст заметки (ru). `content` = алиас для `content_ru` |
| `content_en` | string | Текст (en). Если не указан, используется `content_ru` |

### Опциональные

| Поле | Тип | Описание |
|------|-----|----------|
| `content_html` / `content_html_ru` | string | HTML-версия контента (для рендера) |
| `content_html_en` | string | HTML-версия (en) |
| `category` | string | Категория (см. ниже). По умолчанию: `general` |
| `tags` | string[] | Массив тегов. Создаются автоматически если не существуют |
| `source` | string | Источник (см. ниже) |
| `project` | string | Название проекта |
| `image_url` | string | URL изображения |
| `metadata` | object | Произвольные метаданные (JSON) |
| `created_at` | string | ISO дата создания. По умолчанию: текущее время |

### Категории (`category`)

| Значение | Описание |
|----------|----------|
| `feature_implementation` | Новая функциональность |
| `bug_fix` | Исправление бага |
| `code_change` | Изменение кода |
| `debug_session` | Сессия отладки |
| `learning` | Обучение, исследование |
| `general` | Общее (по умолчанию) |

### Источники (`source`)

| Значение | Описание |
|----------|----------|
| `cursor_ide` | Cursor IDE |
| `claude_code` | Claude Code |
| `git_commit` | Git коммит |
| `clipboard` | Буфер обмена |
| `manual` | Ручная запись |

## Массовая публикация (batch)

До 50 заметок за один запрос:

```bash
curl -X POST https://api.borisovai.tech/api/v1/notes/batch \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "notes": [
      {
        "title_ru": "Первая заметка",
        "content_ru": "Контент 1",
        "category": "code_change",
        "tags": ["git"]
      },
      {
        "title_ru": "Вторая заметка",
        "content_ru": "Контент 2",
        "tags": ["python"]
      }
    ]
  }'
```

## Потоки (threads)

Поток — серия связанных заметок, объединённых общей темой:

```bash
curl -X POST https://api.borisovai.tech/api/v1/threads \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title_ru": "Разработка фичи X",
    "title_en": "Developing feature X",
    "description_ru": "Пошаговое описание разработки",
    "category": "feature_implementation",
    "project": "my-project",
    "tags": ["python", "api"],
    "notes": [
      {
        "title_ru": "Шаг 1: Планирование",
        "content_ru": "Описание планирования...",
        "tags": ["planning"]
      },
      {
        "title_ru": "Шаг 2: Реализация",
        "content_ru": "Описание реализации...",
        "tags": ["coding"]
      }
    ]
  }'
```

**Ответ (201):**

```json
{
  "id": "thread_1738xxx_abc12",
  "title": "Разработка фичи X",
  "slug": "razrabotka-fichi-x",
  "url": "https://borisovai.tech/threads/razrabotka-fichi-x",
  "notes": [
    { "id": "note_1738xxx_def34", "title": "Шаг 1: Планирование", "url": "https://borisovai.tech/blog/shag-1-planirovanie" },
    { "id": "note_1738xxx_ghi56", "title": "Шаг 2: Реализация", "url": "https://borisovai.tech/blog/shag-2-realizaciya" }
  ]
}
```

## Загрузка изображения

### Способ 1: Через v1 plugin (рекомендуется)

После создания заметки прикрепи изображение по `external_id`:

```bash
curl -X POST https://api.borisovai.tech/api/v1/notes/{note_id}/image \
  -H "Authorization: Bearer $API_TOKEN" \
  -F "image=@screenshot.png;type=image/png"
```

- `{note_id}` — значение `id` из ответа POST /api/v1/notes (например `note_1738xxx_abc12`)
- Поле формы: `image`, `file` или `files`
- Форматы: PNG, JPEG, GIF, WebP
- Макс. размер: 5 МБ
- Автоматически привязывает изображение к заметке и вызывает ревалидацию страницы

**Ответ (200):**

```json
{
  "image_url": "https://api.borisovai.tech/uploads/screenshot_abc123.png",
  "status": "uploaded"
}
```

### Способ 2: Через стандартный Strapi Upload API

Загрузка файла без привязки к записи:

```bash
curl -X POST https://api.borisovai.tech/api/upload \
  -H "Authorization: Bearer $API_TOKEN" \
  -F "files=@screenshot.png"
```

Загрузка с привязкой к заметке (нужен числовой `id` записи, не `documentId`):

```bash
curl -X POST https://api.borisovai.tech/api/upload \
  -H "Authorization: Bearer $API_TOKEN" \
  -F "files=@screenshot.png" \
  -F "ref=api::note.note" \
  -F "refId={числовой_id}" \
  -F "field=image"
```

> **Внимание:** `refId` — это числовой `id` из Strapi REST API (например `25`), а не `documentId` и не `externalId`. Для получения числового id используй: `GET /api/notes?filters[externalId][$eq]=note_xxx&fields[0]=id`

## Получение данных

### Заметка по external ID

```bash
curl https://api.borisovai.tech/api/v1/notes/{note_id} \
  -H "Authorization: Bearer $API_TOKEN"
```

### Поток по external ID

```bash
curl https://api.borisovai.tech/api/v1/threads/{thread_id} \
  -H "Authorization: Bearer $API_TOKEN"
```

## Альтернатива: прямая запись через Strapi REST API

Можно создавать контент напрямую через стандартный Strapi REST API (без v1 plugin):

### Создать тег

```bash
curl -X POST https://api.borisovai.tech/api/note-tags \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"data": {"name": "new-tag", "slug": "new-tag"}}'
```

### Создать заметку

```bash
curl -X POST https://api.borisovai.tech/api/notes \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "data": {
      "title": "Заголовок",
      "slug": "zagolovok",
      "content": "Текст заметки",
      "category": "code_change",
      "source": "claude_code",
      "project": "my-project",
      "tags": { "connect": ["documentId1", "documentId2"] }
    }
  }'
```

> **Внимание:** В Strapi REST API связи задаются через `documentId`, а не `id`. Сначала получи/создай теги, затем используй их `documentId` в поле `tags.connect`.

### Получить существующие теги

```bash
curl -g 'https://api.borisovai.tech/api/note-tags?sort[0]=name:asc' \
  -H "Authorization: Bearer $API_TOKEN"
```

### Получить заметки с фильтрами

```bash
# По тегу
curl -g 'https://api.borisovai.tech/api/notes?filters[tags][slug][$eq]=python&populate[0]=tags' \
  -H "Authorization: Bearer $API_TOKEN"

# По категории
curl -g 'https://api.borisovai.tech/api/notes?filters[category][$eq]=bug_fix&populate[0]=tags' \
  -H "Authorization: Bearer $API_TOKEN"

# С пагинацией
curl -g 'https://api.borisovai.tech/api/notes?pagination[page]=1&pagination[pageSize]=10&populate[0]=tags&populate[1]=thread' \
  -H "Authorization: Bearer $API_TOKEN"
```

## Коды ответов

| Код | Описание |
|-----|----------|
| 200 | Успешно (GET, batch) |
| 201 | Создано (POST note, thread) |
| 400 | Ошибка валидации (отсутствуют обязательные поля) |
| 401 | Неверный или отсутствующий токен |
| 404 | Заметка/поток не найден |
| 500 | Ошибка сервера |

## Теги

Теги создаются автоматически при публикации через v1 API. Если тег с таким именем уже существует, он переиспользуется. Slug генерируется автоматически из имени.

Текущие теги в системе:

| Тег | Slug |
|-----|------|
| api | api |
| clipboard | clipboard |
| commit | commit |
| cursor | cursor |
| git | git |
| ide | ide |
| javascript | javascript |
| python | python |
| security | security |

## Метаданные (`metadata`)

Произвольный JSON-объект для хранения дополнительной информации. Отображается на странице заметки. Известные поля:

```json
{
  "session_id": "abc-123",
  "git_branch": "feature/x",
  "duration_minutes": 45,
  "wiki_fact": "Интересный факт",
  "joke": "Шутка дня"
}
```

## Draft/Publish — контроль публикации

### Правило: всё создаётся как draft

Все записи, создаваемые агентами, должны создаваться как **draft** (`publishedAt: null`). Администратор публикует через Management UI (страница "Контент").

### Создание заметки как draft

```bash
curl -X POST https://api.borisovai.tech/api/v1/notes \
  -H "Authorization: Bearer $API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "title_ru": "Заголовок",
    "content_ru": "Контент",
    "publishedAt": null
  }'
```

### Обновление версий проектов

**НЕ обновляй** поля `version`, `downloadUrl` проектов через прямой Strapi API. Используй release endpoint Management UI:

```bash
curl -X POST https://admin.borisovai.tech/api/publish/projects/my-app/release \
  -H "Authorization: Bearer $MANAGEMENT_UI_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "version": "v1.2.0",
    "downloadUrl": "/downloads/my-app/",
    "source": "agent"
  }'
```

Это обновит Strapi как draft. Администратор опубликует через UI.

### Что можно делать напрямую через Strapi API

- Создание notes (с `publishedAt: null`)
- Создание threads (с `publishedAt: null`)
- Загрузка изображений
- Создание тегов

### Что НЕЛЬЗЯ делать напрямую через Strapi API

- Обновлять project version/downloadUrl (только через Management UI release endpoint)
- Публиковать записи (`publishedAt: new Date()`) — только администратор через UI

## Рекомендации для агента

1. **Всегда указывай `source`** — это помогает отслеживать откуда пришла заметка
2. **Используй `tags`** — они обеспечивают фильтрацию на сайте
3. **Указывай `project`** — группирует заметки по проекту
4. **Для связанных действий — создавай thread** вместо отдельных заметок
5. **Оба языка** — если возможно, указывай `title_ru`+`title_en` и `content_ru`+`content_en`
6. **content_html** — для форматированного контента передавай HTML-версию
7. **Проверяй ответ** — `url` из ответа можно использовать для подтверждения публикации
8. **Draft по умолчанию** — всегда передавай `publishedAt: null` для контроля публикации
9. **Версии проектов** — только через Management UI release endpoint, не через Strapi
