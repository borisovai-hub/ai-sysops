# Инструкция для агента: управление сервисами и DNS

Руководство по управлению Traefik-сервисами и DNS-записями через Management UI API.

## Подключение

```
Base URL:  https://admin.borisovai.ru  или  https://admin.borisovai.tech  (или http://127.0.0.1:3000 с сервера)
Auth:      Bearer-токен (рекомендуется) или Cookie-сессия
```

## Аутентификация

### Bearer-токен (рекомендуется для агентов)

Токены создаются администратором в UI (страница "Токены") или через API `POST /api/auth/tokens`.

```bash
# Все запросы с заголовком Authorization
curl -H "Authorization: Bearer <токен>" http://127.0.0.1:3000/api/services
```

### Cookie-сессия (альтернативный способ)

```bash
# Получить сессию
curl -c cookies.txt -X POST http://127.0.0.1:3000/login \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "password=<пароль из /etc/management-ui/auth.json>"

# Проверка авторизации
curl -b cookies.txt http://127.0.0.1:3000/api/auth/check
# Ответ: {"authenticated": true}
```

---

## Сервисы (Traefik)

Management UI управляет Traefik через file provider: создаёт/редактирует YAML-конфиги в `/etc/traefik/dynamic/`. Traefik отслеживает изменения через watch и применяет их автоматически.

**Мульти-домен**: при создании сервиса без явного домена, server.js автоматически генерирует домены для всех `base_domains` из `/etc/install-config.json` (например, `slug.borisovai.ru` и `slug.borisovai.tech`). Traefik rule содержит `Host(...) || Host(...)`. DNS-записи создаются для каждого базового домена.

### Получить список сервисов

```bash
curl -H "Authorization: Bearer <токен>" http://127.0.0.1:3000/api/services
```

Ответ (возвращаются все роутеры из каждого YAML, включая multi-router файлы вроде `site.yml`):

```json
{
  "services": [
    {
      "name": "management-ui",
      "domain": "admin.borisovai.ru, admin.borisovai.tech",
      "internalIp": "127.0.0.1",
      "port": "3000",
      "configFile": "management-ui.yml"
    },
    {
      "name": "site",
      "domain": "borisovai.ru, borisovai.tech",
      "internalIp": "127.0.0.1",
      "port": "4001",
      "configFile": "site.yml"
    },
    {
      "name": "site-api",
      "domain": "api.borisovai.ru, api.borisovai.tech",
      "internalIp": "127.0.0.1",
      "port": "4002",
      "configFile": "site.yml"
    }
  ]
}
```

### Создать сервис

```bash
curl -b cookies.txt -X POST http://127.0.0.1:3000/api/services \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "domain": "my-app.borisovai.ru",
    "backendHost": "127.0.0.1",
    "backendPort": 4010,
    "tls": true
  }'
```

| Параметр | Обязательный | Описание |
|----------|-------------|----------|
| `name` | да | Имя сервиса (используется как имя файла конфига) |
| `domain` | да | Домен для роутинга |
| `backendHost` | да | Хост бэкенда (обычно `127.0.0.1`) |
| `backendPort` | да | Порт бэкенда |
| `tls` | нет | Включить TLS через Let's Encrypt (по умолчанию `true`) |

Создаёт файл `/etc/traefik/dynamic/<name>.yml` с роутером и сервисом.

### Обновить сервис

```bash
curl -b cookies.txt -X PUT http://127.0.0.1:3000/api/services/my-app \
  -H "Content-Type: application/json" \
  -d '{
    "domain": "new-domain.borisovai.ru",
    "backendPort": 4011
  }'
```

### Удалить сервис

```bash
curl -b cookies.txt -X DELETE http://127.0.0.1:3000/api/services/my-app
```

Удаляет файл конфига из `/etc/traefik/dynamic/`.

### Статус Traefik

```bash
curl -b cookies.txt http://127.0.0.1:3000/api/traefik/status
```

Возвращает данные из Traefik API (порт 8080).

---

## DNS записи

Management UI управляет DNS через локальный DNS API (порт 5353), который работает с dnsmasq.

### Получить все записи

```bash
curl -b cookies.txt http://127.0.0.1:3000/api/dns/records
```

Ответ:

```json
{
  "records": [
    {
      "id": "abc123",
      "name": "my-app",
      "type": "A",
      "value": "1.2.3.4"
    }
  ]
}
```

### Создать запись

```bash
curl -b cookies.txt -X POST http://127.0.0.1:3000/api/dns/records \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-app",
    "type": "A",
    "value": "1.2.3.4"
  }'
```

| Параметр | Обязательный | Описание |
|----------|-------------|----------|
| `name` | да | Имя записи (поддомен, без base domain) |
| `type` | да | Тип записи (A, CNAME, и др.) |
| `value` | да | Значение записи (IP для A, домен для CNAME) |

### Обновить запись

```bash
curl -b cookies.txt -X PUT http://127.0.0.1:3000/api/dns/records/abc123 \
  -H "Content-Type: application/json" \
  -d '{
    "value": "5.6.7.8"
  }'
```

### Удалить запись

```bash
curl -b cookies.txt -X DELETE http://127.0.0.1:3000/api/dns/records/abc123
```

---

## Типичные сценарии

### Добавить новый сайт вручную (без оркестратора)

1. Создать DNS запись (A-запись на IP сервера)
2. Создать Traefik сервис (домен → localhost:порт)
3. Создать директорию и настроить приложение

```bash
# 1. DNS
curl -b cookies.txt -X POST http://127.0.0.1:3000/api/dns/records \
  -H "Content-Type: application/json" \
  -d '{"name": "blog", "type": "A", "value": "1.2.3.4"}'

# 2. Traefik
curl -b cookies.txt -X POST http://127.0.0.1:3000/api/services \
  -H "Content-Type: application/json" \
  -d '{"name": "blog", "domain": "blog.borisovai.ru", "backendHost": "127.0.0.1", "backendPort": 4015, "tls": true}'
```

### Проверить что сервис работает

```bash
# Статус Traefik
curl -b cookies.txt http://127.0.0.1:3000/api/traefik/status

# Список сервисов
curl -b cookies.txt http://127.0.0.1:3000/api/services

# DNS записи
curl -b cookies.txt http://127.0.0.1:3000/api/dns/records
```

### Миграция сервиса на другой порт

```bash
curl -b cookies.txt -X PUT http://127.0.0.1:3000/api/services/my-app \
  -H "Content-Type: application/json" \
  -d '{"backendPort": 4020}'
```

---

## Связанные инструкции

- [AGENT_ORCHESTRATOR.md](AGENT_ORCHESTRATOR.md) — автоматическая регистрация проектов (DNS + Traefik + CI за один запрос)
- [AGENT_GITOPS.md](AGENT_GITOPS.md) — CI/CD деплой borisovai-admin
- [AGENT_API_GUIDE.md](AGENT_API_GUIDE.md) — публикация контента через Strapi API
- [AGENT_PUBLISH_SETUP.md](AGENT_PUBLISH_SETUP.md) — настройка деплоя borisovai-site
