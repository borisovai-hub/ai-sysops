# Runbook: подключение нового сервера

Пошаговая инструкция для добавления нового secondary-сервера в инфраструктуру borisovai-admin. После выполнения новый сервер виден в админке, мониторится централизованно, имеет mTLS-канал с primary.

Реализация: [PLAN_MULTI_SERVER.md](../plans/PLAN_MULTI_SERVER.md). Связанные runbooks: [PKI_STEP_CA.md](PKI_STEP_CA.md).

## Что нужно от нового сервера

| Требование | Зачем |
|------------|-------|
| Debian 11/12 или Ubuntu 22.04+ | Tested OS |
| Минимум 1 vCPU / 1GB RAM / 5GB disk | node-agent + frpc + step CLI |
| Публичный IPv4, SSH к root | Запустить установку |
| Исходящий доступ к `144.91.108.139:9000` (step-ca) | Получение mTLS-cert |
| Исходящий доступ к `144.91.108.139:17420` (frps control) | TCP-туннель node-agent |
| Исходящий доступ к `github.com` (HTTPS) | Клонирование borisovai-admin для сборки node-agent |
| Исходящий доступ к `deb.nodesource.com` и `github.com/smallstep/cli` | Node.js + step CLI бинари |

**Не нужно**: публичных входящих портов, DNS-записей, LE-сертов, RU-proxy конфигурации для нового сервера.

## Архитектура

```
                    ┌─────────────────────────────────────────────┐
                    │  primary contabo-sm-139 (144.91.108.139)    │
                    │  step-ca  :9000  (mTLS, public)             │
                    │  frps     :17420 (control + remote_port)    │
                    │  management-ui :3000 (admin client cert)    │
                    └────────────┬────────────────────────────────┘
                                 │
                ┌────────────────┼──────────────────┐
                ▼                                   ▼
       ┌─────────────────┐                ┌─────────────────┐
       │ secondary #1    │   ...           │ secondary #N    │
       │ frpc → :17522   │                 │ frpc → :17523   │
       │ node-agent:7180 │                 │ node-agent:7180 │
       └─────────────────┘                 └─────────────────┘
```

- Admin делает запросы к node-agent через frps remote_port на primary (`https://144.91.108.139:<port>`)
- Secondary получает/обновляет mTLS-cert у step-ca на primary напрямую (`https://144.91.108.139:9000`)
- Никакого DNS/proxy не требуется

## Onboarding flow

### Шаг 1 — Добавить сервер в реестр через UI

В админке открыть страницу `Servers` (`/servers`), нажать **«Добавить сервер»**, ввести:

| Поле | Пример | Описание |
|------|--------|----------|
| Имя (slug) | `firstvds-sm-22` | `^[a-z][a-z0-9-]+$`, используется в `agent_san` и `config_dir` |
| SSH host (IPv4) | `157.22.203.22` | Publicly accessible IP нового сервера |

После сабмита backend автоматически:
1. Аллоцирует свободный frps remote_port из диапазона `17522..17599` (сканирует `frps_remote_port` в `servers.json`)
2. Генерирует:
   - `agent_url = https://144.91.108.139:<allocated_port>`
   - `agent_san = agent-<name>.internal`
   - `bootstrap_token` — одноразовый JWK от step-ca, TTL 1h
   - `install_token` — bearer-токен со scope `install:<name>`, записывается в `auth_tokens`
3. Возвращает диалог с one-liner командой.

### Шаг 2 — Запустить установку на новом сервере

UI показывает команду формата:

```bash
curl -fsSL -H "Authorization: Bearer <install_token>" \
     https://admin.borisovai.ru/api/servers/install | sudo bash
```

Запустить её на новом сервере (SSH под root):

```bash
ssh root@<NEW_SERVER_IP>
# вставить one-liner из UI
```

**Что делает скрипт** (поэтапно, 5-10 минут):

| Шаг | Действие |
|-----|----------|
| 1/8 | Установка Node.js 20 (`apt install nodejs` через nodesource) + step CLI v0.28.2 |
| 2/8 | `git clone https://github.com/borisovai-hub/ai-sysops.git` в `/opt/borisovai-admin` (если нет), копирование `management-ui/node-agent/` в `/opt/node-agent/`, `npm ci && npm run build` |
| 3/8 | `step ca bootstrap --ca-url https://144.91.108.139:9000 --fingerprint <root_fp>`, затем `step ca certificate <san> --token <bootstrap_token>`. Bundle leaf+intermediate в `agent.crt` |
| 4/8 | `/etc/node-agent/config.json` (server_name, listen, TLS paths, allowed_client_sans) |
| 5/8 | Systemd units: `node-agent.service` + `node-agent-cert-renew.timer` (каждые 6h, --ca-url из `STEPPATH` trust) |
| 6/8 | Self-test через mTLS на 127.0.0.1:7180 (rejected expected — agent's own SAN ≠ allowed admin) |
| 7/8 | Установка frpc v0.66.0 + `/etc/frp/frpc.toml` (TCP-туннель `node-agent:7180 → primary:<frps_remote_port>`), systemd `frpc.service` |
| 8/8 | Сохранение `/root/.borisovai-credentials/node-agent` |

После завершения:

```
=== <name> bootstrap complete ===
В админке нажмите 'Test' на странице Servers.
```

### Шаг 3 — Проверить в админке

1. Открыть `/servers`, нажать **«Test»** на карточке нового сервера → должен стать `reachable=true` (зелёный).
2. Открыть `/monitoring` → новый сервер появится с проверкой `agent: up`.
3. Опционально нажать **«Sync configs»** — `/opt/server-configs` на новом сервере сделает `git pull` (требует deploy-key, см. п.6 ниже).

## Troubleshooting

### Скрипт `install.sh` возвращает HTML вместо bash

Token истёк (TTL 1h) или невалиден. Нажмите в UI **«Новый токен»** на карточке сервера — выдаст свежий install_token.

### `step ca bootstrap` падает с `connection refused`

Step-ca на primary не доступен с нового сервера. Проверить:

```bash
# С нового сервера:
curl -sk https://144.91.108.139:9000/health
# Должно: {"status":"ok"}
```

Если нет — на primary:
```bash
systemctl status step-ca
ss -tln | grep 9000  # должен слушать на 0.0.0.0:9000
ufw status | grep 9000  # должен ALLOW
```

### `frpc` не подключается к `frps`

Проверить с нового сервера:

```bash
curl -sv -m 5 telnet://144.91.108.139:17420 2>&1 | head -5
# Должно установить TCP-соединение
```

Если timeout — провайдер блокирует или ufw на contabo. На contabo:
```bash
ufw status | grep 17420   # должен ALLOW
journalctl -u frps -f     # увидеть incoming connection при следующей попытке
```

### `node-agent` не запускается с `EADDRINUSE 7180`

Старый процесс остался. На новом сервере:

```bash
systemctl stop node-agent
pkill -9 node || true
sleep 2
systemctl start node-agent
```

### `Test` в UI возвращает `unreachable`, при этом node-agent active

Проверить, что frps remote_port открыт и frpc подключён:

```bash
# На contabo (primary):
ss -tln | grep <frps_remote_port>  # должен LISTEN
curl -sk --cert /etc/management-ui/certs/admin.crt \
         --key /etc/management-ui/certs/admin.key \
         --cacert /etc/management-ui/certs/ca.crt \
         --resolve agent-<name>.internal:<port>:127.0.0.1 \
         https://agent-<name>.internal:<port>/health
```

### Cert renewal падает с `missing client certificate`

Это значит, что трафик идёт через HTTPS-прокси (Caddy/Traefik с TLS-termination). Проверить, что CA URL — это **прямой IP** primary (`https://144.91.108.139:9000`), а не DNS-имя с прокси.

В `/etc/systemd/system/node-agent-cert-renew.service` должно быть:
```
ExecStart=/usr/local/bin/step ca renew --force --ca-url https://144.91.108.139:9000 ...
```

См. [PKI_STEP_CA.md → mTLS и прокси](PKI_STEP_CA.md).

## Удаление сервера

В UI на странице `/servers` нажать кнопку Trash на карточке (доступна только для `role=secondary`).

Что произойдёт:
1. `DELETE /api/servers/:name` — удаление из `servers.json`
2. (Опционально вручную) ревокация cert'а агента через step-ca:
   ```bash
   SERIAL=$(step certificate inspect /etc/node-agent/certs/agent.crt --short | grep Serial | awk '{print $4}')
   step ca revoke "$SERIAL" --ca-url https://127.0.0.1:9000 --root /etc/step-ca/certs/root_ca.crt --reason "decommissioned"
   ```

На самом сервере (если есть доступ):
```bash
systemctl stop node-agent node-agent-cert-renew.timer frpc
systemctl disable node-agent node-agent-cert-renew.timer frpc
rm -rf /opt/node-agent /etc/node-agent /etc/frp/frpc.toml /etc/systemd/system/node-agent*.{service,timer} /etc/systemd/system/frpc.service
systemctl daemon-reload
```

## Что осталось доделать вручную (известный tech debt)

1. **GitOps деплой node-agent.** Сейчас обновления `management-ui/node-agent/` доставляются на secondary только при первичной установке (через git clone). При апдейте код надо перезапускать установочный скрипт с `--force` или вручную rsync'ить. → CI/CD job в `.gitlab-ci.yml`.

2. **Deploy-key для `/config/sync`.** На свежем secondary `/opt/server-configs` ─ просто git clone из публичного repo (если есть). Если приватный — нужно сгенерировать SSH-ключ на secondary и добавить как deploy key в GitLab. См. [PHASE5_REMAINING.md §3](../plans/PHASE5_REMAINING.md).

3. **install_token cleanup.** После использования install_token остаётся в `auth_tokens` до ручного удаления. Не критично (scope только `install:<name>` — не даёт ничего кроме повторного скачивания скрипта), но стоит периодически чистить:
   ```sql
   DELETE FROM auth_tokens WHERE name LIKE 'install-%' AND created_at < datetime('now','-1 hour');
   ```

## Reference

| Endpoint | Описание |
|----------|----------|
| `POST /api/servers` | Регистрация сервера. Body: `{name, ssh_host, role: "secondary"}`. Возвращает `install_url`, `install_token`, `bootstrap_command` |
| `POST /api/servers/:name/rotate-token` | Свежий install_token (если старый протух) |
| `GET /api/servers/install` | Bearer: `install_token`. Возвращает `text/x-shellscript` — готовый bash для запуска на новом сервере |
| `POST /api/servers/:name/test` | mTLS-ping агента через node-agent-client |
| `DELETE /api/servers/:name` | Удалить сервер из реестра |

| Файл | Назначение |
|------|------------|
| `/etc/management-ui/servers.json` | Реестр серверов (host, agent_url, frps_remote_port) |
| `/etc/management-ui/certs/admin.{crt,key}` | mTLS client cert для admin (issued by step-ca) |
| `/etc/management-ui/certs/ca.crt` | Bundle root + intermediate для проверки server-cert агентов |
| `/etc/step-ca/config/ca.json` | step-ca config (dnsNames содержит IP 144.91.108.139) |
| `/etc/frp/frps.toml` (primary) | frps config: `bindPort=17420, allowPorts=17500-17599` |
| `/etc/frp/frpc.toml` (secondary) | frpc config: туннель `node-agent:7180 → primary:<port>` |
| `/etc/node-agent/config.json` | server_name, allowed_client_sans, enabled_checkers |
| `/etc/node-agent/certs/agent.{crt,key}` | mTLS server cert агента (24h, auto-renew) |

| Скрипт | Назначение |
|--------|------------|
| `scripts/single-machine/install-step-ca.sh` | Первичная установка step-ca на primary |
| `scripts/single-machine/install-node-agent.sh` | Установка node-agent + frpc на secondary (вызывается из inline-скрипта от `/api/servers/install`) |
| `scripts/single-machine/backup-step-ca-offline.sh` | Оффлайн-бэкап root key step-ca |
