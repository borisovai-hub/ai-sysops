# PLAN: Мульти-серверная инфраструктура — реестр серверов, node-agent, mTLS и единый мониторинг

## Цель

Управлять несколькими серверами (`contabo-sm-139`, `firstvds-sm-22`, …) из одной админки на `contabo-sm-139`:

1. **Свой PKI** на базе step-ca — внутренний CA для выдачи короткоживущих (24h) клиентских и серверных сертификатов с автоматической ротацией.
2. **Node-agent** — лёгкий HTTPS-сервис на каждом сервере, аутентификация через mTLS поверх собственного CA.
3. **Реестр серверов** в management-ui — список управляемых хостов и их метаданных.
4. **Единый мониторинг** — главный management-ui опрашивает агенты и показывает статус всей инфраструктуры одной страницей.
5. **Реестр конфигов** остаётся GitOps-репой [server-configs](c:/projects/server-configs/) (`servers/<name>/`); агент применяет то, что лежит в репо после `git pull`.

Управление публикацией (DNS / Traefik / GitLab CI) на этом этапе остаётся single-server (на primary). Multi-server publish — отдельный план, не входит в эту итерацию.

---

## Архитектура

```
                    ┌─────────────────────────────────────┐
                    │  step-ca (contabo-sm-139, :9000)    │
                    │  root (offline) ─ intermediate      │
                    │  ACME + JWK provisioners            │
                    └────────────┬────────────────────────┘
                                 │ выдаёт mTLS-серты (24h)
                ┌────────────────┼────────────────┐
                ▼                ▼                ▼
       ┌─────────────┐  ┌─────────────┐  ┌──────────────────┐
       │ admin client│  │ node-agent  │  │ node-agent       │
       │ cert (24h)  │  │ contabo-sm- │  │ firstvds-sm-22   │
       │             │  │ 139 (:7180) │  │ (:7180)          │
       └──────┬──────┘  └─────────────┘  └──────────────────┘
              │ mTLS HTTPS                         ▲
              └────────────────────────────────────┘
                  (через frp-туннель к secondary)
```

- **Транспорт**: HTTPS + mTLS. Сервер-cert на агенте, клиент-cert на admin'е, оба от нашего step-ca. Bearer-токены и HMAC не нужны — cert аутентифицирует обе стороны.
- **Ротация**: cert lifetime 24h, auto-renew через `step ca renew` (timer/cron) за 8h до истечения.
- **Бутстрап нового сервера**: одноразовый JWK-токен генерируется в админке → передаётся при установке агента → агент делает первичный enroll → дальше ротирует сам.
- **Транспорт к secondary**: frp-туннель `agent.<server>.tunnel.borisovai.ru` (TLS терминируется на самом агенте — Traefik в TCP-passthrough режиме, чтобы mTLS работал end-to-end).

---

## Компоненты

### 0. step-ca (PKI)

Self-hosted CA на primary (`contabo-sm-139`).

**Установка**: `scripts/single-machine/install-step-ca.sh [--force]`
- Скачивает `step-ca` и `step` бинари (Debian repo / GitHub release).
- `step ca init` — генерирует root + intermediate, root экспортируется в `/etc/step-ca/root-backup/` (потом переносится оффлайн вручную).
- Конфиг `/etc/step-ca/config/ca.json`: имя CA `borisovai-internal`, listen `127.0.0.1:9000` + проброс через frp `ca.tunnel.borisovai.ru` для удалённого enroll.
- Provisioners:
  - **JWK** `admin-bootstrap` — для одноразового enroll новых агентов (токен выдаётся через UI).
  - **ACME** `agents` — для авто-обновления cert после первичного enroll.
  - **OIDC** `authelia` (опционально, фаза 5) — выдача admin-client-cert через Authelia SSO.
- Systemd unit `step-ca.service`.

**Конфиг**: `/etc/step-ca/policy.json`:
- Разрешённые SANs: `*.borisovai.ru`, `*.tunnel.borisovai.ru`, `agent-<server>.internal`.
- Lifetime: default 24h, max 24h, renewal-grace 8h.
- Disable password file — root key энкриптится provisioner password (хранится только в `/etc/step-ca/secrets/`).

**Backup**: ежедневный tar `/etc/step-ca/secrets/` + `/etc/step-ca/db/` в `/var/backups/step-ca/`. Root приватник — оффлайн (флешка / зашифрованный архив).

### 1. Node-agent (`management-ui/node-agent/`)

Маленький Fastify-сервис (HTTPS only, mTLS), отдельный package в монорепо.

**Запуск**: HTTPS на `127.0.0.1:7180` (для primary) или `0.0.0.0:7180` за frp-туннелем (для secondary). TLS-сертификаты:
- Server cert: `/etc/node-agent/certs/agent.crt` (от step-ca, SAN = `agent-<server>.internal` + `agent.<server>.tunnel.borisovai.ru`).
- CA bundle для проверки клиентов: `/etc/node-agent/certs/ca.crt` (root + intermediate от step-ca).
- Auto-renew: systemd timer `node-agent-cert-renew.timer` каждые 6h → `step ca renew` → SIGHUP агенту → перечитывает cert без рестарта.

**mTLS политика**:
- Принимает соединения только с клиент-cert от нашего CA.
- CN/SAN клиент-cert'а = `admin@<hostname>` определяет роль; сервер-cert'ы между агентами не принимаются (защита от cross-server lateral movement).

**Endpoints** (после mTLS — без дополнительной авторизации):

| Метод | Путь | Назначение |
|-------|------|------------|
| `GET` | `/health` | Жив ли агент, версия, uptime, cert expiry |
| `GET` | `/services/status` | Локальные проверки: traefik, authelia, frps, umami, vikunja, mailu, gitlab, casdoor (что есть на этом сервере) |
| `GET` | `/services/:name/status` | Статус одного сервиса |
| `GET` | `/config/list` | Содержимое `/opt/server-configs/servers/<name>/` (file tree + sha256) |
| `GET` | `/config/file?path=...` | Один файл (whitelisted: traefik/dynamic/*.yml, dns/records.json, ru-proxy/domains.json) |
| `POST` | `/config/sync` | `git pull` в `/opt/server-configs/`, затем reload affected services |
| `POST` | `/services/:name/reload` | systemctl reload <service> или docker compose up -d |
| `GET` | `/system/info` | OS, kernel, disk, RAM, load avg |
| `GET` | `/system/logs?service=...&lines=200` | journalctl tail (whitelisted services) |

**Чекеры** — переносятся из [monitoring.service.ts](c:/projects/borisovai-admin/management-ui/backend/src/services/monitoring.service.ts). Каждый чекер локальный (`localhost:8080` для traefik и т.д.) — он работает изнутри сервера.

**Конфиг агента**: `/etc/node-agent/config.json`
```json
{
  "server_name": "firstvds-sm-22",
  "listen": "0.0.0.0:7180",
  "tls": {
    "cert": "/etc/node-agent/certs/agent.crt",
    "key": "/etc/node-agent/certs/agent.key",
    "ca": "/etc/node-agent/certs/ca.crt",
    "require_client_cert": true,
    "allowed_client_sans": ["admin@contabo-sm-139"]
  },
  "config_repo_dir": "/opt/server-configs",
  "enabled_checkers": ["traefik", "frps"],
  "log_level": "info"
}
```

**Установка**: `scripts/single-machine/install-node-agent.sh --bootstrap-token <JWK>` [--force]
- Копирует приложение в `/opt/node-agent/`.
- Ставит `step` CLI, делает `step ca bootstrap` против `https://ca.tunnel.borisovai.ru`.
- `step ca certificate agent-<server>.internal` с JWK-токеном из аргумента.
- Systemd: `node-agent.service` + `node-agent-cert-renew.timer`.
- Идемпотентно (повторный запуск без `--bootstrap-token` обновляет код, но не трогает cert'ы).

**Audit log**: все POST в агент пишут строку в `/var/log/node-agent/audit.log` (client SAN, метод, путь, тело hash).

### 2. Реестр серверов

**Файл**: `/etc/management-ui/servers.json`

```json
[
  {
    "name": "contabo-sm-139",
    "role": "primary",
    "ssh_host": "144.91.108.139",
    "agent_url": "https://127.0.0.1:7180",
    "agent_san": "agent-contabo-sm-139.internal",
    "base_domains": ["borisovai.ru", "borisovai.tech"],
    "config_dir": "servers/contabo-sm-139",
    "enabled": true,
    "tags": ["production", "primary"]
  },
  {
    "name": "firstvds-sm-22",
    "role": "secondary",
    "ssh_host": "157.22.203.22",
    "agent_url": "https://agent.firstvds-sm-22.tunnel.borisovai.ru",
    "agent_san": "agent-firstvds-sm-22.internal",
    "base_domains": [],
    "config_dir": "servers/firstvds-sm-22",
    "enabled": true,
    "tags": ["secondary"]
  }
]
```

Никаких токенов в `servers.json` — аутентификация через mTLS-cert'ы admin'а. `agent_san` нужен для проверки серверного cert'а агента (защита от подмены endpoint'а).

**Admin client cert**: `/etc/management-ui/certs/admin.crt|key`. Получен от step-ca при установке management-ui. Auto-renew через тот же `step ca renew` timer.

**Backend модуль**: `management-ui/backend/src/services/servers.service.ts`
- `loadServers()`, `saveServers()`, `getServer(name)`, `getEnabledServers()`.
- Кэш в памяти, инвалидация по `PUT`.

**Routes** (`management-ui/backend/src/routes/servers.routes.ts`):

| Метод | Путь | Назначение |
|-------|------|------------|
| `GET` | `/api/servers` | Список + agent health для каждого |
| `GET` | `/api/servers/:name` | Один сервер + последний status |
| `POST` | `/api/servers` | Добавить сервер. Возвращает одноразовый JWK bootstrap-токен от step-ca (показывается один раз). |
| `PUT` | `/api/servers/:name` | Обновить |
| `DELETE` | `/api/servers/:name` | Удалить (с подтверждением); ревокация cert'а агента в step-ca CRL |
| `POST` | `/api/servers/:name/test` | mTLS-ping агента — проверка cert'ов и связи |
| `POST` | `/api/servers/:name/sync` | Прокси к `node-agent /config/sync` |
| `POST` | `/api/servers/:name/rotate-cert` | Force-rotate (вызывает `step ca renew --force` через агента) |

### 3. Единый мониторинг

**Refactor monitoring.service.ts**:
- Вместо локальных `axios.get('http://localhost:8080/...')` — вызовы `nodeAgentClient(server).getServicesStatus()`.
- Параллельный fan-out по всем `getEnabledServers()`.
- Результат — `Record<serverName, ServiceStatusMap>`.

**Новый клиент**: `management-ui/backend/src/lib/node-agent-client.ts`
- HTTPS Agent с mTLS: cert/key admin'а, ca-bundle нашего step-ca, проверка `agent_san` сервера.
- Методы 1:1 с эндпоинтами агента.
- Таймаут 5с по умолчанию, ретраи нет.

**API**:
- `GET /api/monitoring/status` → `{ servers: { "contabo-sm-139": {...}, "firstvds-sm-22": {...} }, activeAlerts: N, overallUptime: N }`
- `GET /api/monitoring/status/:server/:service` — детали по сервису на сервере.
- `POST /api/monitoring/check` — fan-out по всем серверам.

**Storage**: `monitoring_history` таблица получает колонку `server_name` (миграция Drizzle), индекс `(server_name, service_name, checked_at)`.

**Frontend** (`management-ui/frontend/src/pages/MonitoringPage.tsx`):
- Группировка карточек сервисов по серверу (табы или секции).
- Server-selector в header (All / contabo-sm-139 / firstvds-sm-22).
- Новая страница `ServersPage.tsx` (`/servers`) — CRUD реестра, кнопка «Test connection», «Rotate cert», бутстрап-токен при добавлении.

---

## План реализации (фазы)

### Фаза 0 — step-ca PKI (0.5 дня)
1. `scripts/single-machine/install-step-ca.sh` — init CA, intermediate, JWK + ACME provisioners, systemd unit.
2. Поднять на `contabo-sm-139`. Проверить `step ca health`.
3. Опубликовать `https://ca.tunnel.borisovai.ru` через Traefik (TCP passthrough на 9000).
4. Документировать процедуру backup root key (offline storage).

### Фаза 1 — Node-agent MVP (1.5 дня)
1. Создать `management-ui/node-agent/` package (Fastify, TypeScript, HTTPS+mTLS, отдельный package.json).
2. Эндпоинты: `/health`, `/services/status` (с переносом 2-3 чекеров — traefik, frps).
3. `scripts/single-machine/install-node-agent.sh` с bootstrap-токеном, systemd unit + cert-renew timer.
4. Установить на primary (`contabo-sm-139`) — он становится первым клиентом сам себя через `127.0.0.1:7180`.
5. Получить admin client cert для management-ui от step-ca, проверить mTLS round-trip.

### Фаза 2 — Реестр серверов (0.5 дня)
1. `servers.service.ts`, `servers.routes.ts`, типы в `shared/`.
2. Интеграция step-ca: генерация JWK bootstrap-токена при `POST /api/servers`.
3. Миграция Drizzle для `server_name` в monitoring_history.
4. Frontend: `ServersPage.tsx` (list, add с показом одноразового bootstrap-токена, test, rotate-cert).

### Фаза 3 — Единый мониторинг (1 день)
1. `node-agent-client.ts` с mTLS.
2. Refactor `monitoring.service.ts`: fan-out по серверам.
3. Refactor `MonitoringPage.tsx`: группировка по серверам.
4. Интеграционный тест: добавить мокового агента на 127.0.0.1, проверить агрегацию.

### Фаза 4 — firstvds-sm-22 onboarding (1 день)
1. Поднять frps client + туннель `agent.firstvds-sm-22.tunnel.borisovai.ru` (TCP passthrough на 7180).
2. Сгенерировать bootstrap-токен в админке.
3. Установить node-agent на firstvds-sm-22 с этим токеном. Проверить `step ca certificate` прошёл, агент стартовал.
4. Зарегистрировать в админке через UI.
5. Проверить мониторинг и принудительную ротацию cert'а.

### Фаза 5 — Sync конфигов (0.5 дня, опционально)
1. `/config/sync` в агенте: `git pull` + `systemctl reload traefik` если изменились dynamic/*.yml.
2. UI кнопка «Sync configs» на странице сервера.
3. (Опционально) OIDC provisioner step-ca через Authelia → admin client cert через SSO.

---

## Безопасность

**Аутентификация канала** — mTLS:
- Клиент и сервер взаимно проверяют cert'ы от нашего step-ca.
- Серверный cert закреплён на конкретный SAN (`agent-<server>.internal`) — admin проверяет SAN перед запросом, защищая от подмены endpoint'а даже при компрометации DNS/туннеля.
- Клиентский cert проверяется агентом по whitelist SANs (`allowed_client_sans` в конфиге) — даже валидный cert от нашего CA с другим CN не пройдёт.

**Ротация ключей**:
- Lifetime cert'а **24 часа**, renewal-grace **8 часов**.
- `step ca renew` запускается systemd timer'ом каждые 6 часов; при наличии renewal окна делает rotation.
- Принудительная ротация — кнопка в UI или `step ca renew --force` локально.
- Ревокация при удалении сервера — добавление serial cert'а в CRL step-ca + публикация CRL.

**Бутстрап**:
- Одноразовый JWK-токен от step-ca (TTL 1h), генерируется при `POST /api/servers`.
- Показывается в UI ровно один раз; передаётся в `install-node-agent.sh --bootstrap-token`.
- После успешного enroll токен инвалидируется (single-use в step-ca JWK provisioner).

**Защита root CA**:
- Root key экспортируется из step-ca при init и переносится оффлайн (зашифрованный архив, флешка).
- Online остаётся только intermediate (lifetime ~10 лет). Если intermediate скомпрометирован — re-issue новый из root, обновить bundle на агентах одной командой.
- Ежедневный backup `/etc/step-ca/db/` (issued certs DB + revocation list).

**Whitelisted команды**: агент НЕ запускает произвольные команды; только конкретные `systemctl reload <name>` где `<name>` ∈ enabled_checkers. `/config/file` отдаёт только из whitelist путей внутри `config_repo_dir`.

**Audit log**: все POST в агент → `/var/log/node-agent/audit.log` (client SAN, метод, путь, body sha256, timestamp).

---

## Failure modes и митигации

| Сценарий | Вероятность | Эффект | Митигация |
|----------|-------------|--------|-----------|
| **step-ca процесс упал** | средняя (1-2 раза/год) | Новые cert'ы не выдаются, ротация стопорится. При 24h lifetime — есть сутки на восстановление до начала просрока агентов. | Systemd `Restart=always`, monitoring чекер `/api/monitoring` следит за `https://localhost:9000/health`, alert при downtime > 10мин. |
| **Просроченный cert на агенте** (миссед ротация) | низкая | Admin не может достучаться до агента, секция мониторинга падает в red. | Renewal-grace 8h (renew стартует за 8h до истечения, есть 8 ретраев каждый час). Алерт «cert expires in <4h» из агента в `/health`. Fallback: SSH на сервер + `step ca renew --force` ручками. |
| **Скомпрометирован intermediate CA** | очень низкая | Все выданные cert'ы под подозрением. | Re-issue новый intermediate из root (offline → подключить → подписать → отключить), обновить `ca.crt` bundle на агентах одной командой через `/config/sync`. План процедуры — `docs/runbooks/PKI_INTERMEDIATE_ROTATION.md` (написать в Фазе 0). |
| **Потерян root key (флешка пропала, шифрованный архив повреждён)** | низкая | Невозможно re-issue intermediate. При компрометации intermediate — катастрофа, придётся поднимать новый CA и переподписывать всё. | **Две независимые копии root**: зашифрованная флешка (физический сейф) + зашифрованный архив в облачном backup. Тест восстановления раз в полгода. |
| **Скомпрометирован bootstrap JWK-токен (TTL 1h)** | низкая | Злоумышленник может получить cert агента до истечения токена. | TTL 1h + single-use в step-ca. После использования токен инвалидируется. Если токен утёк — `step ca provisioner remove` + ревокация выданных cert'ов. |
| **Утерян admin client cert (compromise админ-машины)** | средняя | Злоумышленник может ходить в любой агент с правами admin до истечения cert (≤24h). | Ревокация в step-ca CRL (немедленный эффект для агентов после fetch CRL — настроить fetch-interval 5мин). Аудит-лог в агенте покажет нелегитимные вызовы. |
| **frp-туннель к secondary упал** | средняя | Мониторинг secondary падает в red, sync конфигов невозможен. Агент сам работает (cert auto-renew не зависит от admin'а — агент идёт к ca.tunnel напрямую). | Агент продолжает локальные операции автономно. UI показывает «agent unreachable» отдельно от service-failures. План B: SSH-туннель/WireGuard в Фазе 4+ если frp окажется флаки. |
| **CA endpoint `ca.tunnel.borisovai.ru` недоступен 8+ часов** | низкая | Cert-renewal на secondary не работает, агент входит в просрочку через 24h. | Алерт «cert expires in <12h» с агента. Manual fallback: cross-issue через step CLI на primary, scp на secondary. |
| **Несовпадение времени между admin и agent (NTP drift)** | низкая | mTLS handshake падает, cert считается невалидным. | Все серверы используют `systemd-timesyncd` с `ntp.ubuntu.com`. Чекер времени (max drift 30s) в `/health` агента. |
| **Конфиг агента (`enabled_checkers`) расходится с реальным набором сервисов** | высокая | Агент пытается чекать сервис, которого нет → false-positive failures. | На старте агента валидация: для каждого `enabled_checkers` проверить наличие systemd unit / docker container; писать warning + автоматически отключать отсутствующие чекеры. |

---

## Открытые вопросы

1. **Traefik passthrough vs termination для агентов**: TCP passthrough = mTLS end-to-end (нужно), но теряем HTTP routing на этом домене. Подход: выделить отдельный поддомен `agent.<server>.tunnel.borisovai.ru` под TCP passthrough на 7180, остальные `*.tunnel.borisovai.ru` остаются HTTP. **Решено**: passthrough.
2. **Авто-обновление `ca.crt` bundle на агентах при ротации intermediate**: одна из версий step-ca умеет это через `step ca roots`; нужно проверить. **TBD на фазе 0**.
3. **Время жизни cert'а (24h vs 1h)**: 24h — компромисс между безопасностью и нагрузкой на step-ca/CRL. Если step-ca стабилен — можно перейти на 4-6h позже.
4. **Multi-tenant в `projects.json`**: будут ли проекты привязаны к серверу? **Не в этой итерации**.
5. **WireGuard как замена frp для admin↔agent**: оценим после фазы 4 — если frp+TCP passthrough окажется флаки, перейдём на wg-туннель + mTLS поверх (двойная защита).

---

## Файлы, которые будут созданы

- `management-ui/node-agent/` (новый package)
- `management-ui/backend/src/services/servers.service.ts`
- `management-ui/backend/src/services/step-ca.service.ts` (генерация JWK-токенов, ревокация)
- `management-ui/backend/src/routes/servers.routes.ts`
- `management-ui/backend/src/lib/node-agent-client.ts` (HTTPS+mTLS)
- `management-ui/frontend/src/pages/ServersPage.tsx`
- `management-ui/shared/src/types/server.ts`
- `scripts/single-machine/install-step-ca.sh`
- `scripts/single-machine/install-node-agent.sh`
- `scripts/single-machine/rotate-admin-cert.sh`
- `scripts/ci/deploy-node-agent.sh`
- `config/single-machine/node-agent.config.json`
- `config/single-machine/step-ca.policy.json`

## Файлы, которые будут изменены

- [monitoring.service.ts](../../management-ui/backend/src/services/monitoring.service.ts) — fan-out по серверам через mTLS-клиент
- [monitoring.routes.ts](../../management-ui/backend/src/routes/monitoring.routes.ts) — `:server` в путях
- [MonitoringPage.tsx](../../management-ui/frontend/src/pages/MonitoringPage.tsx) — группировка
- `db/schema.ts` — `server_name` в monitoring tables (миграция)
- `frontend/src/App.tsx` — роут `/servers`
- [CLAUDE.md](../../CLAUDE.md) — секция «Мульти-серверная инфраструктура» + «PKI (step-ca)»
- Traefik конфиг для frps — добавить TCP passthrough router для `ca.tunnel.borisovai.ru:443` → `localhost:9000` и `agent.<server>.tunnel.borisovai.ru:443` → `localhost:7180` (на secondary)
