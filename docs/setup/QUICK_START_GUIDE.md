# Быстрое руководство по установке

Все компоненты устанавливаются на один сервер (single machine). Время: ~25 минут.

## 1. GitLab CE — 5 мин

```bash
sudo ./scripts/single-machine/install-gitlab.sh
# Введите домен для GitLab
# Сохраните начальный пароль root!
```

## 2. Traefik — 3 мин

```bash
sudo ./scripts/single-machine/install-traefik.sh
# Введите email для Let's Encrypt
```

## 3. DNS API — 2 мин

```bash
sudo ./scripts/single-machine/install-dns-api.sh
# Выберите провайдера (Cloudflare) и введите данные
manage-dns test
```

## 4. Management UI — 5 мин

Monorepo: Fastify v5 backend + React 19 frontend + shared types.

```bash
sudo ./scripts/single-machine/install-management-ui.sh
```

Скрипт:
- Копирует `management-ui/` в `/opt/management-ui/`
- Собирает все пакеты: `npm ci && npm run build` (shared -> backend + frontend)
- Создаёт конфиги в `/etc/management-ui/` (config.json, auth.json)
- БД: SQLite `/var/lib/management-ui/management-ui.db` (автомиграция через Drizzle)
- Запускает systemd-сервис (`node backend/dist/index.js`, порт 3000)

Обновление без потери данных:
```bash
sudo ./scripts/single-machine/install-management-ui.sh --force
```

## 5. Traefik-конфиги — 2 мин

```bash
sudo ./scripts/single-machine/configure-traefik.sh
# Генерирует YAML для всех сервисов с .ru и .tech доменами
```

## 6. Authelia SSO (опционально) — 3 мин

```bash
sudo ./scripts/single-machine/install-authelia.sh
# Защищает Management UI, n8n, Mailu, Umami
```

## 7. frps туннели (опционально) — 2 мин

```bash
sudo ./scripts/single-machine/install-frps.sh
```

## 8. Umami Analytics (опционально) — 3 мин

```bash
sudo ./scripts/single-machine/install-umami.sh
# Docker: Umami + SQLite
```

## Проверка

```bash
# Статус сервисов
systemctl status traefik management-ui authelia

# GitLab
gitlab-ctl status

# Health check
curl http://localhost:3000/api/health

# В браузере:
# - https://admin.borisovai.ru (Management UI)
# - https://gitlab.dev.borisovai.ru (GitLab)
# - https://auth.borisovai.ru (Authelia)
```

## Полезные команды

```bash
# Логи
journalctl -u management-ui -f
journalctl -u traefik -f

# DNS
manage-dns create subdomain 1.2.3.4
manage-dns delete subdomain
manage-dns test

# Traefik конфиги
ls /etc/traefik/dynamic/

# Management UI БД
ls -la /var/lib/management-ui/management-ui.db
```

## Решение проблем

### Management UI не запускается
```bash
journalctl -u management-ui -n 50
ls -la /var/lib/management-ui/
cat /etc/management-ui/config.json
```

### GitLab не доступен
```bash
curl http://localhost
gitlab-ctl status
```

### SSL не работает
```bash
journalctl -u traefik | grep -i acme
ls -la /var/lib/traefik/acme/acme.json
```

### DNS не создается
```bash
manage-dns test
cat /etc/dns-api/config.json
```
