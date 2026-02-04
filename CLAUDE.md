# Правила проекта borisovai-admin

## Архитектура проекта

- **Management UI** — Express.js сервер (порт 3000), развёртывается в `/opt/management-ui/`
- **Traefik** — reverse proxy, конфиги в `/etc/traefik/dynamic/` (file provider + watch)
- **GitLab CE** — self-hosted, CI/CD с shell runner
- **DNS** — управление через CLI `manage-dns` и локальный DNS API
- **Основной сайт** — Next.js 16 + Strapi v5 (borisovai-site), деплой в `/var/www/borisovai-site/`

## Стек и соглашения

- **Management UI**: Node.js, Express, vanilla HTML/CSS/JS (без фреймворков на фронте), axios, yaml, fs-extra
- **Конфигурация**: JSON файлы в `/etc/management-ui/` (config.json, auth.json, projects.json)
- **CI-шаблоны**: хранятся в `management-ui/templates/`, при установке копируются в `/opt/management-ui/templates/`
- **Скрипты**: Bash, совместимы с Debian 11/12 и Ubuntu 20.04/22.04
- **Язык комментариев и UI**: русский

## Командная работа

Проект реализуется командой агентов. При работе над задачами:

1. **Планирование** — перед реализацией крупной задачи создавать план в `docs/`, ссылаясь на существующие файлы и функции
2. **Декомпозиция** — разбивать задачи на независимые подзадачи, которые можно выполнять параллельно
3. **Контекст** — каждый агент должен получать минимально необходимый контекст: пути файлов, имена функций, формат данных
4. **Идемпотентность** — все операции (создание DNS, Traefik, CI) должны быть идемпотентными
5. **Обратная совместимость** — изменения в server.js не должны ломать существующие endpoints (`/api/services`, `/api/dns`)

## Реализованные функции

### One-Click Publish

Оркестратор регистрации проектов с автоматической настройкой DNS, Traefik, CI/CD и Strapi.

- **План**: [docs/PLAN_ONE_CLICK_PUBLISH.md](docs/PLAN_ONE_CLICK_PUBLISH.md)
- **ТЗ**: [docs/TZ_ONE_CLICK_PUBLISH.md](docs/TZ_ONE_CLICK_PUBLISH.md)
- **UI**: `management-ui/public/projects.html`
- **API**: `POST /api/publish/projects`, `GET /api/publish/projects`, `DELETE /api/publish/projects/:slug`, `PUT /api/publish/projects/:slug/update-ci`
- **Шаблоны CI**: `management-ui/templates/*.gitlab-ci.yml` (frontend, backend, fullstack, docs, validate, product)
- **Сценарии**: deploy (DNS + Traefik + CI + directories), docs (Strapi + CI + directories), infra (CI + Strapi optional), product (Strapi + CI + directories + CI variables)

### GitOps CI/CD

Автодеплой borisovai-admin на сервер при push в main.

- **План**: [docs/PLAN_GITOPS.md](docs/PLAN_GITOPS.md)
- **Pipeline**: `.gitlab-ci.yml` — validate → deploy → verify
- **Конфиг-шаблоны**: `config/single-machine/management-ui.config.json`, `dns-api.config.json`
- **CI скрипты**: `scripts/ci/render-configs.sh`, `deploy-management-ui.sh`, `deploy-dns-api.sh`, `health-check.sh`
- **Секреты**: GitLab CI Variables (GITLAB_TOKEN, STRAPI_TOKEN — masked)
- **Динамические данные** (не перезаписываются): projects.json, auth.json, records.json

## Ключевые файлы

- `management-ui/server.js` — основной сервер, все API endpoints (~900 строк)
- `management-ui/public/index.html` — UI сервисов
- `management-ui/public/dns.html` — UI DNS
- `management-ui/public/projects.html` — UI регистрации проектов
- `management-ui/templates/*.gitlab-ci.yml` — CI-шаблоны для целевых проектов
- `scripts/single-machine/install-management-ui.sh` — установка (копирует management-ui/ → /opt/management-ui/)
- `.gitlab-ci.yml` — CI/CD pipeline для borisovai-admin

## Данные

- Реестр проектов: `/etc/management-ui/projects.json`
- Конфигурация: `/etc/management-ui/config.json` (поля: gitlab_url, gitlab_token, strapi_url, strapi_token, base_port, runner_tag, main_site_path, deploy_base_path)
- Авторизация: `/etc/management-ui/auth.json` (генерируется при установке)
- Traefik конфиги: `/etc/traefik/dynamic/<slug>.yml`
- В целевых GitLab-проектах: `.gitlab-ci.yml` (include:local) + `.gitlab/ci/pipeline.yml` (полный пайплайн)

## Инструкции для агентов

- [docs/AGENT_ORCHESTRATOR.md](docs/AGENT_ORCHESTRATOR.md) — регистрация проектов через API
- [docs/AGENT_GITOPS.md](docs/AGENT_GITOPS.md) — CI/CD деплой borisovai-admin
- [docs/AGENT_SERVICES.md](docs/AGENT_SERVICES.md) — управление сервисами и DNS
- [docs/AGENT_API_GUIDE.md](docs/AGENT_API_GUIDE.md) — публикация контента через Strapi API
- [docs/AGENT_PUBLISH_SETUP.md](docs/AGENT_PUBLISH_SETUP.md) — настройка деплоя borisovai-site
