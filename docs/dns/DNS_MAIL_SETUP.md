# Настройка DNS записей для почтового сервера

Инструкция по настройке DNS записей верхнего уровня для корректной работы почтового сервера Mailu.

## Предварительные требования

- Доступ к DNS панели регистратора домена (или Cloudflare/DigitalOcean)
- IP-адрес сервера с установленным Mailu
- Базовый домен для адресов (например, `borisovai.ru`)
- Хост почтового сервиса (рекомендуется: `mail.dev.borisovai.ru` — веб-интерфейс и SMTP/IMAP на этом хосте)

## Схема DNS записей

**Рекомендуемая схема:** почтовый домен `borisovai.ru`, сервис размещён по адресу `mail.dev.borisovai.ru`. В MX, SPF и A-записях указывается хост сервиса: `mail.dev.borisovai.ru`.

```
Пример для домена: borisovai.ru
Хост почтового сервиса: mail.dev.borisovai.ru
IP сервера: 123.45.67.89
```

---

## 1. A-записи (обязательно)

A-записи указывают IP-адрес сервера для доменного имени.

| Тип | Имя | Значение | TTL |
|-----|-----|----------|-----|
| A | `mail.dev` | `123.45.67.89` | 3600 |
| A | `@` | `123.45.67.89` | 3600 |

**Пояснение:** для хоста `mail.dev.borisovai.ru` нужна A-запись для поддомена `mail.dev` (или общая запись `*.dev`). Либо укажите полное имя в панели DNS (например, `mail.dev` в зоне borisovai.ru → mail.dev.borisovai.ru).
- `@` — корневой домен (borisovai.ru), если веб-сервер на том же IP

### Для IPv6 (если есть):

| Тип | Имя | Значение | TTL |
|-----|-----|----------|-----|
| AAAA | `mail.dev` | `2001:db8::1` | 3600 |

---

## 2. MX-записи (обязательно)

MX-записи определяют сервер, который принимает почту для домена.

| Тип | Имя | Приоритет | Значение | TTL |
|-----|-----|-----------|----------|-----|
| MX | `@` | 10 | `mail.dev.borisovai.ru` | 3600 |

**Пояснение:**
- Имя `@` означает корневой домен (borisovai.ru)
- Значение — хост почтового сервиса (mail.dev.borisovai.ru)
- Приоритет `10` — стандартное значение (меньше = выше приоритет)
- В некоторых DNS панелях значение указывают с точкой в конце: `mail.dev.borisovai.ru.`

**Несколько MX-серверов (резервирование):**

| Тип | Имя | Приоритет | Значение | TTL |
|-----|-----|-----------|----------|-----|
| MX | `@` | 10 | `mail.dev.borisovai.ru` | 3600 |
| MX | `@` | 20 | `backup-mail.dev.borisovai.ru` | 3600 |

---

## 3. SPF-запись (обязательно)

SPF (Sender Policy Framework) указывает, какие серверы могут отправлять почту от имени домена.

| Тип | Имя | Значение | TTL |
|-----|-----|----------|-----|
| TXT | `@` | `v=spf1 mx a:mail.dev.borisovai.ru -all` | 3600 |

**Варианты SPF:**

```
# Строгий (рекомендуется) — отклонять письма с неавторизованных серверов
v=spf1 mx a:mail.dev.borisovai.ru -all

# Мягкий — помечать письма как подозрительные
v=spf1 mx a:mail.dev.borisovai.ru ~all

# С указанием IP-адреса
v=spf1 mx a:mail.dev.borisovai.ru ip4:123.45.67.89 -all

# С IPv6
v=spf1 mx a:mail.dev.borisovai.ru ip4:123.45.67.89 ip6:2001:db8::1 -all
```

**Расшифровка:**
- `v=spf1` — версия SPF
- `mx` — разрешить серверам из MX-записей
- `a:mail.dev.borisovai.ru` — разрешить серверу с этим именем
- `ip4:123.45.67.89` — разрешить конкретный IP
- `-all` — отклонять все остальные (строгий режим)
- `~all` — мягкий режим (помечать как спам)

---

## 4. DKIM-запись (обязательно)

DKIM (DomainKeys Identified Mail) позволяет подписывать письма криптографическим ключом.

### Получение DKIM ключа из Mailu

1. Войдите в админку Mailu: `https://mail.dev.borisovai.ru/admin`
2. Перейдите в **Mail domains** → выберите домен
3. Скопируйте DKIM публичный ключ

Или через командную строку:
```bash
# Просмотр DKIM ключа
cat /opt/mailu/dkim/borisovai.ru.dkim.key

# Или через Docker
docker exec mailu-admin cat /dkim/borisovai.ru.dkim.key
```

### Создание DNS записи

| Тип | Имя | Значение | TTL |
|-----|-----|----------|-----|
| TXT | `dkim._domainkey` | `v=DKIM1; k=rsa; p=MIIBIjANBg...` | 3600 |

**Формат записи:**
```
v=DKIM1; k=rsa; p=<публичный_ключ_base64>
```

**Пример полной записи:**
```
dkim._domainkey.borisovai.ru. IN TXT "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1234567890..."
```

**Важно:**
- Селектор по умолчанию в Mailu: `dkim`
- Если ключ длинный, DNS панель может разбить его на несколько строк — это нормально

---

## 5. DMARC-запись (рекомендуется)

DMARC определяет политику обработки писем, не прошедших SPF/DKIM проверку.

| Тип | Имя | Значение | TTL |
|-----|-----|----------|-----|
| TXT | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:dmarc@borisovai.ru` | 3600 |

**Варианты политик:**

```
# Карантин (рекомендуется для начала)
v=DMARC1; p=quarantine; rua=mailto:dmarc@borisovai.ru

# Отклонение (строгий режим)
v=DMARC1; p=reject; rua=mailto:dmarc@borisovai.ru

# Только мониторинг (для тестирования)
v=DMARC1; p=none; rua=mailto:dmarc@borisovai.ru

# Полная запись с процентами
v=DMARC1; p=quarantine; sp=quarantine; pct=100; rua=mailto:dmarc@borisovai.ru; ruf=mailto:dmarc-forensic@borisovai.ru
```

**Расшифровка:**
- `p=none/quarantine/reject` — политика для основного домена
- `sp=` — политика для поддоменов
- `pct=100` — применять к 100% писем
- `rua=mailto:...` — адрес для агрегированных отчетов
- `ruf=mailto:...` — адрес для детальных отчетов

---

## 6. PTR-запись (Reverse DNS) — критически важно!

PTR-запись связывает IP-адрес с доменным именем (обратная DNS).

**Без PTR записи многие почтовые серверы будут отклонять вашу почту!**

### Настройка PTR

PTR-запись настраивается **у провайдера хостинга**, а не у регистратора домена.

| IP | PTR значение |
|----|--------------|
| `123.45.67.89` | `mail.dev.borisovai.ru` |

**Где настроить:**
- **Hetzner**: Robot → Server → IPs → rDNS
- **DigitalOcean**: Networking → PTR Records (автоматически по Droplet name)
- **Vultr**: Products → Server → Settings → Reverse DNS
- **OVH**: IP → Manage IPs → Reverse DNS
- **Selectel**: Сети → IP-адреса → PTR

### Проверка PTR

```bash
# Проверка PTR записи
dig -x 123.45.67.89

# Или через nslookup
nslookup 123.45.67.89
```

**Ожидаемый результат:**
```
89.67.45.123.in-addr.arpa. PTR mail.dev.borisovai.ru.
```

---

## 7. Записи для автонастройки почтовых клиентов

Эти записи позволяют почтовым клиентам (Outlook, Thunderbird, iOS Mail) автоматически определять настройки сервера.

### Autodiscover (для Outlook)

| Тип | Имя | Значение | TTL |
|-----|-----|----------|-----|
| CNAME | `autodiscover` | `mail.dev.borisovai.ru` | 3600 |

Или SRV-запись:

| Тип | Имя | Приоритет | Вес | Порт | Значение |
|-----|-----|-----------|-----|------|----------|
| SRV | `_autodiscover._tcp` | 0 | 0 | 443 | `mail.dev.borisovai.ru` |

### Autoconfig (для Thunderbird)

| Тип | Имя | Значение | TTL |
|-----|-----|----------|-----|
| CNAME | `autoconfig` | `mail.dev.borisovai.ru` | 3600 |

### SRV-записи для автонастройки (опционально)

| Тип | Имя | Приоритет | Вес | Порт | Значение |
|-----|-----|-----------|-----|------|----------|
| SRV | `_imaps._tcp` | 0 | 1 | 993 | `mail.dev.borisovai.ru` |
| SRV | `_submission._tcp` | 0 | 1 | 587 | `mail.dev.borisovai.ru` |

---

## 8. Полный пример DNS зоны

```dns
; A-записи
@           IN  A       123.45.67.89
mail        IN  A       123.45.67.89

; MX-запись
@           IN  MX  10  mail.dev.borisovai.ru.

; SPF
@           IN  TXT     "v=spf1 mx a:mail.dev.borisovai.ru -all"

; DKIM (ключ получить из Mailu)
dkim._domainkey IN TXT  "v=DKIM1; k=rsa; p=MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA..."

; DMARC
_dmarc      IN  TXT     "v=DMARC1; p=quarantine; rua=mailto:dmarc@borisovai.ru"

; Автонастройка клиентов
autodiscover    IN  CNAME   mail.dev.borisovai.ru.
autoconfig      IN  CNAME   mail.dev.borisovai.ru.

; SRV записи (опционально)
_imaps._tcp     IN  SRV     0 1 993 mail.dev.borisovai.ru.
_submission._tcp IN SRV     0 1 587 mail.dev.borisovai.ru.
```

---

## 9. Проверка DNS записей

### Онлайн-инструменты

- **MX Toolbox**: https://mxtoolbox.com/
- **DMARC Analyzer**: https://www.dmarcanalyzer.com/
- **Mail Tester**: https://www.mail-tester.com/
- **DKIM Validator**: https://dkimvalidator.com/

### Командная строка

```bash
# Проверка A записи
dig mail.dev.borisovai.ru A

# Проверка MX записей
dig borisovai.ru MX

# Проверка SPF
dig borisovai.ru TXT | grep spf

# Проверка DKIM
dig dkim._domainkey.borisovai.ru TXT

# Проверка DMARC
dig _dmarc.borisovai.ru TXT

# Проверка PTR (reverse DNS)
dig -x 123.45.67.89
```

### Через Mailu

В админке Mailu (`/admin`) есть раздел с подсказками по DNS записям для каждого домена.

---

## 10. Порядок настройки (чек-лист)

1. [ ] **A-запись** для `mail.yourdomain.com` → IP сервера
2. [ ] **MX-запись** для `@` → `mail.yourdomain.com` с приоритетом 10
3. [ ] **PTR-запись** у хостера: IP → `mail.yourdomain.com`
4. [ ] **SPF-запись**: `v=spf1 mx a:mail.yourdomain.com -all`
5. [ ] Подождать 5-15 минут для распространения DNS
6. [ ] Установить Mailu: `sudo ./install-mailu.sh mail.yourdomain.com admin@yourdomain.com`
7. [ ] **DKIM-запись**: получить ключ из Mailu и добавить в DNS
8. [ ] **DMARC-запись**: `v=DMARC1; p=quarantine; rua=mailto:dmarc@yourdomain.com`
9. [ ] Записи автонастройки (autodiscover, autoconfig)
10. [ ] Проверить всё через MX Toolbox или Mail Tester

---

## 11. Типичные ошибки

### Письма попадают в спам

1. Проверьте PTR запись — это самая частая причина
2. Проверьте SPF, DKIM, DMARC через MX Toolbox
3. Отправьте тестовое письмо на mail-tester.com

### MX запись не работает

- Убедитесь, что значение MX указывает на FQDN с точкой в конце: `mail.dev.borisovai.ru.`
- Проверьте, что A-запись для mail.dev.borisovai.ru существует

### DKIM не проходит проверку

- Убедитесь, что селектор в записи совпадает с селектором Mailu (по умолчанию `dkim`)
- Проверьте, что ключ скопирован полностью
- Некоторые DNS панели требуют экранирования кавычек

### SPF PermError

- В домене может быть только одна SPF запись
- Если есть несколько TXT записей с SPF, объедините их в одну

---

## 12. DNS API (автоматизация)

Если настроен DNS API (Cloudflare/DigitalOcean/локальный), можно управлять записями через CLI:

```bash
# Создание A записи
manage-dns create mail 123.45.67.89

# Проверка
manage-dns test mail
```

Настройка DNS API: `sudo ./setup-dns-api.sh`

---

## Дополнительные ресурсы

- [Документация Mailu](https://mailu.io/master/dns.html)
- [RFC 7208 - SPF](https://tools.ietf.org/html/rfc7208)
- [RFC 6376 - DKIM](https://tools.ietf.org/html/rfc6376)
- [RFC 7489 - DMARC](https://tools.ietf.org/html/rfc7489)
