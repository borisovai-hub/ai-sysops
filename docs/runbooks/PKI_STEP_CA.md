# Runbook: step-ca (внутренний PKI)

step-ca — self-hosted CA для выдачи короткоживущих mTLS-сертификатов в канале admin↔node-agent. Установлен на primary (`contabo-sm-139`).

Архитектурный план: [PLAN_MULTI_SERVER.md](../plans/PLAN_MULTI_SERVER.md).

## Параметры

| Параметр | Значение | Где меняется |
|----------|----------|--------------|
| CA name | `borisovai-internal` | `install-config.json` → `step_ca_name` |
| Listen | `127.0.0.1:9000` | `step_ca_port` |
| External | `https://ca.tunnel.borisovai.ru` (TCP passthrough) | `step_ca_prefix` |
| Default cert lifetime | 24h | `step_ca_default_dur` |
| Max cert lifetime | 24h | `ca.json` → `authority.claims.maxTLSCertDuration` |
| Renewal grace | 8h | `ca.json` → `authority.claims.renewalPeriod` |
| Provisioner: admin-bootstrap | JWK, single-use bootstrap-токены | `step ca provisioner` |
| Provisioner: acme | ACME для авто-renew | `step ca provisioner` |
| Backup | ежедневно 03:00, retention 30 дней | `/usr/local/sbin/step-ca-backup.sh` |

Файлы: `/etc/step-ca/` (PKI, db, secrets), `/var/backups/step-ca/` (ежедневные tgz), `/root/.borisovai-credentials/step-ca` (URL, fingerprint).

## Установка

```bash
cd /opt/borisovai-admin/scripts/single-machine
sudo ./install-step-ca.sh
```

После успешного запуска **обязательно** выполнить процедуру оффлайн-бэкапа root key (см. ниже).

## Оффлайн-бэкап root key

**Зачем**: root key — основа доверия всему PKI. Если он скомпрометирован — переподписывать всё (intermediate, agent certs, admin cert). Если потерян и интермедиейт скомпрометирован — придётся поднимать новый CA с нуля и настраивать всех агентов заново.

**Правило двух копий**: одна на физическом носителе в сейфе, вторая в облачном backup в зашифрованном виде. Обе НЕ хранятся вместе с паролем для расшифровки.

### Шаги (выполнить в течение 24h после установки)

1. **Подготовить зашифрованную флешку**:
   - LUKS на Linux или VeraCrypt на Windows.
   - Размер ≥ 16 МБ (файлы крошечные, но запас для второй копии).

2. **Скопировать на флешку**:
   ```bash
   # На сервере:
   cp /etc/step-ca/root-export/root_ca.crt        /mnt/usb/
   cp /etc/step-ca/root-export/root_ca_key.encrypted  /mnt/usb/
   cp /etc/step-ca/secrets/password               /mnt/usb/CA_PASSWORD.txt
   ```
   Пароль — на той же флешке. Флешка в **физическом сейфе**.

3. **Создать вторую копию (облачный backup)**:
   ```bash
   cd /tmp
   tar czf root-backup.tgz -C /etc/step-ca secrets/password root-export/
   gpg --symmetric --cipher-algo AES256 --output root-backup.tgz.gpg root-backup.tgz
   shred -u root-backup.tgz
   # Загрузить root-backup.tgz.gpg в S3/Backblaze/Yandex.Cloud Object Storage
   ```
   GPG-passphrase для расшифровки записать в **password manager** (Bitwarden / 1Password) — отдельно от облачного хранилища.

4. **Удалить экспорт с сервера** (root_ca.crt и intermediate остаются в `/etc/step-ca/certs/` — они нужны для работы CA, удаляется только `root-export/` директория):
   ```bash
   shred -u /etc/step-ca/root-export/root_ca_key.encrypted
   rm /etc/step-ca/root-export/README_OFFLINE_BACKUP.txt
   rmdir /etc/step-ca/root-export/ 2>/dev/null || rm -rf /etc/step-ca/root-export/
   ```

5. **Записать в календарь напоминание** на тест восстановления через 6 месяцев.

### Тест восстановления (раз в полгода)

На отдельной (не production) машине:

```bash
# Распаковать копию
gpg --decrypt root-backup.tgz.gpg | tar xz -C /tmp/restore-test

# Проверить что cert валидный
openssl x509 -in /tmp/restore-test/root-export/root_ca.crt -noout -subject -dates -fingerprint

# Проверить что ключ расшифровывается паролем
step crypto change-pass /tmp/restore-test/root-export/root_ca_key.encrypted \
  --password-file /tmp/restore-test/secrets/password \
  --no-password

# Очистить
shred -u /tmp/restore-test/root-export/* && rm -rf /tmp/restore-test
```

Если тест провалился — подготовить новый бэкап **немедленно**, старый считать невалидным.

## Бутстрап нового агента (выдача cert'а)

Агент на новом сервере получает cert через одноразовый JWK-токен от admin-bootstrap provisioner.

**Из админки** (после готовности `/api/servers` в Фазе 2): кнопка «Add server» → токен показывается один раз.

**Вручную из CLI** (для тестирования / disaster recovery):

```bash
# На primary, выдать токен (TTL 1h, single-use)
sudo /usr/local/bin/step ca token \
  agent-firstvds-sm-22.internal \
  --provisioner admin-bootstrap \
  --provisioner-password-file /etc/step-ca/secrets/provisioner-password \
  --ca-url https://127.0.0.1:9000 \
  --root /etc/step-ca/certs/root_ca.crt \
  --not-after 1h

# На новом сервере (firstvds-sm-22), bootstrap + получение cert
ROOT_FP=$(cat /root/.borisovai-credentials/step-ca | grep root_fingerprint= | cut -d= -f2)
step ca bootstrap \
  --ca-url https://ca.tunnel.borisovai.ru \
  --fingerprint "$ROOT_FP"

step ca certificate \
  agent-firstvds-sm-22.internal \
  /etc/node-agent/certs/agent.crt \
  /etc/node-agent/certs/agent.key \
  --token "<токен из шага 1>"
```

## Принудительная ротация cert'а

```bash
# На сервере с агентом
step ca renew --force /etc/node-agent/certs/agent.crt /etc/node-agent/certs/agent.key
systemctl reload node-agent
```

Auto-renew работает каждые 6h через systemd timer, ручная ротация нужна только при инциденте или при тестировании.

## Ревокация cert'а удалённого сервера

```bash
# Получить serial удаляемого cert'а
step certificate inspect /path/to/agent.crt --short | grep Serial

# Ревокация в step-ca
sudo /usr/local/bin/step ca revoke <serial> \
  --ca-url https://127.0.0.1:9000 \
  --root /etc/step-ca/certs/root_ca.crt \
  --reason "server decommissioned"
```

CRL обновляется автоматически. Агенты должны fetch'ить CRL каждые 5 минут (настраивается в node-agent при реализации).

## Восстановление из backup

### step-ca DB / config испорчен (root key цел)

```bash
sudo systemctl stop step-ca
LATEST=$(ls -t /var/backups/step-ca/step-ca-*.tgz | head -1)
sudo tar xzf "$LATEST" -C /etc/step-ca
sudo systemctl start step-ca
```

### Скомпрометирован intermediate (root цел)

1. Принести root оффлайн на сервер.
2. Сгенерировать новый intermediate, подписанный root:
   ```bash
   step certificate create "borisovai-internal Intermediate CA v2" \
     /etc/step-ca/certs/intermediate_ca.crt \
     /etc/step-ca/secrets/intermediate_ca_key \
     --ca /tmp/restored-root/root_ca.crt \
     --ca-key /tmp/restored-root/root_ca_key.encrypted \
     --profile intermediate-ca \
     --not-after 87600h
   ```
3. Перезапустить step-ca: `systemctl restart step-ca`.
4. На каждом агенте обновить `ca.crt` bundle через `/api/servers/:name/sync` или вручную:
   ```bash
   scp new-ca-bundle.crt server:/etc/node-agent/certs/ca.crt
   systemctl reload node-agent
   ```
5. **Не забыть стереть root с сервера** после операции (вернуть на флешку).

### Скомпрометирован root

Катастрофа. Поднимаем новый CA, переустанавливаем всех агентов с новыми bootstrap-токенами. См. процедуру первичной установки.

## Диагностика

```bash
# Статус сервиса
systemctl status step-ca
journalctl -u step-ca -n 100

# Health
curl -sk https://127.0.0.1:9000/health

# Список provisioner'ов
step ca provisioner list \
  --ca-url https://127.0.0.1:9000 \
  --root /etc/step-ca/certs/root_ca.crt

# Срок до истечения root и intermediate
step certificate inspect /etc/step-ca/certs/root_ca.crt --short
step certificate inspect /etc/step-ca/certs/intermediate_ca.crt --short

# Проверить external endpoint (TCP passthrough через Traefik)
curl -sk https://ca.tunnel.borisovai.ru/health
```

## Failure modes

См. секцию «Failure modes и митигации» в [PLAN_MULTI_SERVER.md](../plans/PLAN_MULTI_SERVER.md).
