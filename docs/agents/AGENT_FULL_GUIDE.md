# Полное руководство агента: Management UI

Единый документ для AI-агента. Достаточно прочитать только этот файл, чтобы подготовить, задеплоить и мониторить проект.

## 1. Обзор системы

**Management UI** -- панель управления инфраструктурой сервера.

| Параметр | Значение |
|----------|----------|
| Стек | Fastify v5 (backend) + React 19 (frontend) |
| Порт | 3000 |
| Base URL | `https://admin.borisovai.ru/api/...` или `http://127.0.0.1:3000/api/...` |
| Базовые домены | `borisovai.ru`, `borisovai.tech` |
| Формат | `Content-Type: application/json` |

### Аутентификация

- **Bearer-токен** (предпочт.): `Authorization: Bearer <TOKEN>` -- агенты, скрипты, CI. Создаются в UI "Токены" или `POST /api/auth/tokens`. Проходят напрямую, минуя Authelia.
- **Authelia ForwardAuth**: `Remote-User: admin` (ставит Traefik) -- браузер через SSO.

### Мульти-домен

Все сервисы доступны по обоим доменам. Slug `my-app` создаёт DNS `my-app.borisovai.ru` + `my-app.borisovai.tech` и Traefik rule с обоими Host. Домены `.ru` идут через RU Proxy (82.146.56.174), `.tech` -- напрямую на Contabo.

## 2. Подготовка проекта

1. Создать/выбрать GitLab-проект (`https://gitlab.dev.borisovai.ru`). Запомнить `gitlabProjectId` или путь `group/name`.
2. Определить тип проекта:

| projectType | Описание | Что создаёт оркестратор |
|-------------|----------|------------------------|
| `deploy` | Веб-приложение | DNS + Traefik + директории + CI + CI-переменные + порт |
| `docs` | Документация | Strapi + директории + CI |
| `infra` | Инфра-проект | CI (валидация). Strapi опционально |
| `product` | Продукт с загрузками | Strapi + директории + CI + CI-переменные |

Для `deploy` дополнительно указать `appType`: `frontend` (default), `backend`, `fullstack`.

3. Подготовить код: `package.json` / `requirements.txt`, ветка `main`. Прямой push в protected branches запрещён -- feature-ветка + MR.

## 3. Регистрация проекта

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
    "description": "Описание",
    "authelia": true,
    "force": false
  }'
```

### Параметры

| Параметр | Тип | Обяз. | По умолч. | Описание |
|----------|-----|-------|-----------|----------|
| `slug` | string | да | -- | Уникальный ID (строчные, цифры, дефисы) |
| `gitlabProjectId` | number | да* | -- | ID проекта в GitLab |
| `gitlabProject` | string/number | да* | -- | Путь `"group/name"` или ID (альтернатива) |
| `projectType` | string | да* | -- | `deploy` / `docs` / `infra` / `product` |
| `type` | string | да* | -- | Альтернатива `projectType` |
| `appType` | string | нет | `frontend` | `frontend` / `backend` / `fullstack` |
| `title` | string | да | -- | Название проекта |
| `description` | string | нет | `""` | Описание |
| `authelia` | boolean | нет | `true` | Добавить Authelia middleware |
| `force` | boolean | нет | `false` | Перерегистрировать существующий slug |

*Обязательно одно из пары: `gitlabProjectId`/`gitlabProject`; `projectType`/`type`.

### Ответ

```json
{
  "success": true,
  "project": {
    "slug": "my-app",
    "status": "ok",
    "domain": "my-app.borisovai.ru,my-app.borisovai.tech",
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

- `status: "ok"` -- все шаги выполнены. `"partial"` -- есть ошибки.
- При `partial` -- вызвать `PUT /api/publish/projects/:slug/retry` для повторения неуспешных шагов.

## 4. Проверка результата

После регистрации проверить каждый компонент:

```bash
# 1. DNS-записи
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/dns/records | jq '.records[] | select(.subdomain=="my-app")'

# 2. Traefik-сервис
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/services | jq '.services[] | select(.name=="my-app")'

# 3. GitLab -- проверить что .gitlab-ci.yml и .gitlab/ci/pipeline.yml появились в репозитории

# 4. Мониторинг (если сервис уже запущен)
curl -X POST -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/monitoring/check/my-app
```

## 5. Кастомные CI-пайплайны

Шаблоны оркестратора рассчитаны на типовой стек (Next.js, Node.js). Для другого стека:

1. **Зарегистрировать проект** через оркестратор -- создаст DNS, Traefik, директории, CI-переменные
2. **Написать свой** `.gitlab/ci/pipeline.yml` под реальный стек
3. **Запушить** через feature-ветку + Merge Request
4. **Не использовать** `update-ci` -- он перезапишет кастомный pipeline шаблоном

Плейсхолдеры: `{{RUNNER_TAG}}`, `{{DEFAULT_BRANCH}}`. Остальные параметры передаются через CI-переменные GitLab.

## 6. Релизы и версионирование

### Записать релиз

```bash
curl -X POST http://127.0.0.1:3000/api/publish/projects/my-app/release \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{ "version": "v1.2.0", "changelog": "Новые функции", "source": "agent" }'
```

| Параметр | Тип | Обяз. | Описание |
|----------|-----|-------|----------|
| `version` | string | да | Версия (`v1.2.0`) |
| `downloadUrl` | string | нет | URL загрузки |
| `changelog` | string | нет | Описание изменений |
| `source` | string | нет | `ci` / `agent` / `admin` (default: `admin`) |

Релиз сохраняется как **draft** в Strapi. Публикация -- через Management UI администратором.

### Через CI (автоматически)

```
git tag v1.2.0 && git push --tags  ->  CI pipeline  ->
  POST /release (webhook)  ->  Strapi draft  ->  Админ публикует
```

### История релизов

```bash
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/publish/projects/my-app/releases
```

## 7. Управление сервисами

### Traefik-сервисы (CRUD)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/services` | Список всех роутеров |
| POST | `/api/services` | Создать сервис (`name`, `domain`, `port`, `ip?`, `authelia?`) |
| PUT | `/api/services/:name` | Обновить (передавать только изменяемые поля) |
| DELETE | `/api/services/:name` | Удалить |

### DNS-записи (CRUD)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/dns/records` | Список записей |
| POST | `/api/dns/records` | Создать (`subdomain`, `ip`, `type?`, `domain`) |
| PUT | `/api/dns/records/:id` | Обновить |
| DELETE | `/api/dns/records/:id` | Удалить |

DNS-записи нужно создавать **отдельно** для каждого base_domain (`.ru` и `.tech`).

## 8. Мониторинг

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/monitoring/status` | Статус всех сервисов + кол-во алертов |
| GET | `/api/monitoring/status/:name` | История проверок сервиса (24ч) |
| GET | `/api/monitoring/uptime?days=7` | Статистика аптайма |
| POST | `/api/monitoring/check` | Немедленная проверка всех сервисов |
| POST | `/api/monitoring/check/:name` | Проверка конкретного сервиса |
| GET | `/api/monitoring/alerts` | Список алертов (`?status=active&severity=critical`) |
| POST | `/api/monitoring/alerts/:id/ack` | Подтвердить алерт |
| POST | `/api/monitoring/alerts/:id/resolve` | Закрыть алерт |
| GET | `/api/monitoring/config` | Конфигурация мониторинга |
| PUT | `/api/monitoring/config` | Обновить конфигурацию |
| GET | `/api/monitoring/sse` | SSE-поток событий (status_change, new_alert) |

## 9. Безопасность

| Метод | Путь | Описание |
|-------|------|----------|
| Анализ логов Authelia | tool: `security_analyze` | Неудачные входы, brute force |
| Анализ трафика Traefik | tool: `security_traffic` | Подозрительные запросы, high rate |
| Сканирование конфигов | tool: `security_config_scan` | Отсутствие Authelia middleware |
| События безопасности | tool: `security_events` | Список с фильтрами |
| Блокировка IP | tool: `security_block_ip` | iptables (требует approve) |

Безопасность доступна через AI Agent tools (не через REST endpoints напрямую).

## 10. Типичные ошибки и решения

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `409 Conflict: slug уже существует` | Проект с таким slug в реестре | Добавить `"force": true` или DELETE + POST |
| `status: "partial"` | Часть шагов не выполнилась | `PUT /api/publish/projects/:slug/retry` |
| Pipeline "pending (stuck)" | Runner только для protected branches | Смержить в main |
| `git push` rejected | Protected branch | Feature-ветка + Merge Request |
| `update-ci` затирает кастомный pipeline | Применяет шаблон поверх кастома | Не вызывать для кастомных проектов |
| `401 Требуется авторизация` | Невалидный Bearer-токен | Проверить токен: `GET /api/auth/check` |
| Traefik 404 для `.ru` домена | Нет `.ru` в Traefik rule | Убедиться что оба домена в конфиге |
| Authelia 403 вместо 302 | Домен не в `access_control` | Добавить в Authelia configuration.yml |
| Docker volume permission denied | Контейнер не root (uid 1001) | `chown -R 1001:65533` на volume до запуска |

## 11. Чеклист: полный цикл проекта

1. Создать/выбрать GitLab-проект. Запомнить `gitlabProjectId`
2. Определить `projectType` и `appType`
3. Подготовить код (package.json, .gitignore, README)
4. `POST /api/publish/projects` -- зарегистрировать
5. Проверить DNS: `GET /api/dns/records`
6. Проверить Traefik: `GET /api/services`
7. Проверить CI: `.gitlab-ci.yml` в репозитории
8. Если кастомный стек -- написать свой `.gitlab/ci/pipeline.yml`
9. Push в feature-ветку, создать Merge Request, смержить в main
10. Дождаться CI pipeline, проверить деплой
11. Записать первый релиз: `POST /api/publish/projects/:slug/release`
12. Проверить здоровье: `POST /api/monitoring/check/:slug`

## 12. Справочник API

Все endpoints требуют авторизации (Bearer или Authelia), если не указано иное.

### Auth

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/auth/check` | Проверка авторизации (без auth) |
| GET | `/api/auth/tokens` | Список токенов (session only) |
| POST | `/api/auth/tokens` | Создать токен (session only) |
| DELETE | `/api/auth/tokens/:id` | Удалить токен (session only) |

### Services (Traefik)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/services` | Список сервисов |
| POST | `/api/services` | Создать сервис |
| PUT | `/api/services/:name` | Обновить сервис |
| DELETE | `/api/services/:name` | Удалить сервис |
| GET | `/api/traefik/status` | Runtime-статус Traefik |

### DNS

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/dns/records` | Список записей |
| POST | `/api/dns/records` | Создать запись |
| PUT | `/api/dns/records/:id` | Обновить запись |
| DELETE | `/api/dns/records/:id` | Удалить запись |

### Publish (проекты)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/publish/config` | Конфигурация оркестратора |
| GET | `/api/publish/projects` | Список проектов |
| POST | `/api/publish/projects` | Зарегистрировать проект |
| DELETE | `/api/publish/projects/:slug` | Удалить проект |
| PUT | `/api/publish/projects/:slug/retry` | Повторить неуспешные шаги |
| PUT | `/api/publish/projects/:slug/update-ci` | Обновить CI из шаблона |
| POST | `/api/publish/projects/:slug/release` | Записать релиз |
| GET | `/api/publish/projects/:slug/releases` | История релизов |

### GitLab

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/gitlab/projects` | Список проектов GitLab |

### Content (Strapi)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/content/drafts` | Список черновиков |
| PUT | `/api/content/:type/:id/publish` | Опубликовать |
| PUT | `/api/content/:type/:id/unpublish` | Снять с публикации |

### Monitoring

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/monitoring/config` | Конфигурация |
| PUT | `/api/monitoring/config` | Обновить конфигурацию |
| GET | `/api/monitoring/status` | Статус всех сервисов |
| GET | `/api/monitoring/status/:name` | История сервиса |
| GET | `/api/monitoring/uptime` | Статистика аптайма |
| POST | `/api/monitoring/check` | Проверить все сервисы |
| POST | `/api/monitoring/check/:name` | Проверить один сервис |
| GET | `/api/monitoring/alerts` | Список алертов |
| POST | `/api/monitoring/alerts/:id/ack` | Подтвердить алерт |
| POST | `/api/monitoring/alerts/:id/resolve` | Закрыть алерт |
| GET | `/api/monitoring/sse` | SSE-поток событий |

### RU Proxy

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/ru-proxy/status` | Статус RU Proxy |
| GET | `/api/ru-proxy/domains` | Список доменов |
| POST | `/api/ru-proxy/domains` | Добавить домен |
| PUT | `/api/ru-proxy/domains/:domain` | Обновить домен |
| DELETE | `/api/ru-proxy/domains/:domain` | Удалить домен |
| POST | `/api/ru-proxy/reload` | Перезагрузить Caddy |

### Tunnels (frp)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/tunnels/status` | Статус frps |
| GET | `/api/tunnels/proxies` | Активные прокси |
| GET | `/api/tunnels/config` | Конфигурация сервера (session) |
| GET | `/api/tunnels/client-config` | Скачать frpc.toml (session) |

### Analytics (Umami)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/analytics/status` | Статус Umami |

### Files

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/files/status` | Статус файлового хранилища |
| GET | `/api/files/browse?path=/` | Обзор директории |
| POST | `/api/files/upload?path=/` | Загрузить файл (multipart) |
| DELETE | `/api/files/delete` | Удалить файл |
| POST | `/api/files/mkdir` | Создать директорию |
| POST | `/api/files/rename` | Переименовать |

### Git

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/git/status` | Git status |
| GET | `/api/git/diff` | Git diff |
| GET | `/api/git/log` | Git log |
| POST | `/api/git/commit` | Создать коммит (session) |
| POST | `/api/git/push` | Git push (session) |
| POST | `/api/git/revert` | Git revert (session) |

### Authelia (пользователи)

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/authelia/users` | Список пользователей (session) |
| POST | `/api/authelia/users` | Создать пользователя (session) |
| PUT | `/api/authelia/users/:username` | Обновить (session) |
| POST | `/api/authelia/users/:username/password` | Сменить пароль (session) |
| DELETE | `/api/authelia/users/:username` | Удалить (session) |
| POST | `/api/authelia/users/apply` | Применить в Authelia config (session) |
| POST | `/api/authelia/users/sync` | Синхронизировать из config (session) |

### Agent

| Метод | Путь | Описание |
|-------|------|----------|
| GET | `/api/agent/sessions` | Список сессий |
| POST | `/api/agent/sessions` | Создать сессию |
| GET | `/api/agent/sessions/:id` | Получить сессию |
| DELETE | `/api/agent/sessions/:id` | Удалить сессию |
| GET | `/api/agent/sessions/:id/messages` | История сообщений |
| POST | `/api/agent/chat` | Отправить сообщение (SSE stream) |
| GET | `/api/agent/approvals` | Ожидающие подтверждения |
| POST | `/api/agent/approvals/:id/approve` | Одобрить |
| POST | `/api/agent/approvals/:id/deny` | Отклонить |
| GET | `/api/agent/tools` | Список инструментов |

## 13. Справочник инструментов агента

Доступны через AI Agent (POST `/api/agent/chat`). Tier определяет уровень подтверждения:
- **auto** -- выполняется без подтверждения
- **notify** -- выполняется автоматически, но логируется
- **approve** -- требует подтверждения администратора в UI

### Файлы и Shell

| Инструмент | Tier | Описание | Ключевые параметры |
|------------|------|----------|--------------------|
| `shell_exec` | auto/approve | Shell-команда (auto если `safe:true`) | `command`, `safe` |
| `file_read` | auto | Прочитать файл | `path`, `maxLines?` |
| `file_write` | approve | Записать файл | `path`, `content` |
| `file_list` | auto | Список файлов в директории | `path` |
| `file_delete` | approve | Удалить файл/директорию | `path` |
| `file_mkdir` | notify | Создать директорию | `path` |

### Сервисы и DNS

| Инструмент | Tier | Описание | Ключевые параметры |
|------------|------|----------|--------------------|
| `services_list` | auto | Список Traefik-сервисов | -- |
| `service_create` | approve | Создать сервис | `name`, `domain`, `port`, `ip?`, `authelia?` |
| `service_delete` | approve | Удалить сервис | `name` |
| `service_restart` | approve | Перезапустить systemd-сервис | `serviceName` |
| `dns_list` | auto | Список DNS-записей | -- |
| `dns_create` | approve | Создать DNS для всех base_domains | `subdomain`, `ip?` |
| `dns_delete` | approve | Удалить DNS-запись | `id` |

### Git

| Инструмент | Tier | Описание | Ключевые параметры |
|------------|------|----------|--------------------|
| `git_status` | auto | Git status | -- |
| `git_diff` | auto | Git diff | `staged?` |
| `git_log` | auto | Git log | `count?` |
| `git_commit` | approve | Создать коммит | `message`, `files?` |
| `git_push` | approve | Git push | -- |

### Мониторинг

| Инструмент | Tier | Описание | Ключевые параметры |
|------------|------|----------|--------------------|
| `monitoring_status` | auto | Статус всех сервисов | -- |
| `monitoring_history` | auto | История проверок сервиса | `serviceName`, `hours?` |
| `monitoring_uptime` | auto | Статистика аптайма | `days?` |
| `monitoring_check` | auto | Немедленная проверка | `serviceName?` |
| `alerts_list` | auto | Список алертов | `status?` |
| `alerts_acknowledge` | notify | Подтвердить алерт | `alertId` |

### Безопасность

| Инструмент | Tier | Описание | Ключевые параметры |
|------------|------|----------|--------------------|
| `security_analyze` | auto | Анализ логов Authelia | `hours?` (default: 6) |
| `security_traffic` | auto | Анализ трафика Traefik | `minutes?` (default: 60) |
| `security_config_scan` | auto | Сканирование конфигов на Authelia | -- |
| `security_events` | auto | Список событий безопасности | `severity?`, `limit?` |
| `security_block_ip` | approve | Блокировка IP через iptables | `ip`, `reason` |
