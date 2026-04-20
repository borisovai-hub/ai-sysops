# Правила проекта borisovai-admin

## Архитектура проекта

- **Management UI** — Fastify v5 + React 19 monorepo (порт 3000), развёртывается в `/opt/management-ui/`
- **Traefik** — reverse proxy, конфиги в `/etc/traefik/dynamic/` (file provider + watch)
- **GitLab CE** — self-hosted, CI/CD с shell runner
- **DNS** — управление через CLI `manage-dns` и локальный DNS API (порт 5353)
- **Основной сайт** — Next.js 16 + Strapi v5 (borisovai-site), деплой в `/var/www/borisovai-site/`
- **Config Repo** — `tools/server-configs` (отдельный GitLab-репозиторий), стенд-специфичная конфигурация в `/opt/server-configs/`

### Разделение конфигурации

Стенд-специфичная конфигурация (Traefik, DNS, Authelia, RU Proxy) вынесена в отдельный репозиторий `tools/server-configs`:

```
servers/<server-name>/        # Конфигурация конкретного сервера
  server.yml                  # Мета: SSH, runner tag, base domain, порты
  traefik/dynamic/*.yml       # Traefik роутеры и сервисы
  dns/records.json            # DNS записи (GitOps)
  authelia/                   # Authelia users
  ru-proxy/domains.json       # RU Proxy домены
templates/                    # Шаблоны конфигов с {{placeholder}}
```

- **CI**: `sync:configs` job клонирует/обновляет config repo в `/opt/server-configs/`
- **Env vars**: `SERVER_NAME` (имя сервера), `CONFIG_REPO_DIR` (путь к config repo)
- **Fallback**: Если config repo не найден, скрипты используют шаблоны из `config/single-machine/`
- **Management UI**: `env.ts` → `findServerConfigDir()` с 4-уровневым fallback

## Стек и соглашения

- **Management UI**: Fastify v5, React 19 + Vite, Drizzle ORM + SQLite, TypeScript monorepo (shared + backend + frontend)
- **Vikunja** — self-hosted task planner (Docker, порт 3456), Authelia OIDC + Mailu SMTP
- **Конфигурация**: JSON файлы в `/etc/management-ui/` (config.json, auth.json, projects.json)
- **CI-шаблоны**: хранятся в `management-ui/templates/`, при установке копируются в `/opt/management-ui/templates/`
- **Скрипты**: Bash, совместимы с Debian 11/12 и Ubuntu 20.04/22.04
- **Язык комментариев и UI**: русский

## Отладка через CI pipeline

- **Диагностика ДО фикса**: Первый коммит должен включать вывод сырых данных (реальное содержимое файлов, не значения переменных). Не доверять предположениям о формате
- **Batch-фиксы**: Все потенциальные исправления в ОДИН коммит. Каждый pipeline = 30-60 сек + анализ логов
- **sed address range**: При редактировании YAML/config файлов с несколькими записями — ВСЕГДА указывать диапазон строк, чтобы не затронуть другие блоки
- **grep паттерны**: Учитывать вариации формата (с кавычками и без, разные YAML-стили). Добавлять fallback если `-P` (Perl regex) не найдёт совпадение

## Правила публикации сервисов и проектов

**Единый источник правил** — [docs/agents/AGENT_PUBLISH.md](docs/agents/AGENT_PUBLISH.md). Не дублируй правила здесь — обновляй `AGENT_PUBLISH.md`.

Кратко, почему этот документ важен (выведено из ~60 fix-коммитов):
- Каждый Traefik-роутер обязан содержать оба TLD (`.ru || .tech`) — иначе RU Proxy получит 404.
- Authelia SSO — 6 точек обновляются атомарно; забытая точка = 401/403 или пропадает при переустановке.
- DNS, Docker volumes, install-config.json middle-сегмент, SMTP Authelia — набор правил с историями регрессов.

Новый публикационный API (`POST /api/publish/service`, `/project`, `/ai`) применяет эти правила кодом (guards). Агенты и CI должны пользоваться им, а не собирать шаги вручную. Контракт API — [docs/agents/AGENT_PUBLISH_API.md](docs/agents/AGENT_PUBLISH_API.md). LLM-оркестратор — [docs/agents/AGENT_PUBLISH_AI.md](docs/agents/AGENT_PUBLISH_AI.md).

## Командная работа

Проект реализуется командой агентов. При работе над задачами:

1. **Планирование** — перед реализацией крупной задачи создавать план в `docs/`, ссылаясь на существующие файлы и функции
2. **Декомпозиция** — разбивать задачи на независимые подзадачи, которые можно выполнять параллельно
3. **Контекст** — каждый агент должен получать минимально необходимый контекст: пути файлов, имена функций, формат данных
4. **Идемпотентность** — все операции (создание DNS, Traefik, CI) должны быть идемпотентными
5. **Обратная совместимость** — изменения в API не должны ломать существующие endpoints

## Мульти-домен (base_domains)

Все сервисы доступны по двум базовым доменам: `borisovai.ru` и `borisovai.tech`.

- **Источник**: `/etc/install-config.json` → `base_domains: "borisovai.ru,borisovai.tech"`
- **Bash-скрипты**: `common.sh` → `get_base_domains()`, `build_service_domains()`, `create_dns_records_for_domains()`
- **Backend**: `env.ts` → `getBaseDomains()`, `buildAllDomains(prefix)`
- **Traefik**: правила генерируются с `||` — `Host(`slug.borisovai.ru`) || Host(`slug.borisovai.tech`)`
- **DNS**: записи создаются для каждого base_domain через DNS API
- **Управление**: `scripts/single-machine/manage-base-domains.sh` (add/remove/list/site/apply)
- **Traefik-конфиги**: `scripts/single-machine/configure-traefik.sh` (без аргументов читает base_domains из конфига, `--force` пересоздаёт все)

### Сервисы на сервере

| Сервис | Префикс.Middle | Домены |
|--------|----------------|--------|
| Management UI | admin | admin.borisovai.ru, admin.borisovai.tech |
| Сайт (frontend) | (apex) | borisovai.ru, borisovai.tech |
| Сайт (API) | api | api.borisovai.ru, api.borisovai.tech |
| GitLab | gitlab.dev | gitlab.dev.borisovai.ru, gitlab.dev.borisovai.tech |
| n8n | n8n.dev | n8n.dev.borisovai.ru, n8n.dev.borisovai.tech |
| Mailu | mail.dev | mail.dev.borisovai.ru, mail.dev.borisovai.tech |
| frps (туннели) | tunnel | *.tunnel.borisovai.ru, *.tunnel.borisovai.tech |
| Authelia SSO | auth | auth.borisovai.ru, auth.borisovai.tech |
| Umami Analytics | analytics.dev | analytics.dev.borisovai.ru, analytics.dev.borisovai.tech |
| Vikunja Tasks | tasks.dev | tasks.dev.borisovai.ru, tasks.dev.borisovai.tech |

## Реализованные функции

### One-Click Publish

Оркестратор регистрации проектов с автоматической настройкой DNS, Traefik, CI/CD и Strapi.

- **План**: [docs/plans/PLAN_ONE_CLICK_PUBLISH.md](docs/plans/PLAN_ONE_CLICK_PUBLISH.md)
- **ТЗ**: [docs/plans/TZ_ONE_CLICK_PUBLISH.md](docs/plans/TZ_ONE_CLICK_PUBLISH.md)
- **UI**: React frontend → страница Projects
- **API**: `POST /api/publish/projects`, `GET /api/publish/projects`, `DELETE /api/publish/projects/:slug`, `PUT /api/publish/projects/:slug/update-ci`
- **Шаблоны CI**: `management-ui/templates/*.gitlab-ci.yml` (frontend, backend, fullstack, docs, validate, product)
- **Сценарии**: deploy (DNS + Traefik + CI + directories), docs (Strapi + CI + directories), infra (CI + Strapi optional), product (Strapi + CI + directories + CI variables)

### GitOps CI/CD

Автодеплой borisovai-admin на сервер при push в main.

- **План**: [docs/plans/PLAN_GITOPS.md](docs/plans/PLAN_GITOPS.md)
- **Pipeline**: `.gitlab-ci.yml` — validate → deploy → verify
- **Конфиг-шаблоны**: `config/single-machine/management-ui.config.json`, `dns-api.config.json`
- **CI скрипты**: `scripts/ci/render-configs.sh`, `deploy-management-ui.sh`, `deploy-dns-api.sh`, `health-check.sh`
- **Секреты**: GitLab CI Variables (GITLAB_TOKEN, STRAPI_TOKEN — masked)
- **Динамические данные** (не перезаписываются): projects.json, auth.json, records.json

### Authelia SSO

Единый вход (SSO) через Authelia — ForwardAuth middleware для Traefik + OIDC для Management UI.

- **Исследование**: [docs/plans/RESEARCH_SSO.md](docs/plans/RESEARCH_SSO.md)
- **План**: [docs/plans/PLAN_SSO_AUTHELIA.md](docs/plans/PLAN_SSO_AUTHELIA.md)
- **Скрипт установки**: `scripts/single-machine/install-authelia.sh` (`--force` для переустановки)
- **Конфиг**: `/etc/authelia/configuration.yml`, `/etc/authelia/users_database.yml`
- **Секреты**: `/etc/authelia/secrets/` (jwt, session, storage, OIDC client secrets)
- **Traefik**: `/etc/traefik/dynamic/authelia.yml` (ForwardAuth middleware + роутер)
- **Systemd**: `authelia.service`
- **Домены**: `auth.borisovai.ru`, `auth.borisovai.tech`
- **Порт**: 9091 (localhost)
- **OIDC в Management UI**: `config.json` → секция `oidc` (enabled, issuer, base_url, client_id, client_secret, cookie_secret)
- **Dual-mode**: OIDC (production) или legacy session (dev)
- **Защищённые сервисы**: management-ui, n8n, mailu, vikunja (middleware `authelia@file`)

### frp Tunneling

Self-hosted туннелирование (замена ngrok) — проброс локальных сервисов через сервер.

- **Исследование**: [docs/plans/RESEARCH_TUNNELING.md](docs/plans/RESEARCH_TUNNELING.md)
- **Скрипт установки**: `scripts/single-machine/install-frps.sh` (`--force` для переустановки)
- **Конфиг сервера**: `/etc/frp/frps.toml`
- **Traefik**: `/etc/traefik/dynamic/tunnels.yml` (wildcard HostRegexp)
- **Клиент-шаблон**: `config/frpc-template/frpc.toml`
- **Порты**: 17420 (control), 17480 (vhost HTTP за Traefik), 17490 (dashboard localhost)
- **Systemd**: `frps.service`
- **UI**: React frontend → страница Tunnels
- **API**: `GET /api/tunnels/status`, `GET /api/tunnels/proxies`, `GET /api/tunnels/config`, `GET /api/tunnels/client-config`

### Umami Analytics

Self-hosted веб-аналитика для мониторинга трафика проектов (privacy-friendly, GDPR-compliant).

- **Исследование**: [docs/plans/RESEARCH_ANALYTICS.md](docs/plans/RESEARCH_ANALYTICS.md)
- **Скрипт установки**: `scripts/single-machine/install-umami.sh` (`--force` для переустановки)
- **Docker Compose**: Umami + SQLite (community fork ghcr.io/maxime-j/umami-sqlite:latest)
- **Конфиг**: `/etc/umami/docker-compose.yml`, `/etc/umami/.env`
- **БД**: SQLite (файл `umami.db` в Docker volume `umami-data`)
- **Traefik**: `/etc/traefik/dynamic/analytics.yml` (раздельные роутеры для каждого домена)
- **Порт**: 3001 (localhost)
- **Домены**: analytics.dev.borisovai.ru, analytics.dev.borisovai.tech
- **UI**: React frontend → страница Analytics
- **API**: `GET /api/analytics/status`
- **CI/CD**: Автоматическая установка Docker (`install:docker` job) и Umami (`install:umami` job)
- **Деплой**: `scripts/ci/deploy-umami.sh` (инкрементальный, обновление образов и конфигов)
- **Интеграция**: [docs/agents/AGENT_ANALYTICS.md](docs/agents/AGENT_ANALYTICS.md)

### Vikunja Tasks

Self-hosted планировщик задач с календарём, списками, kanban, напоминаниями (Todoist-like).

- **Docker Compose**: Vikunja + SQLite (vikunja/vikunja:latest)
- **Конфиг**: `/etc/vikunja/docker-compose.yml`, `/etc/vikunja/.env`
- **БД**: SQLite (файл `vikunja.db` в Docker volume `vikunja-db`)
- **Traefik**: `/etc/traefik/dynamic/vikunja.yml` (роутеры с `authelia@file`)
- **Порт**: 3456 (localhost)
- **Домены**: tasks.dev.borisovai.ru, tasks.dev.borisovai.tech
- **Авторизация**: Authelia OIDC (client_id=vikunja) + ForwardAuth middleware
- **Уведомления**: SMTP через Mailu (tasks@borisovai.ru)
- **CalDAV**: синхронизация с мобильными календарями (DAVx5, iOS)
- **UI**: React frontend → страница Tasks (Инструменты)
- **API Management UI**: `GET /api/tasks/status`
- **CI/CD**: `install:vikunja` job (автоматический) + `deploy-vikunja.sh` (инкрементальный)
- **Install скрипт**: `scripts/single-machine/install-vikunja.sh` (`--force` для переустановки)
- **Деплой**: `scripts/ci/deploy-vikunja.sh` (инкрементальный, обновление образов и конфигов)

### RU Proxy

Российский reverse proxy (Caddy) для .ru доменов — снижение рисков блокировки РКН, улучшение latency для RU пользователей.

- **Архитектура**: Пользователь → RU VPS (Caddy, auto-SSL) → Contabo (Traefik)
- **RU VPS**: `82.146.56.174` (Ubuntu 24.04)
- **Caddy**: reverse proxy с автоматическими Let's Encrypt сертификатами
- **Management API**: `ru-proxy/server.js` — CRUD доменов, генерация Caddyfile, reload Caddy (порт 3100)
- **Install скрипт**: `scripts/single-machine/install-ru-proxy.sh` (запускается на RU VPS, не на Contabo)
- **UI**: React frontend → страница RU Proxy
- **API Management UI**: `GET/POST/PUT/DELETE /api/ru-proxy/domains`, `GET /api/ru-proxy/status`, `POST /api/ru-proxy/reload`
- **Конфиг Contabo**: `install-config.json` → `ru_proxy_api_url`, `ru_proxy_api_token`
- **Важно**: Caddy использует `tls_insecure_skip_verify` для бэкенда — Traefik на Contabo не имеет LE-сертификатов для .ru (DNS указывает на RU VPS)

## Установка и обновление

- **Скрипт**: `scripts/single-machine/install-management-ui.sh [--force]`
- `--force` — обновляет файлы приложения и перезапускает сервис
- **auth.json** — создаётся только при первой установке, не перезаписывается (пароль и bearer-токены сохраняются)
- **config.json** — при наличии показывает текущие значения и спрашивает `Переписать конфигурацию? (y/N)`. Токены маскируются. Существующие значения используются как дефолты
- **projects.json** — не перезаписывается (динамические данные)

## Ключевые файлы

- `management-ui/backend/` — Fastify v5 backend (15 route modules, 11 lib modules, 13 services)
- `management-ui/frontend/` — React 19 + Vite + Tailwind v4 frontend (12 страниц)
- `management-ui/shared/` — общие типы и утилиты
- `management-ui/templates/*.gitlab-ci.yml` — CI-шаблоны для целевых проектов
- `scripts/single-machine/install-management-ui.sh` — установка (копирует management-ui/ → /opt/management-ui/)
- `scripts/single-machine/configure-traefik.sh` — генерация Traefik-конфигов для всех сервисов
- `scripts/single-machine/manage-base-domains.sh` — управление списком базовых доменов
- `scripts/single-machine/common.sh` — общие функции (base_domains, install state, config)
- `scripts/single-machine/install-frps.sh` — установка frp server (туннелирование)
- `scripts/single-machine/install-authelia.sh` — установка Authelia SSO
- `.gitlab-ci.yml` — CI/CD pipeline для borisovai-admin

## Данные

- Реестр проектов: `/etc/management-ui/projects.json`
- Конфигурация: `/etc/management-ui/config.json` (поля: gitlab_url, gitlab_token, strapi_url, strapi_token, base_port, runner_tag, main_site_path, deploy_base_path)
- Конфигурация установки: `/etc/install-config.json` (base_domains, prefixes, middle-сегменты, ports)
- Авторизация: `/etc/management-ui/auth.json` (пароль + bearer-токены)
- Traefik конфиги: `/etc/traefik/dynamic/<slug>.yml`
- В целевых GitLab-проектах: `.gitlab-ci.yml` (include:local) + `.gitlab/ci/pipeline.yml` (полный пайплайн)

## Инструкции для агентов

**Основной документ публикации** (правила + сценарии + API):
- [docs/agents/AGENT_PUBLISH.md](docs/agents/AGENT_PUBLISH.md) — **единая точка входа для публикации сервиса/проекта**. Читать первым.
- [docs/agents/AGENT_PUBLISH_API.md](docs/agents/AGENT_PUBLISH_API.md) — контракт API (`/api/publish/*`), JSON-схемы, примеры.
- [docs/agents/AGENT_PUBLISH_AI.md](docs/agents/AGENT_PUBLISH_AI.md) — LLM-оркестратор `/api/publish/ai` (SSE, approvals).

Справочники / legacy:
- [docs/agents/AGENT_ORCHESTRATOR.md](docs/agents/AGENT_ORCHESTRATOR.md) — legacy endpoint `POST /api/publish/projects` (thin-wrapper).
- [docs/agents/AGENT_SERVICES.md](docs/agents/AGENT_SERVICES.md) — низкоуровневый CRUD Traefik/DNS для ручного вмешательства.
- [docs/agents/AGENT_GITOPS.md](docs/agents/AGENT_GITOPS.md) — CI/CD самого borisovai-admin (не про публикацию сторонних).
- [docs/agents/AGENT_API_GUIDE.md](docs/agents/AGENT_API_GUIDE.md) — публикация контента через Strapi.
- [docs/agents/AGENT_ANALYTICS.md](docs/agents/AGENT_ANALYTICS.md) — интеграция Umami в Next.js.
- [docs/agents/AGENT_MONITORING.md](docs/agents/AGENT_MONITORING.md) — мониторинг и безопасность.
- [docs/agents/AGENT_PUBLISH_SETUP.md](docs/agents/AGENT_PUBLISH_SETUP.md) — настройка CI-деплоя borisovai-site.
- [docs/agents/AGENT_FULL_GUIDE.md](docs/agents/AGENT_FULL_GUIDE.md) — общий обзор Management UI.

## Дополнительная документация

- [docs/setup/INSTALLATION.md](docs/setup/INSTALLATION.md) — полная установка (GitLab, Traefik, DNS API, Management UI)
- [docs/setup/QUICK_START_GUIDE.md](docs/setup/QUICK_START_GUIDE.md) — быстрый старт (~25 минут)
- [docs/dns/DNS_MAIL_SETUP.md](docs/dns/DNS_MAIL_SETUP.md) — DNS для Mailu (MX, SPF, DKIM, DMARC)
- [docs/dns/DNS_SITE_SETUP.md](docs/dns/DNS_SITE_SETUP.md) — DNS для сайта (NS, A-записи, Cloudflare)
- [docs/dns/DNS_TROUBLESHOOTING.md](docs/dns/DNS_TROUBLESHOOTING.md) — диагностика DNS
- [docs/setup/PROXMOX_SETUP.md](docs/setup/PROXMOX_SETUP.md) — настройка Proxmox VE
- [docs/plans/RESEARCH_SSO.md](docs/plans/RESEARCH_SSO.md) — исследование SSO (Authelia, Authentik, Keycloak)
- [docs/plans/RESEARCH_TUNNELING.md](docs/plans/RESEARCH_TUNNELING.md) — исследование self-hosted туннелирования (frp, sish, pgrok и др.)
- [docs/plans/RESEARCH_ANALYTICS.md](docs/plans/RESEARCH_ANALYTICS.md) — исследование self-hosted веб-аналитики (Umami, Plausible, Matomo и др.)
- [docs/plans/PLAN_SCRIPTS_REFACTORING.md](docs/plans/PLAN_SCRIPTS_REFACTORING.md) — план рефакторинга скриптов установки (5 фаз)
