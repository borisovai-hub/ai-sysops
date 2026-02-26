# Plan: Self-Hosted VPN (Headscale) — Исследование + Установка + Интеграция

## Context

Нужен self-hosted VPN для команды. Выбран **Headscale** — open-source контроль-сервер Tailscale. Преимущества: знакомые Tailscale-клиенты (Windows, macOS, Linux, iOS, Android), OIDC интеграция с Authelia, REST API для управления, встроенный DERP relay, минимальный расход ресурсов (<100MB RAM в idle).

Начинаем с одного сервера (Contabo), архитектура готовится к масштабированию (DERP-серверы в разных регионах). Полная интеграция управления в Management UI.

---

## Deliverables (12 файлов)

### Фаза 1: Документация
1. **`docs/plans/RESEARCH_VPN.md`** — исследование VPN-решений (сравнение 6 решений, рекомендация Headscale)
2. **`docs/plans/PLAN_VPN_HEADSCALE.md`** — детальный план реализации (этот файл)

### Фаза 2: Скрипт установки
3. **`scripts/single-machine/install-headscale.sh`** — установка Headscale (8 шагов, идемпотентный, --force)

### Фаза 3: Traefik + Authelia
4. **`scripts/single-machine/configure-traefik.sh`** — добавить секцию генерации `headscale.yml`
5. **`scripts/single-machine/install-authelia.sh`** — добавить OIDC-клиент headscale + access_control домены

### Фаза 4: API endpoints в server.js
6. **`management-ui/server.js`** — ~15 новых endpoints `/api/vpn/*` + helper `headscaleApi()`

### Фаза 5: UI
7. **`management-ui/public/vpn.html`** — страница управления VPN (пользователи, узлы, ключи, подключение)
8. **Обновить навигацию** во всех HTML-страницах (добавить ссылку "VPN")

### Фаза 6: CI/CD
9. **`scripts/ci/deploy-headscale.sh`** — инкрементальный деплой
10. **`.gitlab-ci.yml`** — добавить `install:headscale` (manual) + вызов deploy-headscale.sh
11. **`scripts/ci/deploy-authelia.sh`** — добавить `_ensure_authelia_middleware` для headscale.yml

### Фаза 7: Документация проекта
12. **`CLAUDE.md`** — добавить секцию Headscale VPN в таблицу сервисов

---

## Архитектура

```
Tailscale Client ──► Traefik (443/tcp) ──► Headscale (127.0.0.1:8087)
                          │
                          ├─ /ts2021, /machine/*, /noise, /key  → БЕЗ Authelia (Tailscale протокол)
                          ├─ /oidc/*                             → БЕЗ Authelia (OIDC callback)
                          └─ /* (остальное)                      → С Authelia (админ-доступ)

                     STUN (3478/udp) ──► Headscale embedded DERP

Management UI ──► /api/vpn/* ──► server.js ──► Headscale REST API (127.0.0.1:8087/api/v1)
```

**Домены:** `vpn.dev.borisovai.ru`, `vpn.dev.borisovai.tech`
**Порты:** 8087 (HTTP, localhost), 50443 (gRPC, localhost), 3478/udp (STUN, external)
**БД:** SQLite (`/var/lib/headscale/db.sqlite`)
**OIDC:** Authelia → client_id `headscale`, redirect `https://vpn.dev.borisovai.ru/oidc/callback`

---

## Детали реализации

### install-headscale.sh (8 шагов)

Паттерн: как `install-authelia.sh` + `install-frps.sh`

| Шаг | Описание |
|-----|----------|
| [1/8] | Скачивание бинарника Headscale с GitHub Releases (версия в переменной) |
| [2/8] | Создание пользователя `headscale`, директорий `/etc/headscale/`, `/var/lib/headscale/` |
| [3/8] | Генерация `/etc/headscale/config.yaml` (server_url, listen_addr, sqlite, DERP, DNS) |
| [4/8] | Генерация секретов (OIDC client secret, noise private key) |
| [5/8] | Настройка OIDC в Authelia (client headscale, redirect_uris, scopes) |
| [6/8] | Systemd unit `headscale.service` + запуск |
| [7/8] | DNS записи для `vpn.dev.*` через DNS API |
| [8/8] | Traefik конфиг + генерация API key + сохранение в install-config.json |

**install-config.json ключи:**
```json
{
  "headscale_port": "8087",
  "headscale_grpc_port": "50443",
  "headscale_prefix": "vpn",
  "headscale_middle": "dev",
  "headscale_stun_port": "3478"
}
```

### server.js API endpoints

Helper:
```javascript
function headscaleApi(method, endpoint, data) // → axios to 127.0.0.1:8087/api/v1/*
```

| Method | Endpoint | Описание |
|--------|----------|----------|
| GET | `/api/vpn/status` | Статус сервиса (running, version, nodes count) |
| GET | `/api/vpn/users` | Список пользователей |
| POST | `/api/vpn/users` | Создать пользователя |
| DELETE | `/api/vpn/users/:name` | Удалить пользователя |
| PUT | `/api/vpn/users/:name/rename` | Переименовать |
| GET | `/api/vpn/nodes` | Список узлов (машин) |
| DELETE | `/api/vpn/nodes/:id` | Удалить узел |
| POST | `/api/vpn/nodes/:id/expire` | Отключить узел |
| POST | `/api/vpn/nodes/:id/rename` | Переименовать узел |
| GET | `/api/vpn/preauthkeys` | Список ключей авторизации |
| POST | `/api/vpn/preauthkeys` | Создать pre-auth key |
| POST | `/api/vpn/preauthkeys/:id/expire` | Отозвать ключ |
| GET | `/api/vpn/routes` | Список маршрутов |
| POST | `/api/vpn/routes/:id/enable` | Включить маршрут |
| POST | `/api/vpn/routes/:id/disable` | Выключить маршрут |
| GET | `/api/vpn/client-config` | Инструкции подключения клиента |

### vpn.html (5 карточек)

Паттерн: как `users.html` + `tunnels.html`

1. **Статус** — badge running/stopped, версия, кол-во узлов/пользователей, server URL, DERP region
2. **Пользователи** — таблица (имя, узлы, ключи, дата создания) + кнопки Create/Rename/Delete
3. **Узлы** — таблица (имя, пользователь, IP v4/v6, online/offline, last seen, маршруты) + Expire/Rename/Delete
4. **Ключи авторизации** — таблица (ключ замаскирован, пользователь, reusable, ephemeral, expiration) + Create/Copy/Expire
5. **Подключение клиента** — инструкции для каждой платформы, quick-connect команда, OIDC flow

### Traefik routing (headscale.yml)

Критично: Headscale обслуживает И протокол Tailscale, И admin API. Нужно разделить:
- **Высокий приоритет (priority: 10):** `/ts2021`, `/machine/*`, `/noise`, `/key`, `/oidc/*`, `/apple`, `/windows` → БЕЗ Authelia
- **Низкий приоритет (priority: 1):** `/*` → С `authelia@file` middleware

### Authelia обновления (6-point checklist)

1. Traefik роутер — `headscale.yml` с `authelia@file` на catch-all роутерах
2. access_control — добавить `vpn.dev.borisovai.ru`, `vpn.dev.borisovai.tech` с `policy: two_factor`
3. install-authelia.sh — добавить `HEADSCALE_DOMAINS` + OIDC client `headscale`
4. deploy-authelia.sh — добавить `_ensure_authelia_middleware` для headscale.yml
5. install-headscale.sh — генерирует Traefik YAML с `authelia@file`
6. deploy-headscale.sh — проверяет Traefik конфиг + middleware

### DERP geo-location (будущее масштабирование)

**Фаза 1 (сейчас):** Embedded DERP на текущем сервере
```yaml
derp:
  server:
    enabled: true
    region_id: 900
    region_code: "eu-de"
    region_name: "Europe - Germany (Contabo)"
    stun_listen_addr: "0.0.0.0:3478"
    automatically_add_embedded_derp_region: true
```

**Фаза 2 (будущее):** Кастомные DERP-серверы в разных регионах
- `/etc/headscale/derp.yaml` с описанием регионов (EU, US, Asia)
- Standalone `derper` бинарники на VPS в разных локациях
- Клиенты автоматически выбирают ближайший relay по STUN latency
- Management UI может получить редактор DERP-регионов (`/api/vpn/derp`)

```yaml
# Пример будущей конфигурации
regions:
  900:
    region_name: "Europe - Germany"
    nodes:
      - name: "derp-eu-de"
        ipv4: "x.x.x.x"
        stun_port: 3478
        derpport: 443
  901:
    region_name: "North America - East"
    nodes:
      - name: "derp-us-east"
        ipv4: "y.y.y.y"
        stun_port: 3478
        derpport: 443
  902:
    region_name: "Asia - Singapore"
    nodes:
      - name: "derp-sg"
        ipv4: "z.z.z.z"
        stun_port: 3478
        derpport: 443
```

---

## Потоки авторизации пользователей

### Поток 1: OIDC (рекомендуемый)
1. Пользователь устанавливает Tailscale клиент
2. `tailscale up --login-server=https://vpn.dev.borisovai.ru`
3. Открывается браузер → Authelia login (2FA)
4. Authelia возвращает claims → Headscale создаёт пользователя автоматически
5. Устройство подключено к VPN

### Поток 2: Pre-Auth Key (для автоматизации/серверов)
1. Админ создаёт pre-auth key в Management UI (vpn.html)
2. Передаёт key пользователю/скрипту
3. `tailscale up --login-server=https://vpn.dev.borisovai.ru --authkey=<KEY>`
4. Устройство автоматически регистрируется и подключается

---

## Порядок реализации

1. `docs/plans/RESEARCH_VPN.md` — исследование
2. `scripts/single-machine/install-headscale.sh` — скрипт установки
3. `scripts/single-machine/configure-traefik.sh` — добавить headscale секцию
4. `scripts/single-machine/install-authelia.sh` — добавить OIDC клиент + access_control
5. `management-ui/server.js` — API endpoints `/api/vpn/*`
6. `management-ui/public/vpn.html` — UI страница
7. Обновить навигацию во всех HTML (8+ файлов)
8. `scripts/ci/deploy-headscale.sh` — CI deploy
9. `scripts/ci/deploy-authelia.sh` — добавить middleware check
10. `.gitlab-ci.yml` — добавить install:headscale + deploy step
11. `CLAUDE.md` — обновить документацию

---

## Верификация

1. **install-headscale.sh**: `sudo ./install-headscale.sh` → headscale.service running, API key сгенерирован
2. **install-headscale.sh --force**: повторный запуск не ломает конфиг, обновляет бинарник
3. **API**: `curl -H "Authorization: Bearer $KEY" http://127.0.0.1:8087/api/v1/user` → 200
4. **Traefik**: `https://vpn.dev.borisovai.ru` → redirect to Authelia login
5. **Tailscale client**: `tailscale up --login-server=https://vpn.dev.borisovai.ru` → OIDC flow → connected
6. **Management UI**: vpn.html → таблицы пользователей/узлов/ключей работают
7. **CI/CD**: push в main → deploy-headscale.sh проходит без ошибок

---

## Ключевые файлы для reference

| Файл | Назначение |
|------|------------|
| `scripts/single-machine/install-frps.sh` | Паттерн install скрипта (бинарник + systemd) |
| `scripts/single-machine/install-authelia.sh` | Паттерн OIDC + secrets + access_control |
| `scripts/single-machine/configure-traefik.sh` | Добавление Traefik секций |
| `management-ui/public/users.html` | Паттерн UI (таблица + модалы + CRUD) |
| `management-ui/public/tunnels.html` | Паттерн статус-карточки |
| `management-ui/server.js` | Добавление API endpoints |
| `docs/plans/RESEARCH_TUNNELING.md` | Паттерн research документа |
| `docs/plans/RESEARCH_ANALYTICS.md` | Паттерн research документа |

---

## Риски и митигация

| Риск | Митигация |
|------|-----------|
| Tailscale клиент несовместим с Headscale | Headscale 0.26.x поддерживает Tailscale 1.58+. Документировать минимальную версию |
| Authelia OIDC claims не передают email | Настроить Authelia OIDC client с `id_token_signed_response_alg: RS256` и нужными scopes |
| DERP за Traefik не работает (WebSocket) | Traefik нативно поддерживает WebSocket upgrade. Проверить middleware не блокирует |
| STUN порт закрыт в Contabo firewall | Открыть 3478/udp в UFW И в панели Contabo |

---

## Источники

- [Headscale GitHub](https://github.com/juanfont/headscale) — 25k+ stars
- [Headscale Documentation](https://headscale.net/)
- [Headscale REST API](https://headscale.net/development/ref/api/)
- [Headscale OIDC](https://headscale.net/stable/ref/oidc/)
- [Authelia + Headscale OIDC](https://www.authelia.com/integration/openid-connect/clients/headscale/)
- [Headscale DERP](https://headscale.net/stable/ref/derp/)
- [Headscale ACL](https://headscale.net/stable/ref/acls/)
