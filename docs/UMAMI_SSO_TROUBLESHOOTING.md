# Troubleshooting: Umami SSO Gateway Error

## Проблема

После входа в Umami Analytics появляется ошибка про недоступность шлюза SSO или токен не получен.

## Диагностика

### 1. Проверьте что Umami запущен

```bash
# Проверка контейнера
docker ps | grep umami

# Проверка статуса
docker logs -f umami

# Health check
curl http://127.0.0.1:3001/api/heartbeat
```

Ожидаемый ответ: `{"status":"ok"}`

### 2. Проверьте логи SSO bridge

```bash
# Логи management-ui
journalctl -u management-ui -f

# Или если запущено через pm2
pm2 logs management-ui
```

Ищите сообщения:
```
[SSO Bridge] Попытка авторизации в Umami...
[SSO Bridge] Порт: 3001
[SSO Bridge] Пользователь: admin
[SSO Bridge] Ответ Umami: 200
[SSO Bridge] Данные ответа: {"token":"..."}
```

или ошибки:
```
[SSO Bridge] Ошибка: connect ECONNREFUSED 127.0.0.1:3001
[SSO Bridge] Токен не получен, данные: {...}
```

### 3. Проверьте конфигурацию config.json

```bash
cat /etc/management-ui/config.json | grep umami
```

Должно быть:
```json
{
  "umami_admin_password": "ваш_пароль_от_umami"
}
```

Если этого параметра нет - используется пароль по умолчанию `umami`.

### 4. Проверьте создан ли admin пользователь в Umami

Откройте Umami в браузере:
```
https://analytics.dev.borisovai.ru
```

Если вас просят создать пользователя - это первая установка. Создайте admin пользователя с любым паролем.

## Решения

### Решение 1: Обновите пароль в config.json

1. Откройте Umami и войдите как admin с вашим паролем
2. Обновите конфиг management-ui:

```bash
sudo nano /etc/management-ui/config.json
```

Добавьте или измените:
```json
{
  "umami_admin_password": "ваш_реальный_пароль"
}
```

3. Перезапустите management-ui:

```bash
sudo systemctl restart management-ui
```

### Решение 2: Перезапустите Umami контейнер

```bash
cd /etc/umami
docker compose down
docker compose up -d

# Проверка логов
docker logs -f umami
```

### Решение 3: Проверьте Traefik конфигурацию

```bash
# Проверка что analytics.yml существует
ls -la /etc/traefik/dynamic/analytics.yml

# Проверка конфигурации
cat /etc/traefik/dynamic/analytics.yml

# Перезагрузка Traefik
sudo systemctl reload traefik
```

### Решение 4: Ручной тест SSO bridge

```bash
# Тест без Authelia (заголовок Remote-User)
curl -H "Remote-User: testuser" http://127.0.0.1:3000/sso-bridge
```

Должен вернуться HTML с JavaScript или сообщение об ошибке с деталями.

### Решение 5: Проверьте порт Umami

```bash
# Проверка какой порт слушает Umami
docker port umami

# Должно быть:
# 3000/tcp -> 127.0.0.1:3001
```

Если порт другой - обновите в install-config.json:

```bash
sudo nano /etc/install-config.json
```

Измените:
```json
{
  "umami_port": 3001
}
```

Перезапустите management-ui:
```bash
sudo systemctl restart management-ui
```

## Распространенные ошибки

### Ошибка: connect ECONNREFUSED 127.0.0.1:3001

**Причина**: Umami контейнер не запущен или слушает другой порт

**Решение**:
```bash
docker ps | grep umami
cd /etc/umami && docker compose up -d
```

### Ошибка: Umami SSO: токен не получен

**Причина**: Admin пользователь не создан или неверный пароль

**Решение**:
1. Откройте `https://analytics.dev.borisovai.ru`
2. Создайте admin пользователя
3. Обновите пароль в `/etc/management-ui/config.json`
4. Перезапустите management-ui

### Ошибка: 403 Forbidden при доступе к /sso-bridge

**Причина**: Запрос не прошел через Authelia ForwardAuth

**Решение**: Проверьте Traefik конфигурацию `/etc/traefik/dynamic/analytics.yml`

### Ошибка: 401 Unauthorized от Umami API

**Причина**: Неверный пароль admin пользователя

**Решение**: Обновите `umami_admin_password` в config.json

## Полная переустановка

Если ничего не помогает - выполните переустановку:

```bash
# 1. Остановите и удалите Umami
cd /etc/umami
docker compose down
docker volume rm umami-data

# 2. Удалите конфиги
sudo rm /etc/traefik/dynamic/analytics.yml

# 3. Переустановите
sudo ./scripts/single-machine/install-umami.sh --force
```

После переустановки:
1. Откройте `https://analytics.dev.borisovai.ru`
2. Создайте admin пользователя
3. Обновите пароль в `/etc/management-ui/config.json`
4. Перезапустите management-ui

## Логирование

Для детального диагностирования включите расширенное логирование:

```bash
# Логи management-ui (включая SSO bridge)
journalctl -u management-ui -n 100 --no-pager

# Логи Umami
docker logs umami --tail 100

# Логи Traefik
journalctl -u traefik -n 100 --no-pager
```

## Проверка после исправления

1. Проверьте статус Umami:
```bash
curl http://127.0.0.1:3001/api/heartbeat
```

2. Откройте analytics в браузере:
```
https://analytics.dev.borisovai.ru
```

3. После входа через Authelia вы должны автоматически войти в Umami

## Контакты

Если проблема не решена - проверьте логи и предоставьте их для диагностики:

```bash
# Сбор логов
echo "=== Umami контейнер ==="
docker ps | grep umami
docker logs umami --tail 50

echo "=== Management UI ==="
journalctl -u management-ui -n 50 --no-pager

echo "=== Traefik analytics.yml ==="
cat /etc/traefik/dynamic/analytics.yml

echo "=== Config.json ==="
cat /etc/management-ui/config.json | grep -A2 -B2 umami