# AGENT_SERVICES — низкоуровневый CRUD Traefik/DNS

> Для **публикации** сервиса/проекта используйте [AGENT_PUBLISH.md](AGENT_PUBLISH.md) (единый API со всеми guards и 6-точечной Authelia). Этот документ — справочник по низкоуровневым endpoint'ам, нужным для ручного вмешательства (миграция порта, диагностика, удаление конкретной DNS-записи).
>
> Правила публикации (мульти-домен, Authelia checklist, idempotency DNS) — в `AGENT_PUBLISH.md` → раздел "Правила публикации". Не дублируются здесь.

Управление Traefik-сервисами и DNS-записями через Management UI API (Fastify v5).

## 1. Подключение

```
Base URL:  https://admin.borisovai.ru  или  https://admin.borisovai.tech  (или http://127.0.0.1:3000 с сервера)
Auth:      Bearer-токен (заголовок Authorization: Bearer <token>)
           ИЛИ Authelia ForwardAuth (автоматически при доступе через браузер за Authelia)
```

Токены создаются администратором на странице "Токены" или через `POST /api/auth/tokens`.

```bash
TOKEN="<bearer-token>"
BASE="http://127.0.0.1:3000"
AUTH="-H \"Authorization: Bearer $TOKEN\""
```

## 2. Сервисы (Traefik)

Management UI управляет Traefik через file provider: создает/редактирует YAML-конфиги в `/etc/traefik/dynamic/`. Traefik отслеживает изменения через watch и применяет их автоматически.

В GitOps-режиме конфиги хранятся в `config/contabo-sm-139/traefik/dynamic/` и доставляются через CI.

### GET /api/services -- список сервисов

```bash
curl -H "Authorization: Bearer $TOKEN" $BASE/api/services
```

Ответ (все роутеры из всех YAML, включая мульти-роутерные файлы):

```json
{
  "services": [
    {
      "name": "management-ui",
      "domain": "admin.borisovai.ru, admin.borisovai.tech",
      "ip": "127.0.0.1",
      "port": "3000",
      "authelia": true,
      "configFile": "management-ui.yml"
    },
    {
      "name": "site-api",
      "domain": "api.borisovai.ru, api.borisovai.tech",
      "ip": "127.0.0.1",
      "port": "4002",
      "authelia": false,
      "configFile": "site.yml"
    }
  ]
}
```

### POST /api/services -- создать сервис

```bash
curl -H "Authorization: Bearer $TOKEN" -X POST $BASE/api/services \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "domain": "my-app",
    "port": 4010,
    "authelia": false
  }'
```

| Параметр | Обязательный | По умолчанию | Описание |
|----------|-------------|--------------|----------|
| `name` | да | -- | Имя сервиса (имя YAML-файла) |
| `domain` | да | -- | Префикс домена или полный домен |
| `ip` | нет | `127.0.0.1` | IP бэкенда |
| `port` | да | -- | Порт бэкенда |
| `authelia` | нет | `false` | Защитить через Authelia SSO |

Создает `/etc/traefik/dynamic/<name>.yml`. При мульти-домене автоматически генерирует правило `Host(...) || Host(...)` для всех base_domains.

### PUT /api/services/:name -- обновить сервис

Все поля опциональны -- передаются только изменяемые.

```bash
curl -H "Authorization: Bearer $TOKEN" -X PUT $BASE/api/services/my-app \
  -H "Content-Type: application/json" \
  -d '{"port": 4011, "authelia": true}'
```

### DELETE /api/services/:name -- удалить сервис

```bash
curl -H "Authorization: Bearer $TOKEN" -X DELETE $BASE/api/services/my-app
```

Удаляет YAML-конфиг из `/etc/traefik/dynamic/`.

### GET /api/traefik/status -- статус Traefik

```bash
curl -H "Authorization: Bearer $TOKEN" $BASE/api/traefik/status
```

Возвращает runtime-данные из Traefik API (роутеры, сервисы, ошибки).

## 3. DNS записи

Management UI проксирует запросы в локальный DNS API (порт 5353), который управляет dnsmasq.

### GET /api/dns/records -- список записей

```bash
curl -H "Authorization: Bearer $TOKEN" $BASE/api/dns/records
```

```json
{
  "records": [
    {"id": "abc123", "subdomain": "my-app", "type": "A", "ip": "1.2.3.4", "domain": "borisovai.ru"}
  ]
}
```

### POST /api/dns/records -- создать запись

```bash
curl -H "Authorization: Bearer $TOKEN" -X POST $BASE/api/dns/records \
  -H "Content-Type: application/json" \
  -d '{"subdomain": "my-app", "ip": "1.2.3.4", "type": "A", "domain": "borisovai.ru"}'
```

| Параметр | Обязательный | По умолчанию | Описание |
|----------|-------------|--------------|----------|
| `subdomain` | да | -- | Поддомен (без base domain) |
| `ip` | да | -- | IP-адрес (для A-записи) |
| `type` | нет | `A` | Тип записи (A, CNAME и др.) |
| `domain` | да | -- | Базовый домен (`borisovai.ru` или `borisovai.tech`) |

### DELETE /api/dns/records/:id -- удалить запись

```bash
curl -H "Authorization: Bearer $TOKEN" -X DELETE $BASE/api/dns/records/abc123
```

## 4. Мульти-домен

Все сервисы доступны по двум базовым доменам: `borisovai.ru` и `borisovai.tech`.

- Источник: `/etc/install-config.json` -> `base_domains: "borisovai.ru,borisovai.tech"`
- При создании сервиса через `POST /api/services` Traefik rule автоматически включает оба домена
- DNS-записи нужно создавать отдельно для каждого base_domain
- `.ru` домены идут через RU Proxy (82.146.56.174), который проксирует на Contabo
- `.tech` домены идут напрямую на Contabo

Пример Traefik rule в YAML:
```yaml
rule: Host(`my-app.borisovai.ru`) || Host(`my-app.borisovai.tech`)
```

## 5. Authelia middleware

Для защиты сервиса через Authelia SSO:

1. При создании сервиса передать `"authelia": true` -- middleware `authelia@file` добавится в Traefik YAML
2. Добавить домены в Authelia `access_control` (`/etc/authelia/configuration.yml`)
3. Перезапустить Authelia: `systemctl restart authelia`

Проверка: при доступе без сессии пользователь перенаправляется на `auth.borisovai.ru`.

Bearer-токены Management UI проходят напрямую (минуя Authelia) -- агенты работают без SSO.

## 6. Типичные сценарии

### Добавить новый сайт

```bash
# 1. Создать сервис (Traefik конфиг с обоими доменами)
curl -H "Authorization: Bearer $TOKEN" -X POST $BASE/api/services \
  -H "Content-Type: application/json" \
  -d '{"name": "blog", "domain": "blog", "port": 4015}'

# 2. Создать DNS для .ru
curl -H "Authorization: Bearer $TOKEN" -X POST $BASE/api/dns/records \
  -H "Content-Type: application/json" \
  -d '{"subdomain": "blog", "ip": "1.2.3.4", "type": "A", "domain": "borisovai.ru"}'

# 3. Создать DNS для .tech
curl -H "Authorization: Bearer $TOKEN" -X POST $BASE/api/dns/records \
  -H "Content-Type: application/json" \
  -d '{"subdomain": "blog", "ip": "1.2.3.4", "type": "A", "domain": "borisovai.tech"}'
```

### Мигрировать сервис на другой порт

```bash
curl -H "Authorization: Bearer $TOKEN" -X PUT $BASE/api/services/blog \
  -H "Content-Type: application/json" \
  -d '{"port": 4020}'
```

### Проверить статус

```bash
# Traefik runtime
curl -H "Authorization: Bearer $TOKEN" $BASE/api/traefik/status

# Все сервисы
curl -H "Authorization: Bearer $TOKEN" $BASE/api/services

# DNS записи
curl -H "Authorization: Bearer $TOKEN" $BASE/api/dns/records
```

## 7. Инструменты агента

При работе через AI Agent (Management UI), доступны следующие tools:

| Tool | Уровень | Описание |
|------|---------|----------|
| `services_list` | auto | Получить список всех Traefik-сервисов |
| `service_create` | approve | Создать новый сервис (Traefik конфиг) |
| `service_delete` | approve | Удалить сервис |
| `dns_list` | auto | Получить список DNS-записей |
| `dns_create` | approve | Создать DNS-запись |
| `dns_delete` | approve | Удалить DNS-запись |

- **auto** -- выполняется без подтверждения (чтение)
- **approve** -- требует подтверждения пользователя (изменение)

## 8. Связанные инструкции

- **[AGENT_PUBLISH.md](AGENT_PUBLISH.md) — основной документ публикации (правила + новый API).**
- [AGENT_PUBLISH_API.md](AGENT_PUBLISH_API.md) — контракт endpoint'ов `/api/publish/*`.
- [AGENT_ORCHESTRATOR.md](AGENT_ORCHESTRATOR.md) — legacy endpoint `POST /api/publish/projects`.
- [AGENT_GITOPS.md](AGENT_GITOPS.md) — CI/CD деплой borisovai-admin.
- [AGENT_API_GUIDE.md](AGENT_API_GUIDE.md) — публикация контента через Strapi API.
