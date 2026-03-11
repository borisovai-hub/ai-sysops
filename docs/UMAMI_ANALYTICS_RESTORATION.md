за # Восстановление поддержки Umami Analytics

## Обзор

Umami Analytics полностью восстановлена в системе. Поддержка включает:

- **Management UI**: Страница аналитики с интеграцией
- **Backend API**: Endpoints для статуса и SSO bridge
- **Установка**: Скрипт автоматической установки через Docker Compose
- **CI/CD**: Job для деплоя и обновлений
- **Интеграция**: SSO через Authelia, обход AdBlock через кастомный скрипт

## Что было сделано

### 1. Management UI Frontend

**Файл**: `management-ui/public/analytics.html`

Полнофункциональная страница аналитики с:
- Отображением статуса Umami (установлен/запущен/не установлен)
- Инструкциями по интеграции с Next.js
- Примерами кастомных событий
- Ссылками на Umami dashboard

**Навигация**: Добавлена ссылка "Аналитика" во все страницы Management UI:
- index.html
- dns.html
- projects.html
- tunnels.html
- files.html
- ru-proxy.html
- users.html
- content.html
- tokens.html

### 2. Backend API

**Файл**: `management-ui/server.js`

Добавлены endpoints:

```javascript
// GET /api/analytics/status - проверка статуса Umami
app.get('/api/analytics/status', requireAuth, async (req, res) => {
  // Проверка Docker контейнера
  // Health check на http://127.0.0.1:3001/api/heartbeat
  // Получение доменов (analytics.dev.borisovai.ru, analytics.dev.borisovai.tech)
});

// GET /sso-bridge - автологин через Authelia
app.get('/sso-bridge', async (req, res) => {
  // Проверка Remote-User header от Authelia
  // Логин в Umami под admin аккаунтом
  // Сохранение токена в localStorage
  // Редирект на Umami dashboard
});
```

### 3. Установка

**Файл**: `scripts/single-machine/install-umami.sh`

Скрипт автоматической установки:
- Проверка Docker и Docker Compose
- Создание директорий `/etc/umami`
- Генерация `.env` файла с переменными окружения
- Копирование `docker-compose.yml`
- Запуск контейнера Umami
- Создание DNS записей `analytics.dev.<base_domain>`
- Создание Traefik dynamic конфигурации с SSO bridge

**Использование**:
```bash
sudo ./scripts/single-machine/install-umami.sh [--force]
```

### 4. Docker Compose

**Файл**: `config/single-machine/umami-docker-compose.yml`

Конфигурация с SQLite базой данных:
- Образ: `ghcr.io/maxime-j/umami-sqlite:latest`
- Порт: `127.0.0.1:3001:3000` (только localhost)
- Volume: `umami-data` для SQLite БД
- Healthcheck на `/api/heartbeat`

### 5. CI/CD

**Файл**: `scripts/ci/deploy-umami.sh`

Job для инкрементального деплоя:
- Проверка установки (пропуск если не установлен)
- Обновление `docker-compose.yml` если изменился
- Проверка и создание `analytics.yml` в Traefik
- Обновление Docker-образов и рестарт
- Health check

### 6. Массовое обновление навигации

**Файл**: `scripts/add-analytics-nav.js`

Node.js скрипт для добавления ссылки "Аналитика" во все HTML файлы:
- Автоматическое определение места вставки (после "Проекты")
- Пропуск если ссылка уже существует
- Обработка всех HTML файлов в `management-ui/public/`

**Использование**:
```bash
node scripts/add-analytics-nav.js
```

## Архитектура

### SSO Integration (Single Sign-On)

Umami интегрирован с Authelia через middleware `/sso-bridge`:

1. Пользователь переходит на `https://analytics.dev.borisovai.ru`
2. Traefik проверяет авторизацию через Authelia ForwardAuth
3. Если не авторизован → редирект на Authelia login
4. После успешной авторизации → редирект на `/login`
5. Traefik middleware перенаправляет `/login` → `/sso-bridge`
6. Management UI логинится в Umami под admin (настройка в config.json)
7. Токен сохраняется в `localStorage["umami.auth"]`
8. Редирект на Umami dashboard

### Traefik Configuration

**Файл**: `/etc/traefik/dynamic/analytics.yml`

Создается автоматически скриптом установки:

```yaml
http:
  routers:
    analytics-tracking-ru:
      rule: "Host(`analytics.dev.borisovai.ru`) && (Path(`/api/send`) || Path(`/stats.js`))"
      service: analytics
      # No Authelia - public for tracking
    
    analytics-sso-ru:
      rule: "Host(`analytics.dev.borisovai.ru`) && Path(`/sso-bridge`)"
      service: analytics-sso
      middlewares:
        - authelia@file
    
    analytics-login-ru:
      rule: "Host(`analytics.dev.borisovai.ru`) && Path(`/login`)"
      middlewares:
        - authelia@file
        - analytics-login-redirect-ru  # Redirect to /sso-bridge
    
    analytics-ru:
      rule: "Host(`analytics.dev.borisovai.ru`)"
      middlewares:
        - authelia@file
```

### Обход AdBlock

Umami использует кастомное имя трекер-скрипта для обхода AdBlock:

- По умолчанию: `stats.js` (вместо стандартного `analytics.js`)
- Настраивается через переменную `TRACKER_SCRIPT_NAME` в `.env`
- Скрипт доступен по адресу: `https://analytics.dev.borisovai.ru/stats.js`

### Интеграция с Next.js

Добавьте в ваш Next.js проект:

```jsx
<Script
  src="https://analytics.dev.borisovai.ru/stats.js"
  data-website-id="ВАШ_WEBSITE_ID"
  strategy="afterInteractive"
/>
```

Где `ВАШ_WEBSITE_ID` можно получить из Umami dashboard:
1. Откройте `https://analytics.dev.borisovai.ru`
2. Выберите или создайте сайт
3. Найдите секцию "Tracking code"
4. Скопируйте значение `data-website-id`

## Кастомные события

Umami поддерживает отслеживание пользовательских действий:

### Клик по кнопке
```html
<button onclick="umami.track('signup_click')">
  Зарегистрироваться
</button>
```

### Событие с параметрами
```javascript
umami.track('purchase', {
  product: 'Premium Plan',
  price: 99,
  currency: 'USD'
});
```

### Просмотр страницы
```javascript
umami.track('page_view', {
  path: '/pricing',
  title: 'Тарифы'
});
```

## Установка и запуск

### Первичная установка

```bash
# Установка
sudo ./scripts/single-machine/install-umami.sh

# Проверка статуса
docker ps | grep umami
curl http://127.0.0.1:3001/api/heartbeat

# Логи
docker logs -f umami
```

### CI/CD деплой

```bash
# GitLab CI job deploy:umami автоматически:
# - Обновит docker-compose.yml если изменился
# - Создаст analytics.yml если отсутствует
# - Обновит Docker-образы
# - Перезапустит контейнер если нужно
```

### Управление

```bash
# Старт/стоп/рестарт
cd /etc/umami
docker compose up|down|restart

# Просмотр логов
docker logs -f umami

# Вход в контейнер
docker exec -it umami sh
```

## Бэкап и восстановление

### Бэкап SQLite БД

```bash
# Создать бэкап внутри контейнера
docker exec umami sqlite3 /app/data/umami.db ".backup /app/data/umami-backup.db"

# Скопировать на хост
docker cp umami:/app/data/umami-backup.db /root/backups/umami-$(date +%Y%m%d).db
```

### Восстановление БД

```bash
# Скопировать бэкап в контейнер
docker cp /root/backups/umami-backup.db umami:/app/data/umami.db

# Рестарт контейнера
docker restart umami
```

## Конфигурация

### Переменные окружения (.env)

```bash
# Файл: /etc/umami/.env

# База данных SQLite
DATABASE_URL=file:/app/data/umami.db

# Имя трекер-скрипта (обход AdBlock)
TRACKER_SCRIPT_NAME=stats
```

### Config.json

```json
{
  "umami_admin_password": "ваш_пароль_admin_umami",
  "analytics_prefix": "analytics",
  "analytics_middle": "dev",
  "umami_port": 3001,
  "umami_tracker_script": "stats"
}
```

## Troubleshooting

**⚠️ ВАЖНО**: Если после входа появляется ошибка про недоступность шлюза SSO - см. [UMAMI_SSO_TROUBLESHOOTING.md](UMAMI_SSO_TROUBLESHOOTING.md)

### Umami не отвечает

```bash
# Проверка контейнера
docker ps | grep umami

# Логи
docker logs -f umami

# Health check
curl http://127.0.0.1:3001/api/heartbeat
```

### SSO не работает

```bash
# Проверка Authelia ForwardAuth
curl -H "Remote-User: testuser" http://127.0.0.1:3000/sso-bridge

# Проверка Traefik конфигурации
cat /etc/traefik/dynamic/analytics.yml

# Рестарт Traefik
systemctl reload traefik
```

### DNS записи

```bash
# Проверка DNS API
curl http://127.0.0.1:5353/api/records | grep analytics

# Создание вручную
curl -X POST http://127.0.0.1:5353/api/records \
  -H "Content-Type: application/json" \
  -d '{"domain":"analytics.dev.borisovai.ru","type":"A","value":"IP_СЕРВЕРА"}'
```

### AdBlock блокирует скрипт

1. Проверьте имя скрипта в `.env`:
   ```bash
   cat /etc/umami/.env | grep TRACKER_SCRIPT_NAME
   ```

2. Измените на уникальное имя:
   ```bash
   echo "TRACKER_SCRIPT_NAME=my-tracker" >> /etc/umami/.env
   cd /etc/umami && docker compose restart
   ```

3. Обновите интеграцию в Next.js:
   ```jsx
   <Script
     src="https://analytics.dev.borisovai.ru/my-tracker.js"
     data-website-id="ВАШ_WEBSITE_ID"
   />
   ```

## Безопасность

### Рекомендации

1. **Используйте сложный пароль для admin пользователя** в Umami
2. **Ограничьте доступ** к Umami через Authelia groups
3. **Регулярно создавайте бэкапы** SQLite БД
4. **Следите за обновлениями** Docker образа Umami
5. **Проверяйте логи** на подозрительную активность

### Порты

- Umami: `127.0.0.1:3001` (только localhost)
- Traefik проксирует: `443` (HTTPS)

### Права доступа

```bash
# Права на директорию
chmod 700 /etc/umami

# Права на .env
chmod 600 /etc/umami/.env

# Права на docker-compose.yml
chmod 644 /etc/umami/docker-compose.yml
```

## Мониторинг

### Management UI

Откройте `https://admin.borisovai.ru/analytics.html` для:
- Проверки статуса Umami
- Получения инструкций по интеграции
- Просмотра примеров кастомных событий

### Health Checks

```bash
# Umami API
curl http://127.0.0.1:3001/api/heartbeat

# Management UI Analytics API
curl -H "Authorization: Bearer YOUR_TOKEN" \
  http://127.0.0.1:3000/api/analytics/status
```

## Обновление

### Автоматическое обновление через CI/CD

GitLab CI job `deploy:umami` автоматически:
- Проверяет изменения в `docker-compose.yml`
- Обновляет Docker-образы
- Перезапускает контейнер если нужно

### Ручное обновление

```bash
cd /etc/umami

# Обновление образов
docker compose pull

# Рестарт с новой конфигурацией
docker compose up -d

# Проверка
docker logs -f umami
```

## Резюме

Umami Analytics полностью восстановлена и интегрирована в систему:

✅ **Frontend**: Страница аналитики в Management UI  
✅ **Backend**: API endpoints для статуса и SSO  
✅ **Установка**: Автоматический скрипт установки  
✅ **Docker**: Compose конфигурация с SQLite  
✅ **CI/CD**: Job для деплоя и обновлений  
✅ **SSO**: Интеграция с Authelia  
✅ **AdBlock**: Обход через кастомный скрипт  
✅ **Навигация**: Ссылки на всех страницах Management UI  

Для установки выполните:
```bash
sudo ./scripts/single-machine/install-umami.sh
```

Для деплоя через CI/CD:
```bash
# GitLab CI job deploy:umami запускается автоматически
```

---

**Дата восстановления**: 2026-03-08  
**Статус**: ✅ Полностью функциональна