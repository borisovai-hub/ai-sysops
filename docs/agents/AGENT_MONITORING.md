# AGENT_MONITORING — мониторинг и безопасность

> **Scope:** наблюдение за уже развёрнутыми сервисами (health-check, алерты, security-сканы).
> Для публикации нового сервиса/проекта — [AGENT_PUBLISH.md](AGENT_PUBLISH.md). После публикации проверка идёт через `POST /api/publish/verify/:slug`.

Мониторинг состояния сервисов, анализ безопасности и реагирование на инциденты через Management UI API (Fastify v5).

## 1. Подключение

```
Base URL:  https://admin.borisovai.ru  или  https://admin.borisovai.tech  (или http://127.0.0.1:3000 с сервера)
Auth:      Bearer-токен (заголовок Authorization: Bearer <token>)
```

```bash
TOKEN="<bearer-token>"
BASE="http://127.0.0.1:3000"
```

## 2. Архитектура

MonitoringService следит за 9 сервисами: `traefik`, `authelia`, `frps`, `umami`, `dns-api`, `gitlab`, `strapi`, `ru-proxy`, `management-ui`.

- Health-чеки каждые 60 сек (настраиваемо), результаты в SQLite таблице `health_checks`
- Anti-flapping: алерт только после 2 последовательных ошибок
- Модульность: каждая подсистема (`healthChecks`, `security`, `sse`, `retention`) включается/выключается независимо
- Конфигурация в таблице `config_entries`, управляется через API
- Hot reload: изменение конфига через PUT не требует перезапуска

## 3. API Endpoints

Все endpoint-ы под `/api/monitoring`, требуют Bearer auth.

### Конфигурация

```bash
# Получить текущий конфиг
curl -H "Authorization: Bearer $TOKEN" $BASE/api/monitoring/config

# Обновить конфиг (hot reload)
curl -H "Authorization: Bearer $TOKEN" -X PUT $BASE/api/monitoring/config \
  -H "Content-Type: application/json" \
  -d '{"healthChecks": {"intervalMs": 30000}, "security": {"bruteForceThreshold": 3}}'
```

Структура MonitoringConfig:

```json
{
  "enabled": true,
  "healthChecks": { "enabled": true, "intervalMs": 60000, "services": [] },
  "security": {
    "enabled": true,
    "authLogIntervalMs": 300000,
    "trafficIntervalMs": 900000,
    "configScanIntervalMs": 3600000,
    "bruteForceThreshold": 5
  },
  "sse": { "enabled": true },
  "retention": {
    "healthCheckDays": 30,
    "alertDays": 90,
    "securityEventDays": 90
  }
}
```

Если `services` пустой массив -- мониторятся все 9 сервисов. Для выборочного мониторинга укажите список: `["traefik", "authelia"]`.

### Статус сервисов

```bash
# Все сервисы: последний статус + активные алерты + общий uptime
curl -H "Authorization: Bearer $TOKEN" $BASE/api/monitoring/status

# Один сервис: история за 24ч + uptime за 7 дней
curl -H "Authorization: Bearer $TOKEN" $BASE/api/monitoring/status/traefik

# Uptime всех сервисов за N дней
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/monitoring/uptime?days=7"
```

### Запуск проверок

```bash
# Проверить все сервисы сейчас
curl -H "Authorization: Bearer $TOKEN" -X POST $BASE/api/monitoring/check

# Проверить один сервис
curl -H "Authorization: Bearer $TOKEN" -X POST $BASE/api/monitoring/check/authelia
```

### Алерты

```bash
# Список алертов (фильтры опциональны)
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/monitoring/alerts?status=active&severity=critical&limit=50"

# Подтвердить алерт (acknowledge)
curl -H "Authorization: Bearer $TOKEN" -X POST $BASE/api/monitoring/alerts/42/ack

# Закрыть алерт (resolve)
curl -H "Authorization: Bearer $TOKEN" -X POST $BASE/api/monitoring/alerts/42/resolve
```

### SSE (Server-Sent Events)

```bash
curl -H "Authorization: Bearer $TOKEN" -N $BASE/api/monitoring/sse
```

События: `status_update` (периодический), `status_change` (сервис up/down), `new_alert`, `heartbeat`.

## 4. Security Service

Три типа анализа безопасности:

### Анализ логов Authelia

Парсит `journalctl` за указанный период. Обнаруживает неудачные входы и brute-force атаки.

```bash
curl -H "Authorization: Bearer $TOKEN" -X POST $BASE/api/monitoring/check \
  -H "Content-Type: application/json" \
  -d '{"type": "security", "action": "analyzeAutheliaLogs", "hours": 6}'
```

### Анализ трафика Traefik

Парсит `/var/log/traefik/access.log`. Находит подозрительные запросы (`.env`, `.git`, `wp-admin`), IP с аномально высоким rate, потоки 4xx ошибок.

### Аудит конфигурации

Проверяет Traefik-конфиги на отсутствие middleware `authelia@file` у сервисов, которые должны быть защищены.

### События безопасности

Все результаты сохраняются в таблице `security_events`.

```bash
curl -H "Authorization: Bearer $TOKEN" "$BASE/api/monitoring/security/events?severity=critical&limit=20"
```

## 5. Инструменты агента

При работе через AI Agent доступны 12 tools:

| Tool | Уровень | Параметры | Описание |
|------|---------|-----------|----------|
| `monitoring_status` | auto | -- | Последний статус всех сервисов |
| `monitoring_history` | auto | serviceName, hours | История проверок сервиса |
| `monitoring_uptime` | auto | days | Uptime всех сервисов |
| `monitoring_check` | auto | serviceName (опц.) | Запустить проверку |
| `security_analyze` | auto | hours | Анализ логов Authelia |
| `security_traffic` | auto | minutes | Анализ трафика Traefik |
| `security_config_scan` | auto | -- | Аудит конфигурации |
| `security_events` | auto | severity, limit | Список событий безопасности |
| `security_block_ip` | approve | ip, reason | Блокировка IP через iptables |
| `service_restart` | approve | serviceName | Перезапуск systemd-сервиса |
| `alerts_list` | auto | status | Список алертов с фильтром |
| `alerts_acknowledge` | notify | alertId | Подтверждение алерта |

Уровни:
- **auto** -- выполняется без подтверждения (чтение/анализ)
- **approve** -- требует подтверждения пользователя (блокировка IP, перезапуск)
- **notify** -- выполняется сразу, пользователь получает уведомление

## 6. Типичные сценарии

### Проверка состояния всех сервисов

```
1. monitoring_status → получить текущий статус
2. Если есть сервисы со статусом "down" → monitoring_history(serviceName, 1) → посмотреть когда упал
3. alerts_list(status="active") → проверить связанные алерты
```

### Расследование падения сервиса

```
1. monitoring_history(serviceName="authelia", hours=6) → найти момент падения
2. alerts_list(status="active") → найти алерт с деталями ошибки
3. Если нужно → service_restart(serviceName="authelia") (требует approve)
4. monitoring_check(serviceName="authelia") → проверить что поднялся
5. alerts_acknowledge(alertId) → закрыть алерт
```

### Аудит безопасности

```
1. security_analyze(hours=24) → проверить неудачные входы в Authelia
2. security_traffic(minutes=60) → проверить подозрительный трафик
3. security_config_scan() → найти сервисы без Authelia middleware
4. security_events(severity="critical") → просмотреть критические события
```

### Реагирование на вторжение

```
1. security_analyze(hours=1) → определить IP-адреса атакующих
2. security_traffic(minutes=15) → подтвердить аномальную активность
3. security_block_ip(ip="1.2.3.4", reason="brute force") (требует approve)
4. alerts_list(status="active") → найти связанные алерты
5. alerts_acknowledge(alertId) → подтвердить обработку
```

### Настройка мониторинга

```bash
# Включить только health checks, отключить security
curl -H "Authorization: Bearer $TOKEN" -X PUT $BASE/api/monitoring/config \
  -H "Content-Type: application/json" \
  -d '{"healthChecks": {"enabled": true}, "security": {"enabled": false}}'

# Уменьшить интервал проверок до 30 сек
curl -H "Authorization: Bearer $TOKEN" -X PUT $BASE/api/monitoring/config \
  -H "Content-Type: application/json" \
  -d '{"healthChecks": {"intervalMs": 30000}}'

# Мониторить только критичные сервисы
curl -H "Authorization: Bearer $TOKEN" -X PUT $BASE/api/monitoring/config \
  -H "Content-Type: application/json" \
  -d '{"healthChecks": {"services": ["traefik", "authelia", "gitlab"]}}'
```

Изменения применяются мгновенно (hot reload), перезапуск Management UI не нужен.

## 7. Хранение данных

| Таблица | Retention | Содержимое |
|---------|-----------|------------|
| `health_checks` | 30 дней | Результаты проверок (сервис, статус, latency, ошибка) |
| `alerts` | 90 дней | Алерты (severity, статус: active/acknowledged/resolved) |
| `security_events` | 90 дней | События безопасности (IP, тип атаки, детали) |
| `config_entries` | бессрочно | Конфигурация мониторинга |

Retention настраивается через `PUT /api/monitoring/config` -> секция `retention`.

## 8. Связанные инструкции

- [AGENT_SERVICES.md](AGENT_SERVICES.md) -- управление Traefik-сервисами и DNS
- [AGENT_ORCHESTRATOR.md](AGENT_ORCHESTRATOR.md) -- регистрация проектов
- [AGENT_GITOPS.md](AGENT_GITOPS.md) -- CI/CD деплой borisovai-admin
