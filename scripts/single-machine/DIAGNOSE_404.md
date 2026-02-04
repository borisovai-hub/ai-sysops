# Диагностика 404 при доступе к сервисам за Traefik

Когда сервис возвращает 404, проверьте по шагам: работает ли Traefik, совпадает ли правило с доменом, отвечает ли бэкенд.

---

## 1. Какой URL даёт 404

Запомните точный адрес, например:
- `https://gitlab.dev.borisovai.tech/`
- `https://dns.borisovai.tech/`
- `https://borisovai.ru/`

---

## 2. Traefik запущен и загружает конфиги

```bash
# Статус сервиса
sudo systemctl status traefik

# Ошибки при загрузке конфигов
sudo journalctl -u traefik -n 50 --no-pager | grep -i error
```

Если Traefik не запущен или в логах ошибки разбора YAML — сначала устраните их.

---

## 3. Какой конфиг отвечает за этот домен

По домену найдите файл и правило:

```bash
DOMAIN="gitlab.dev.borisovai.tech"   # подставьте ваш URL без https://

# В каких файлах упоминается домен
grep -l "$DOMAIN" /etc/traefik/dynamic/*.yml 2>/dev/null

# Если не нашлось — искать по части домена (например gitlab, dns, borisovai)
grep -l "gitlab\|dns\|borisovai" /etc/traefik/dynamic/*.yml 2>/dev/null | grep -v backup
```

Для типичной схемы:
- **gitlab.dev.* →** `gitlab.yml`
- **dns.*, ui.* →** `management-ui.yml` или `dns-*.yml`
- **borisovai.ru, api.borisovai.ru →** `site.yml` или `borisovai-*.yml`

---

## 4. Правило в конфиге совпадает с вашим доменом

```bash
# Показать правило (rule) в конфиге
grep "rule:" /etc/traefik/dynamic/gitlab.yml
# или для другого файла:
grep "rule:" /etc/traefik/dynamic/management-ui.yml
```

Проверьте:
- В правиле должен быть **ваш домен** (тот же, что в браузере).
- Опечатка: `borisovai,ru` вместо `borisovai.ru` — правило не сработает.
- Для доменов с **dev** (например `gitlab.dev.borisovai.tech`) в конфиге установлен `gitlab_middle`: `"dev"` (см. п. 7).

---

## 5. Бэкенд (сервис за Traefik) отвечает

В том же конфиге посмотрите `url` в `services`:

```bash
grep -A5 "services:" /etc/traefik/dynamic/gitlab.yml
# или
grep "url:" /etc/traefik/dynamic/gitlab.yml
```

Проверьте этот адрес напрямую (без Traefik):

```bash
# Пример: бэкенд http://127.0.0.1:8888
curl -sI http://127.0.0.1:8888/
```

- Если тут 200 — проблема в правиле Traefik или в домене (п. 4, 7).
- Если тут 502/connection refused — проблема в самом сервисе (запуск, порт).

---

## 6. Конфиг установки (base_domains и middle)

Правила строятся из `/etc/install-config.json`:

```bash
cat /etc/install-config.json | grep -E "base_domains|gitlab_middle|gitlab_prefix|ui_prefix|site_port"
```

Важно:
- **base_domains** — список базовых доменов через запятую, например `"borisovai.ru,borisovai.tech"`.
- Для **gitlab.dev.borisovai.tech** должен быть **gitlab_middle**: `"dev"`.
- Опечатки в доменах (запятая вместо точки) дают 404.

Если для n8n или management-ui (ui/dns) **нет DNS на всех base_domains**, задайте явные списки хостов — тогда Traefik будет запрашивать сертификаты только для них:
- **n8n_hosts** — полные имена через запятую, например `"n8n.borisovai.ru"`.
- **management_ui_hosts** — полные имена через запятую, например `"ui.borisovai.ru,dns.borisovai.ru,dns.borisovai.tech"` (без ui.borisovai.tech, если для него нет DNS).

После добавления ключей: `sudo ./configure-traefik.sh --force` и `sudo systemctl restart traefik`.

---

## 7. Пересборка конфигов Traefik

После правки конфига или `install-config.json` нужно пересобрать конфиги и перезапустить Traefik:

```bash
cd /root/install/scripts/single-machine   # или ваш путь к скриптам

# Пересоздать все конфиги из install-config.json
sudo ./configure-traefik.sh --force

# Перезапустить Traefik (reload может быть недоступен)
sudo systemctl restart traefik

# Проверить
curl -sI https://ВАШ_ДОМЕН/
```

---

## 8. Краткий чеклист

| Проверка | Команда |
|----------|---------|
| Traefik запущен | `systemctl status traefik` |
| Нет ошибок в логах | `journalctl -u traefik -n 50 \| grep -i error` |
| Домен есть в правиле | `grep "rule:" /etc/traefik/dynamic/НУЖНЫЙ.yml` |
| Бэкенд отвечает | `curl -sI http://127.0.0.1:ПОРТ/` |
| В конфиге есть middle для dev | `grep gitlab_middle /etc/install-config.json` |
| Конфиги пересобраны | `./configure-traefik.sh --force` и `systemctl restart traefik` |

---

## 9. Частые причины 404

1. **Домен с `dev` (gitlab.dev.*), а в конфиге нет middle**  
   Добавить в `install-config.json`: `"gitlab_middle": "dev"`, затем `configure-traefik.sh --force` и `systemctl restart traefik`.

2. **Опечатка в домене**  
   В правилах или в `base_domains`: `borisovai,ru` → должно быть `borisovai.ru`.

3. **В конфиге нет секции `services`**  
   В YAML должен быть блок `services` с `url` для бэкенда. Без него Traefik не знает, куда слать запрос.

4. **Бэкенд не слушает порт**  
   Проверить: `ss -tlnp | grep ПОРТ` или `curl -sI http://127.0.0.1:ПОРТ/`.

5. **Используется не тот конфиг**  
   Несколько файлов в `/etc/traefik/dynamic/` могут задавать роуты для одного домена; смотрите, в каком файле правило с вашим доменом и откуда берётся `url` (п. 3–4).
