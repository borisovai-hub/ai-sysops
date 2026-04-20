# AGENT_GITOPS — CI/CD самого borisovai-admin

> **Scope:** этот документ только про CI/CD **собственного** репозитория `borisovai-admin` (как Management UI деплоится на сервер при push в main).
> Для публикации **сторонних** сервисов/проектов через Management UI — [AGENT_PUBLISH.md](AGENT_PUBLISH.md).

Руководство по CI/CD pipeline для автоматического деплоя borisovai-admin на сервер при push в main.

## 1. Обзор

При push в ветку `main` запускается GitLab CI pipeline:

```
validate → install → deploy → verify
```

- **validate** — проверка CI Variables (обычный раннер `deploy-production`)
- **install** — установка Docker, Umami и ручные компоненты (раннер `deploy-root`)
- **deploy** — сборка monorepo, rsync, миграции, перезапуск сервисов (раннер `deploy-root`)
- **verify** — health check всех сервисов (обычный раннер `deploy-production`)

## 2. Архитектура monorepo

Management UI — npm workspaces monorepo:

```
management-ui/
├── package.json              # Корневой: workspaces, build-скрипт
├── shared/                   # @management-ui/shared — типы, Zod-схемы
│   ├── src/
│   └── dist/                 # tsc → JS + .d.ts
├── backend/                  # @management-ui/backend — Fastify v5, Drizzle ORM
│   ├── src/
│   └── dist/                 # tsc → node dist/index.js
└── frontend/                 # @management-ui/frontend — React 19, Vite, Tailwind v4
    ├── src/
    └── dist/                 # vite build → статика
```

**Порядок сборки** (shared должен быть первым):

```bash
cd /opt/management-ui
npm ci
npm run build -w shared      # TypeScript → dist/
npm run build -w frontend    # tsc + vite build → dist/
npm run build -w backend     # tsc → dist/
```

Или одной командой: `npm run build` (порядок зашит в корневом package.json).

**Systemd**: `management-ui.service` запускает `node dist/index.js` из пакета backend.
Backend раздает статику frontend через `@fastify/static`.

## 3. Разделение данных

| Категория | Где хранится | Примеры |
|-----------|-------------|---------|
| Код и шаблоны | Git | `management-ui/`, `scripts/`, `config/` |
| Конфиги (шаблоны) | Git — плейсхолдеры | `config/single-machine/*.config.json` |
| Секреты | GitLab CI Variables (masked) | `GITLAB_TOKEN`, `STRAPI_TOKEN` |
| Конфиг сервиса | Сервер | `/etc/management-ui/config.json` |
| Авторизация | Сервер (не перезаписывается) | `/etc/management-ui/auth.json` |
| Реестр проектов | Сервер (не перезаписывается) | `/etc/management-ui/projects.json` |
| БД | Сервер | `/var/lib/management-ui/management-ui.db` (SQLite) |

## 4. CI Variables

GitLab Settings -> CI/CD -> Variables:

| Переменная | Значение | Protected | Masked |
|-----------|----------|-----------|--------|
| `GITLAB_URL` | `https://git.borisovai.ru` | нет | нет |
| `GITLAB_TOKEN` | Personal Access Token (api) | да | да |
| `STRAPI_URL` | `http://127.0.0.1:1337` | нет | нет |
| `STRAPI_TOKEN` | API токен Strapi | да | да |
| `BASE_DOMAIN` | `borisovai.ru` | нет | нет |

Плейсхолдеры `{{VARIABLE}}` в шаблонах `config/single-machine/*.config.json` заменяются скриптом `render-configs.sh`.

## 5. Стадии pipeline

### 5.1 validate

Проверяет наличие всех обязательных CI Variables:

```bash
bash scripts/ci/render-configs.sh --validate
```

Fail-fast: если переменная не задана, pipeline останавливается.

### 5.2 install

Параллельные и зависимые jobs:

- **install:docker** — автоматически, установка Docker (для Umami, fileserver)
- **install:umami** — автоматически, после Docker
- **install:authelia** — ручной (Play button), установка Authelia SSO
- **install:frps** — ручной, установка frp server
- **install:fileserver** — ручной, после Docker
- **install:gitlab-oidc** — ручной, настройка GitLab OIDC

### 5.3 deploy

Выполняется последовательно в одном job:

1. **Рендеринг конфигов** — `render-configs.sh` создает `rendered-configs/*.json` (chmod 600)
2. **Деплой Management UI** — `deploy-management-ui.sh`:
   - `rsync -av --delete --exclude=node_modules management-ui/ -> /opt/management-ui/`
   - Копирует rendered config -> `/etc/management-ui/config.json`
   - `npm ci` (устанавливает все workspace-зависимости)
   - `npm run build` (shared -> frontend -> backend)
   - `npm run db:migrate` (Drizzle миграции SQLite)
   - `systemctl restart management-ui`
3. **Деплой DNS API** — `deploy-dns-api.sh`
4. **Деплой Traefik** — `deploy-traefik.sh` (dynamic auto-reload + static с рестартом)
5. **Деплой DNS-записей** — `deploy-dns-records.sh`
6. **Деплой Authelia** — `deploy-authelia.sh` + `deploy-authelia-users.sh`
7. **Деплой RU Proxy** — `deploy-ru-proxy.sh`
8. **Деплой Umami** — `deploy-umami.sh`
9. **Деплой Fileserver** — `deploy-fileserver.sh`
10. **Деплой Mailu** — `deploy-mailu.sh`
11. **Копирование скриптов** — `scripts/single-machine/ -> /opt/borisovai-admin/scripts/`

### 5.4 verify

Health check сервисов через `health-check.sh`:

- **Management UI** (порт 3000) — обязательно, при ошибке pipeline падает
- DNS API (порт 5353) — опционально
- Authelia (порт 9091) — опционально
- Traefik (порт 8080) — опционально
- Umami Analytics (порт 3001) — опционально

## 6. Гарантии безопасности

- **auth.json** — никогда не перезаписывается (создается только при `install-management-ui.sh`)
- **projects.json** — не трогается (динамические данные)
- **SQLite БД** (`/var/lib/management-ui/`) — не трогается, обновляется только через миграции
- Секреты хранятся только в CI Variables (masked), не в Git
- `rendered-configs/` — в `.gitignore`, файлы с chmod 600
- DNS-записи создаются идемпотентно (проверка через GET перед POST)

## 7. Troubleshooting

| Проблема | Проверить |
|----------|-----------|
| Pipeline не запускается | Push в `main`? Runners `deploy-production` и `deploy-root` online? |
| validate fails | Settings -> CI/CD -> Variables — все 5 переменных заданы |
| rsync error | `/opt/management-ui/` существует? Выполнен `install-management-ui.sh`? |
| npm run build fails | Node.js >= 20? `package-lock.json` синхронизирован? `npm run typecheck` |
| db:migrate fails | `/var/lib/management-ui/` существует и writable? SQLite не заблокирован? |
| Management UI не отвечает | `journalctl -u management-ui -n 50`, `ss -tlnp \| grep 3000`, наличие `dist/` |

## 8. Ручной деплой

```bash
# На сервере, от root
cd /opt/management-ui
npm ci && npm run build && npm run db:migrate
systemctl restart management-ui && journalctl -u management-ui -f
```

С Windows: `.\scripts\upload-single-machine.ps1` (SCP + SSH restart).
