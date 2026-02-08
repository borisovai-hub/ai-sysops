# Установка всех инструментов на одну машину

Комплексная установка GitLab, Traefik, n8n и веб-интерфейса управления на одной физической машине.

## Что устанавливается

- **Traefik** - reverse proxy с автоматическим SSL
- **GitLab CE** - полнофункциональный Git сервер
- **n8n** - автоматизация workflow
- **Mailu Mail Server** - полнофункциональный почтовый сервер (опционально)
- **Веб-интерфейс управления** - управление сервисами
- **DNS API интеграция** - автоматическое управление поддоменами
- **Let's Encrypt** - автоматические SSL сертификаты

## Системные требования

- **ОС**: Debian 11/12 или Ubuntu 20.04/22.04
- **RAM**: минимум 8GB (рекомендуется 16GB+)
- **CPU**: минимум 4 ядра (рекомендуется 8+)
- **Диск**: минимум 100GB (рекомендуется 200GB+)
- **Сеть**: внешний IP адрес, доступ к портам 80 и 443

## Быстрый старт

### 1. Загрузка скриптов на сервер

**Windows (BAT файл):**
```cmd
upload-single-machine.bat
```

**Windows (PowerShell):**
```powershell
.\scripts\upload-single-machine.ps1
```

**Linux/Mac:**
```bash
chmod +x scripts/upload-single-machine.sh
./scripts/upload-single-machine.sh
```

### 2. Установка на сервере

```bash
# Подключитесь к серверу
ssh root@<SERVER_IP>

# Перейдите в директорию со скриптами
cd ~/install/scripts/single-machine

# Сделайте скрипты исполняемыми
chmod +x *.sh

# Запустите установку (можно запускать из любой директории)
sudo ./install-all.sh

# Или запустите из другой директории (скрипты определят свое расположение автоматически)
cd /tmp
sudo ~/install/scripts/single-machine/install-all.sh
```

Скрипт запросит:
- Домены для всех сервисов (GitLab, n8n, веб-интерфейс)
- Домен для почтового сервера Mailu (опционально)
- Email для Let's Encrypt
- Настройку DNS API (опционально)

### 3. После установки

Сервисы будут доступны по адресам:
- **GitLab**: https://gitlab.example.com
- **n8n**: https://n8n.example.com
- **Mailu Mail Server** (если установлен): https://mail.dev.borisovai.ru (webmail), https://mail.dev.borisovai.ru/admin (админка); почтовый домен — borisovai.ru
- **Веб-интерфейс**: https://manage.example.com
- **Traefik Dashboard**: http://localhost:8080

## Архитектура

```
Одна физическая машина
├── Traefik (порты 80/443)
│   ├── Проксирование GitLab (localhost:80)
│   ├── Проксирование n8n (localhost:5678)
│   ├── Проксирование Mailu (localhost:6555)
│   ├── Проксирование веб-интерфейса (localhost:3000)
│   └── Автоматический SSL (Let's Encrypt)
├── GitLab CE (localhost:80)
├── n8n (localhost:5678)
├── Mailu Mail Server (Docker, порты 25, 587, 465, 143, 993 для SMTP/IMAP, 6555/6554 для HTTP/HTTPS)
└── Веб-интерфейс управления (localhost:3000)
```

## Порядок установки

Скрипт `install-all.sh` автоматически выполняет:

1. Проверку системных требований
2. Обновление системы
3. Установку базовых пакетов
4. Настройку firewall
5. Установку Traefik
6. Настройку DNS API (если выбрано)
7. Установку GitLab
8. Установку n8n
9. Установку Mailu Mail Server (если выбрано; конфиг генерируется из шаблонов Mailu или берётся из /opt/mailu)
10. Установку веб-интерфейса
11. Конфигурацию Traefik для всех сервисов

## Важная информация

### Начальный пароль GitLab

После установки GitLab сохраните начальный пароль root:
```bash
cat /etc/gitlab/initial_root_password
```

### Пароль n8n

По умолчанию:
- **Пользователь**: `admin`
- **Пароль**: `changeme`

**ВАЖНО**: Измените пароль после установки!

Редактируйте `/etc/systemd/system/n8n.service`:
```bash
# Измените строку:
Environment="N8N_BASIC_AUTH_PASSWORD=changeme"

# Затем:
systemctl daemon-reload
systemctl restart n8n
```

### Mailu Mail Server

**Официальный мастер** [setup.mailu.io](https://setup.mailu.io) встроен в установку: при отсутствии `docker-compose.yml` и `mailu.env` в `/opt/mailu` скрипт сам генерирует их из тех же шаблонов (Jinja2, `setup/flavors/compose`). Шаблоны скачиваются с GitHub ([Mailu/Mailu](https://github.com/Mailu/Mailu) → `setup/flavors/compose/`). Рендер выполняет `mailu-setup-render.py` (он загружается на сервер вместе с остальными скриптами при `upload-single-machine`). Требуются `python3` и `python3-jinja2`; при необходимости они ставятся автоматически.

**Установка:** задайте хост веб-интерфейса при установке (по умолчанию `mail.dev.borisovai.ru`); почтовый домен для адресов — `borisovai.ru`. Затем `install-mailu.sh` (или шаг Mailu в `install-all.sh`) создаст конфиг, настроит порты 6555/6554 для Traefik, systemd, UFW, DNS.

**Ручная настройка (по желанию):** откройте https://setup.mailu.io, выберите Roundcube, «за reverse proxy», порты 6555/6554, скачайте `docker-compose.yml` и `mailu.env`, положите в `/opt/mailu` — скрипт будет использовать их вместо автогенерации.

**Пароли и вход в админку:**
- При **автогенерации** конфига в `mailu.env` прописываются `INITIAL_ADMIN_ACCOUNT`, `INITIAL_ADMIN_DOMAIN`, `INITIAL_ADMIN_PASSWORD`. Пароль генерируется случайно и выводится при установке (или: `grep INITIAL_ADMIN_PASSWORD /opt/mailu/mailu.env`).
- **Вход:** https://mail.dev.borisovai.ru/admin — логин `admin@borisovai.ru` (или ваш домен), пароль из `INITIAL_ADMIN_PASSWORD`. Формы «создать админа» при первом входе **нет**; админ создаётся автоматически при первом старте Mailu.
- Если конфиг взят с setup.mailu.io без `INITIAL_ADMIN_*`, создайте админа вручную:  
  `docker compose -f /opt/mailu/docker-compose.yml --env-file /opt/mailu/mailu.env exec admin flask mailu user admin borisovai.ru 'ваш_пароль'`, затем через config-update задайте `global_admin: true` ([документация](https://mailu.io/master/cli.html)).
- **Почтовые ящики:** пароль задаётся при создании (Mailboxes > Add mailbox).

**После установки:**
1. Войдите в админку: https://mail.dev.borisovai.ru/admin (`admin@borisovai.ru` + пароль из `mailu.env`).
2. Создайте домен: Mail domains > Add domain (например, borisovai.ru).
3. Создайте почтовые ящики: Mailboxes > Add mailbox.
4. Добавьте DNS записи (MX, SPF, DKIM, DMARC) — подсказки в админке.

**Почтовые порты:** SMTP 25, 587, 465; IMAP 143, 993. Порт 25 должен быть доступен для исходящих соединений.

### SSL сертификаты

SSL сертификаты будут получены автоматически через Let's Encrypt в течение нескольких минут после установки.

Убедитесь, что:
- DNS записи для всех доменов настроены
- Порты 80 и 443 доступны извне
- Домены указывают на IP адрес сервера

## Управление сервисами

### Проверка статуса

```bash
systemctl status traefik
systemctl status gitlab-runsvdir
systemctl status n8n
systemctl status mailu
systemctl status management-ui
```

### Просмотр логов

```bash
# Traefik
journalctl -u traefik -f

# GitLab
gitlab-ctl tail

# n8n
journalctl -u n8n -f

# Mailu
docker compose -f /opt/mailu/docker-compose.yml --env-file /opt/mailu/mailu.env logs -f

# Веб-интерфейс
journalctl -u management-ui -f
```

### Перезапуск сервисов

```bash
systemctl restart traefik
gitlab-ctl restart
systemctl restart n8n
systemctl restart mailu
systemctl restart management-ui
```

## Добавление новых сервисов

### Через веб-интерфейс

1. Откройте https://manage.example.com
2. Нажмите "Добавить сервис"
3. Заполните форму и нажмите "Создать"

### Через API

```bash
curl -b cookies.txt -X POST http://127.0.0.1:3000/api/services \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app", "domain": "my-app.example.com", "backendHost": "127.0.0.1", "backendPort": 4010}'
```

Подробнее: [docs/agents/AGENT_SERVICES.md](docs/agents/AGENT_SERVICES.md)

## Решение проблем

### GitLab недоступен

```bash
# Проверьте статус
gitlab-ctl status

# Проверьте доступность на localhost
curl http://127.0.0.1

# Проверьте конфигурацию Traefik
cat /etc/traefik/dynamic/gitlab.yml
```

### n8n недоступен

```bash
# Проверьте статус
systemctl status n8n

# Проверьте доступность на localhost
curl http://127.0.0.1:5678

# Проверьте логи
journalctl -u n8n -n 50
```

### SSL сертификат не получается

```bash
# Проверьте логи Traefik
journalctl -u traefik | grep -i acme

# Проверьте права на файл
ls -la /var/lib/traefik/acme/acme.json

# Проверьте доступность домена
curl -I http://your-domain.com
```

### Mailu недоступен

```bash
# Проверьте статус
systemctl status mailu

# Проверьте Docker контейнеры
docker ps

# Проверьте логи
docker compose -f /opt/mailu/docker-compose.yml --env-file /opt/mailu/mailu.env logs

# Проверьте доступность на localhost
curl http://127.0.0.1:6555

# Проверьте конфигурацию Traefik
cat /etc/traefik/dynamic/mailu.yml
```

### Mailu: «Network mailu_default is still in use» при down

Если `docker compose down` выдаёт это — сеть занята контейнерами. Сделайте:

```bash
systemctl stop mailu
cd /opt/mailu && docker compose -f docker-compose.yml --env-file mailu.env stop
sleep 2
docker compose -f docker-compose.yml --env-file mailu.env down -v --remove-orphans
```

Если сеть всё ещё не удаляется:

```bash
docker network inspect mailu_default   # посмотреть, что подключено
docker rm -f $(docker ps -aq --filter network=mailu_default)
docker network rm mailu_default
```

## Безопасность

- Все сервисы работают на localhost
- Внешний доступ только через Traefik (кроме SMTP/IMAP портов Mailu)
- SSL для всех доменов
- Firewall настроен (открыты 22, 80, 443, и почтовые порты 25, 587, 465, 143, 993 если установлен Mailu)
- Измените пароли по умолчанию!

## Обновление

### Обновление GitLab

```bash
apt update
apt upgrade gitlab-ce
gitlab-ctl reconfigure
```

### Обновление n8n

```bash
npm update -g n8n
systemctl restart n8n
```

### Обновление Traefik

Скачайте новую версию и замените бинарный файл:
```bash
cd /opt/traefik
# Скачайте новую версию
# Замените бинарный файл
systemctl restart traefik
```

### Обновление Mailu

```bash
cd /opt/mailu
docker compose -f docker-compose.yml --env-file mailu.env pull
docker compose -f docker-compose.yml --env-file mailu.env up -d
systemctl restart mailu
```

## Полезные ссылки

- [docs/setup/REMOTE_WORK.md](docs/setup/REMOTE_WORK.md) — работа с сервером через Remote-SSH и работа агентов на удалённой машине
- [config/single-machine/ssh-config.example](config/single-machine/ssh-config.example) — пример SSH конфига
- [GitLab Documentation](https://docs.gitlab.com/)
- [n8n Documentation](https://docs.n8n.io/)
- [Traefik Documentation](https://doc.traefik.io/traefik/)
- [Mailu Documentation](https://mailu.io/)
