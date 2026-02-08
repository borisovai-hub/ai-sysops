# Plan: GitOps — конфиги в Git + CI/CD деплой borisovai-admin

## Суть

Перевести borisovai-admin на GitOps: конфиги в Git (шаблоны), секреты в CI Variables, автодеплой на сервер при push в main. Заменяет ручной `upload-single-machine.ps1` → SCP → SSH.

## Разделение данных

| Категория | Где хранится | Примеры |
|-----------|-------------|---------|
| Конфиги (не секреты) | Git — шаблоны | base_domain, runner_tag, base_port, gitlab_url, strapi_url, ports |
| Секреты | GitLab CI Variables (masked) | gitlab_token, strapi_token |
| Динамические данные | Только на сервере | projects.json, auth.json, dns records.json |
| Авто-генерируемое | При первой установке | auth.json (random password) |

## Файлы

### Шаблоны конфигов

- `config/single-machine/management-ui.config.json` — настройки Management UI с плейсхолдерами
- `config/single-machine/dns-api.config.json` — настройки DNS API

### CI скрипты

- `scripts/ci/render-configs.sh` — подстановка CI Variables в шаблоны через sed
- `scripts/ci/deploy-management-ui.sh` — инкрементальный деплой Management UI (rsync, npm ci, systemctl restart)
- `scripts/ci/deploy-dns-api.sh` — инкрементальный деплой DNS API
- `scripts/ci/health-check.sh` — пост-деплой проверка здоровья сервисов

### Pipeline

- `.gitlab-ci.yml` — 3 стадии: validate → deploy → verify

## CI Variables (GitLab → Settings → CI/CD → Variables)

| Переменная | Protected | Masked |
|-----------|-----------|--------|
| `GITLAB_URL` | нет | нет |
| `GITLAB_TOKEN` | да | да |
| `STRAPI_URL` | нет | нет |
| `STRAPI_TOKEN` | да | да |
| `BASE_DOMAIN` | нет | нет |

## Гарантии безопасности

- auth.json, projects.json, records.json — никогда не перезаписываются
- Секреты только в CI Variables (masked)
- rendered-configs/ в .gitignore

## Обратная совместимость

- install-all.sh, install-management-ui.sh — без изменений (для первичной установки)
- upload-single-machine.ps1 — остаётся для дебага
- CI pipeline — только для обновлений
