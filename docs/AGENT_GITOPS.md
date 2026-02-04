# Инструкция для агента: GitOps CI/CD borisovai-admin

Руководство по CI/CD pipeline для автоматического деплоя borisovai-admin на сервер при push в main.

## Обзор

При каждом push в ветку `main` репозитория borisovai-admin запускается GitLab CI pipeline:

```
validate → deploy → verify
```

Pipeline выполняется на сервере через shell runner с тегом `deploy-production`.

## Архитектура

### Разделение данных

| Категория | Где хранится | Примеры |
|-----------|-------------|---------|
| Конфиги (не секреты) | Git — шаблоны с плейсхолдерами | base_domain, base_port, runner_tag, пути |
| Секреты | GitLab CI Variables (masked) | gitlab_token, strapi_token |
| Динамические данные | Только на сервере | projects.json, auth.json, records.json |

### Файлы

```
borisovai-admin/
├── .gitlab-ci.yml                              # Pipeline: validate → deploy → verify
├── config/single-machine/
│   ├── management-ui.config.json               # Шаблон конфига Management UI
│   └── dns-api.config.json                     # Шаблон конфига DNS API
└── scripts/ci/
    ├── render-configs.sh                       # Подстановка переменных в шаблоны
    ├── deploy-management-ui.sh                 # Деплой Management UI
    ├── deploy-dns-api.sh                       # Деплой DNS API
    └── health-check.sh                         # Пост-деплой проверка
```

## Настройка CI Variables

В GitLab → Settings → CI/CD → Variables задать:

| Переменная | Значение | Protected | Masked |
|-----------|----------|-----------|--------|
| `GITLAB_URL` | `https://git.borisovai.ru` | нет | нет |
| `GITLAB_TOKEN` | Personal Access Token (api) | да | да |
| `STRAPI_URL` | `http://127.0.0.1:1337` | нет | нет |
| `STRAPI_TOKEN` | API токен Strapi | да | да |
| `BASE_DOMAIN` | `borisovai.ru` | нет | нет |

## Шаблоны конфигов

### management-ui.config.json

```json
{
  "gitlab_url": "{{GITLAB_URL}}",
  "gitlab_token": "{{GITLAB_TOKEN}}",
  "strapi_url": "{{STRAPI_URL}}",
  "strapi_token": "{{STRAPI_TOKEN}}",
  "base_port": 4010,
  "runner_tag": "deploy-production",
  "main_site_path": "/var/www/borisovai-site",
  "deploy_base_path": "/var/www"
}
```

### dns-api.config.json

```json
{
  "provider": "local",
  "domain": "{{BASE_DOMAIN}}",
  "port": 5353
}
```

Плейсхолдеры `{{VARIABLE}}` заменяются на значения CI Variables скриптом `render-configs.sh`.

## Стадии pipeline

### 1. validate

Проверяет наличие всех обязательных CI Variables без рендеринга:

```bash
bash scripts/ci/render-configs.sh --validate
```

Fail-fast: если хотя бы одна переменная не задана — pipeline останавливается.

### 2. deploy

Последовательно выполняет:

1. **Рендеринг конфигов** — `render-configs.sh` создаёт `rendered-configs/*.json` (chmod 600)
2. **Деплой Management UI** — `deploy-management-ui.sh`:
   - `rsync -av --delete --exclude=node_modules management-ui/ → /opt/management-ui/`
   - Копирует rendered config → `/etc/management-ui/config.json`
   - `npm ci --production`
   - `systemctl restart management-ui`
3. **Деплой DNS API** — `deploy-dns-api.sh`:
   - `rsync -av --delete --exclude=node_modules scripts/dns-api/ → /opt/dns-api/`
   - Копирует rendered config → `/etc/dns-api/config.json`
   - `systemctl restart dns-api` (если сервис существует)
4. **Копирование скриптов** — `scripts/single-machine/` → `/opt/borisovai-admin/scripts/single-machine/`

### 3. verify

Проверка здоровья сервисов:

- Management UI (порт 3000) — **обязательно**, при ошибке pipeline падает
- DNS API (порт 5353) — опционально (предупреждение)
- Traefik (порт 8080) — опционально (предупреждение)

## Гарантии безопасности

- **auth.json** — никогда не перезаписывается (создаётся только при `install-management-ui.sh`)
- **projects.json** — никогда не трогается (динамические данные оркестратора)
- **records.json** — никогда не трогается (DNS записи)
- Секреты хранятся только в CI Variables (masked), не в Git
- `rendered-configs/` — в `.gitignore`, файлы с chmod 600

## Первичная установка vs CI деплой

| | Первичная установка | CI деплой |
|---|---|---|
| **Когда** | Новый сервер | Обновление кода |
| **Скрипт** | `install-management-ui.sh` | CI pipeline |
| **auth.json** | Создаёт (random password) | Не трогает |
| **projects.json** | Создаёт пустой | Не трогает |
| **config.json** | Создаёт из параметров | Перезаписывает из шаблона |
| **systemd** | Создаёт unit | Перезапускает |
| **node_modules** | npm install | npm ci |

## Troubleshooting

### Pipeline не запускается

- Проверить что push в ветку `main`
- Проверить что runner с тегом `deploy-production` online: Settings → CI/CD → Runners

### validate fails: переменная не задана

- Проверить Settings → CI/CD → Variables — все 5 переменных должны быть заданы

### deploy fails: rsync error

- Проверить что `/opt/management-ui/` существует (первичная установка выполнена)
- Проверить права: runner должен иметь доступ к `/opt/management-ui/`

### deploy fails: npm ci error

- Проверить что Node.js установлен и доступен для runner
- Проверить `package.json` и `package-lock.json` синхронизированы

### verify fails: Management UI не отвечает

- Проверить логи: `journalctl -u management-ui -n 50`
- Проверить конфиг: `cat /etc/management-ui/config.json`
- Проверить порт: `ss -tlnp | grep 3000`

## Ручной деплой (альтернатива)

Для отладки или при проблемах с CI можно использовать `upload-single-machine.ps1`:

```powershell
# С Windows
.\scripts\upload-single-machine.ps1
```

Скрипт копирует файлы через SCP и перезапускает сервисы через SSH.
