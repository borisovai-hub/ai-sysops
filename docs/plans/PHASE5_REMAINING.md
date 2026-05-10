# Tech debt после Phase 5 — что осталось вручную

После завершения Phase 4+5 multi-server инфраструктура работает. Остались задачи требующие ручных действий пользователя или внешних доступов.

## 1. Оффлайн-бэкап root key (КРИТИЧНО, сделать первым)

Root key step-ca всё ещё в `/etc/step-ca/root-export/` на contabo-sm-139. Без оффлайн-бэкапа компрометация сервера = катастрофа PKI.

```bash
ssh root@144.91.108.139
sudo /opt/borisovai-admin/scripts/single-machine/backup-step-ca-offline.sh
# Скрипт создаст зашифрованный архив /root/step-ca-root-*.tar.gz.gpg
# и проведёт через шаги переноса на флешку и в облачный backup.
```

После успешной проверки восстановления — удалить копию с сервера. См. подробную процедуру: [docs/runbooks/PKI_STEP_CA.md](../runbooks/PKI_STEP_CA.md) → секция «Оффлайн-бэкап root key».

## 2. Регенерация GitLab PAT

Сейчас в `/etc/management-ui/config.json` лежит `gitlab_token: glpat-...` который **просрочен**. Это ломает:
- API-вызовы к GitLab из management-ui (создание deploy-ключей, регистрация раннеров)
- `/opt/server-configs` git pull (CI-token в URL ALSO просрочен — баннер выводился на /api/servers/:name/sync)

**Действие**: войти в GitLab https://gitlab.dev.borisovai.tech → User Settings → Access Tokens → создать новый PAT со scope `api, read_repository, write_repository`, expiration ≥ 1 год.

Затем обновить `/etc/management-ui/config.json`:
```json
"gitlab_token": "glpat-<новый_токен>"
```

И обновить `/opt/server-configs` remote URL на contabo:
```bash
cd /opt/server-configs
git remote set-url origin "https://oauth2:<новый_токен>@gitlab.dev.borisovai.tech/tools/server-configs.git"
git pull
```

После этого `POST /api/servers/contabo-sm-139/sync` начнёт работать.

## 3. Deploy-key для firstvds-sm-22

Чтобы `/api/servers/firstvds-sm-22/sync` тоже работал, на firstvds нужен SSH-deploy ключ к GitLab.

Ключ уже сгенерирован на firstvds: `/root/.ssh/server_configs_deploy.pub`:
```
ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7yR2Na72vwL0u39nKJ/X26PxqzgQdrSNKsNP+jag+V deploy@firstvds-sm-22
```

После регенерации PAT (п.2):
```bash
ssh root@144.91.108.139
TOK="glpat-<новый_токен>"
PUBKEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIB7yR2Na72vwL0u39nKJ/X26PxqzgQdrSNKsNP+jag+V deploy@firstvds-sm-22"

# Project ID для tools/server-configs
PID=$(curl -s -H "PRIVATE-TOKEN: $TOK" "https://gitlab.dev.borisovai.tech/api/v4/projects/tools%2Fserver-configs" | python3 -c "import json,sys; print(json.load(sys.stdin)['id'])")

# Добавить deploy key (read-only)
curl -s -H "PRIVATE-TOKEN: $TOK" -H "Content-Type: application/json" \
  -X POST "https://gitlab.dev.borisovai.tech/api/v4/projects/$PID/deploy_keys" \
  -d "{\"title\":\"firstvds-sm-22 read-only\",\"key\":\"$PUBKEY\",\"can_push\":false}"
```

Затем на firstvds переключить remote:
```bash
ssh root@157.22.203.22
# known_hosts для GitLab (порт 22 на 144.91.108.139)
ssh-keyscan -H 144.91.108.139 >> /root/.ssh/known_hosts
# или через DNS:
ssh-keyscan -H gitlab.dev.borisovai.tech >> /root/.ssh/known_hosts

cd /opt/server-configs
rm -rf .git  # удалить пустой placeholder
GIT_SSH_COMMAND='ssh -i /root/.ssh/server_configs_deploy' \
  git clone git@144.91.108.139:tools/server-configs.git /tmp/sc
mv /tmp/sc/.git /opt/server-configs/.git
cd /opt/server-configs
git config core.sshCommand "ssh -i /root/.ssh/server_configs_deploy"
git checkout main -f
```

После этого `POST /api/servers/firstvds-sm-22/sync` начнёт получать обновления.

## 4. Публичный DNS для ca.tunnel.borisovai.ru

Сейчас на firstvds запись добавлена через `/etc/hosts` (idempotent в install-node-agent.sh). Это работает, но фрагильно — при добавлении 3+ серверов администратор должен помнить про hosts entry.

NS у borisovai.ru — ihc.ru (хостинг-провайдер). Cloudflare API не настроен. Действие:
1. Войти в панель ihc.ru
2. Добавить A-запись: `ca.tunnel.borisovai.ru` → `144.91.108.139` (TTL 300)
3. После пропагандации проверить: `dig +short ca.tunnel.borisovai.ru`
4. После этого можно убрать `/etc/hosts` хак на firstvds:
   ```bash
   ssh root@157.22.203.22 "sed -i '/ca.tunnel.borisovai.ru/d' /etc/hosts"
   ```

Альтернатива (если планируется много серверов): мигрировать DNS на Cloudflare и добавить API-токен в management-ui для автоматизации.

## 5. CI/CD деплой management-ui (вместо ручного scp)

Сейчас обновления management-ui+node-agent шли через локальный `tar czf | scp | systemctl restart`. Это ОК для разработки, но не для продакшена.

`borisovai-admin/.gitlab-ci.yml` уже содержит pipeline `validate → deploy → verify`. Нужно проверить что:
- Деплой push'ит management-ui dist на contabo (вероятно уже работает)
- node-agent тоже деплоится (новый компонент — CI ещё не знает о нём)

Действие:
1. Открыть `.gitlab-ci.yml` и добавить шаг `deploy:node-agent` который копирует `management-ui/node-agent/` в `/opt/borisovai-admin/management-ui/node-agent/`, затем для каждого сервера в реестре делает `cp -r src + npm ci + npm run build + systemctl restart node-agent` через SSH.
2. Добавить runner-теги для secondary серверов (сейчас runner только на contabo).

Не блокирует работу — текущий ad-hoc деплой работает. Но сделать в ближайшие итерации.

## 6. Cleanup унаследованных алертов

После рефакторинга мониторинга (Phase 3) появился 1 active alert на `health:contabo-sm-139:agent` от первого fan-out где agent был помечен down (на момент когда management-ui ещё не имел admin cert).

```bash
ssh root@144.91.108.139
sqlite3 /var/lib/management-ui/management-ui.db "SELECT id, source, status, message FROM alerts WHERE status='active';"
# Удалить через UI (страница /monitoring → Resolve) или SQL:
# UPDATE alerts SET status='resolved' WHERE status='active';
```

## Приоритет

1. (1) Оффлайн-бэкап root key — **в первые 24h** (security-critical)
2. (2+3) GitLab PAT + deploy-key — когда нужно реально пользоваться `/sync` (не блокирует мониторинг)
3. (4) Public DNS — при добавлении 3-го сервера (сейчас 2 — managable)
4. (5) CI/CD — следующая итерация
5. (6) Cleanup алерта — мелочь
