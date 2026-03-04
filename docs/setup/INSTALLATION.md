# Инструкция по установке

## Обзор

Проект содержит скрипты для установки и настройки:
- **GitLab CE** — self-hosted Git и CI/CD
- **Traefik** — reverse proxy с автоматическим Let's Encrypt
- **Management UI** — веб-интерфейс управления инфраструктурой (monorepo: Fastify + React)
- **DNS API** — автоматическое управление поддоменами
- **Authelia** — SSO (ForwardAuth middleware для Traefik)

## Архитектура

```
Сервер (Contabo / single machine)
├── Traefik (порты 80/443) — reverse proxy, Let's Encrypt
├── Management UI (порт 3000) — Fastify v5 backend + React 19 frontend
├── GitLab CE — Git, CI/CD, shell runner
├── DNS API (порт 5353) — управление DNS-записями
├── Authelia (порт 9091) — SSO, ForwardAuth
├── Umami (порт 3001) — веб-аналитика (Docker)
├── n8n — автоматизации (Docker)
└── frps — self-hosted туннели
```

## Требования

- **ОС**: Debian 11/12 или Ubuntu 20.04/22.04
- **RAM**: минимум 4GB (рекомендуется 8GB)
- **CPU**: минимум 4 ядра
- **Диск**: минимум 50GB
- **Node.js**: 20+ (для Management UI и DNS API)
- **Домен** с DNS API (Cloudflare)
- **Email** для Let's Encrypt

## Порядок установки

### Шаг 1: Установка GitLab CE

```bash
chmod +x scripts/single-machine/install-gitlab.sh
sudo ./scripts/single-machine/install-gitlab.sh
```

Скрипт запросит домен для GitLab (например, `gitlab.dev.borisovai.ru`).

После установки:
- Сохраните начальный пароль root
- Создайте Personal Access Token (api scope) для CI/CD интеграции

### Шаг 2: Установка Traefik

```bash
chmod +x scripts/single-machine/install-traefik.sh
sudo ./scripts/single-machine/install-traefik.sh
```

Проверка:
```bash
systemctl status traefik
```

Динамические конфиги генерируются через `configure-traefik.sh` (см. ниже).

### Шаг 3: Настройка DNS API

```bash
chmod +x scripts/single-machine/install-dns-api.sh
sudo ./scripts/single-machine/install-dns-api.sh
```

Проверка:
```bash
manage-dns test
```

### Шаг 4: Установка Management UI

Management UI — monorepo с тремя пакетами:

| Пакет | Стек | Описание |
|-------|------|----------|
| `shared/` | TypeScript | Общие типы, схемы, утилиты |
| `backend/` | Fastify v5, Drizzle ORM, SQLite | API сервер (порт 3000) |
| `frontend/` | React 19, Vite, Tailwind v4 | SPA (собирается и раздаётся backend) |

**Установка:**
```bash
chmod +x scripts/single-machine/install-management-ui.sh
sudo ./scripts/single-machine/install-management-ui.sh
```

Скрипт выполняет:
1. Копирует `management-ui/` в `/opt/management-ui/`
2. Запускает `npm ci && npm run build` (собирает shared, backend, frontend)
3. Создаёт конфиги `/etc/management-ui/config.json` и `auth.json` (при первой установке)
4. Создаёт systemd-сервис `management-ui`
5. База данных SQLite: `/var/lib/management-ui/management-ui.db` (автомиграция при старте через Drizzle)

**Systemd-сервис** запускает:
```bash
node /opt/management-ui/backend/dist/index.js
```

**Конфигурация:**
- `/etc/management-ui/config.json` — GitLab URL/token, Strapi URL/token, порты, пути
- `/etc/management-ui/auth.json` — пароль и bearer-токены (создаётся один раз, не перезаписывается)

**Порт**: 3000 (проксируется через Traefik на `admin.borisovai.ru` / `admin.borisovai.tech`)

**Обновление** (переустановка без потери данных):
```bash
sudo ./scripts/single-machine/install-management-ui.sh --force
```
Флаг `--force` обновляет файлы приложения, но сохраняет `auth.json`, `config.json` и БД.

Проверка:
```bash
systemctl status management-ui
curl http://localhost:3000/api/health
```

### Шаг 5: Генерация Traefik-конфигов

```bash
chmod +x scripts/single-machine/configure-traefik.sh
sudo ./scripts/single-machine/configure-traefik.sh
```

Генерирует YAML для всех сервисов в `/etc/traefik/dynamic/` с двумя базовыми доменами (.ru и .tech).

### Шаг 6: Установка Authelia (опционально)

```bash
chmod +x scripts/single-machine/install-authelia.sh
sudo ./scripts/single-machine/install-authelia.sh
```

Защищает Management UI, n8n, Mailu, Umami через ForwardAuth middleware.

## Проверка и диагностика

```bash
# Все сервисы
systemctl status traefik management-ui authelia

# GitLab
gitlab-ctl status

# Логи
journalctl -u management-ui -f
journalctl -u traefik -f

# Traefik конфиги
ls -la /etc/traefik/dynamic/

# Management UI БД
ls -la /var/lib/management-ui/management-ui.db
```

## Решение проблем

### Management UI не запускается
```bash
journalctl -u management-ui -n 50
# Проверьте что БД доступна
ls -la /var/lib/management-ui/
# Проверьте конфиг
cat /etc/management-ui/config.json
```

### SSL сертификат не получается
```bash
journalctl -u traefik | grep -i acme
ls -la /var/lib/traefik/acme/acme.json
```

### DNS записи не создаются
```bash
manage-dns test
cat /etc/dns-api/config.json
```

## Безопасность

1. **Authelia SSO**: Все административные сервисы защищены двухфакторной аутентификацией
2. **Bearer-токены**: API Management UI требует авторизацию (auth.json)
3. **Firewall**: Настройте UFW — открыть только 80 и 443
4. **Обновления**: `apt update && apt upgrade -y`
5. **Секреты**: GitLab CI Variables (masked) для GITLAB_TOKEN, STRAPI_TOKEN
