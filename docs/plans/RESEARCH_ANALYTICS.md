# Исследование: Self-hosted веб-аналитика

## Задача

Выбрать и развернуть на своём сервере систему отслеживания посещаемости сайта:
- Self-hosted на Debian/Ubuntu
- Минимальная нагрузка на сервер (уже работают GitLab, Strapi, Next.js, Traefik, frps)
- HTTPS через существующий Traefik (Let's Encrypt)
- GDPR-compliant (желательно без cookies и consent banner)
- Простая интеграция с Next.js 16

## Текущая инфраструктура

- Traefik на 80/443, TLS termination, file provider (`/etc/traefik/dynamic/`)
- Два base_domain: `borisovai.ru`, `borisovai.tech`
- Сайт: Next.js 16 (frontend) + Strapi v5 (API)
- DNS API на порту 5353

---

## Сводная таблица (4 инструмента)

| Критерий | **Umami** | **Plausible CE** | **Matomo** | **PostHog** |
|----------|-----------|------------------|------------|-------------|
| Язык | Node.js | Elixir + Go | PHP | Python + JS |
| БД | PostgreSQL | PostgreSQL + ClickHouse | MySQL/MariaDB | PostgreSQL + ClickHouse |
| RAM | **64-128 MB** | 2+ GB (ClickHouse) | 0.5-1.5 GB | 16+ GB |
| Размер скрипта | ~2 KB | ~1 KB | ~23 KB | ~100 KB |
| Cookie | Нет | Нет | Да (по умолч.) | Да |
| GDPR без баннера | Да | Да | Нет | Нет |
| Лицензия | MIT | AGPL-3.0 | GPL-3.0 | MIT (ограничения) |
| Docker-деплой | Простой (2 контейнера) | Средний (3 контейнера) | Средний (2-3 контейнера) | Сложный (10+ контейнеров) |
| Дашборд | Минималистичный | Минималистичный | Полнофункциональный | Продуктовый |
| API | REST API | REST API | REST + PHP API | REST API |
| Кастомные события | Да | Да | Да | Да |
| UTM-метки | Да | Да | Да | Да |
| Воронки/цели | Базово | Да | Да (полные) | Да (полные) |
| Realtime | Да | Да | Да | Да |
| Next.js интеграция | `<script>` тег или npm | `<script>` тег | `<script>` тег | SDK |
| Подходит? | **ДА** | **ДА** | Условно | Нет |

---

## Детальный обзор

### 1. Umami (umami-software/umami)

- **GitHub**: https://github.com/umami-software/umami
- **Stars**: ~25k | Активная разработка
- **Язык**: Node.js (Next.js)
- **БД**: PostgreSQL (или MySQL)
- **RAM**: 64-128 MB
- **Docker**: 2 контейнера (app + PostgreSQL)
- **Скрипт**: ~2 KB, async, не блокирует загрузку
- **Cookie**: Нет — использует fingerprinting (IP + User-Agent hash)
- **GDPR**: Compliant без consent banner
- **Лицензия**: MIT — полностью бесплатный, без ограничений
- **Traefik**: Отлично работает за reverse proxy, множество документированных гайдов
- **Плюсы**:
  - Минимальные ресурсы — идеально для нагруженного сервера
  - Можно использовать существующий PostgreSQL от Strapi
  - `TRACKER_SCRIPT_NAME` — кастомное имя скрипта для обхода AdBlock
  - REST API для программного доступа к данным
  - Простой, красивый дашборд
  - Мультисайт из коробки
- **Минусы**:
  - Нет полноценных воронок и целей (базовые события есть)
  - Нет heatmaps, session recording

### 2. Plausible CE (plausible/community-edition)

- **GitHub**: https://github.com/plausible/community-edition
- **Stars**: ~22k | Активная разработка
- **Язык**: Elixir (Phoenix) + Go
- **БД**: PostgreSQL + ClickHouse
- **RAM**: 2+ GB (ClickHouse требует памяти)
- **Docker**: 3 контейнера (app + PostgreSQL + ClickHouse)
- **Скрипт**: ~1 KB — самый лёгкий
- **Cookie**: Нет
- **GDPR**: Compliant без consent banner
- **Лицензия**: AGPL-3.0
- **Traefik**: Работает за reverse proxy
- **Плюсы**:
  - Больше аналитических функций (воронки, цели, custom properties)
  - ClickHouse — быстрее на больших объёмах данных
  - Самый маленький скрипт (~1 KB)
  - Хорошая документация
- **Минусы**:
  - **2+ GB RAM** — значительная нагрузка на сервер
  - 3 контейнера вместо 2
  - AGPL — более строгая лицензия
  - Сложнее в администрировании (ClickHouse)

### 3. Matomo (matomo-org/matomo)

- **GitHub**: https://github.com/matomo-org/matomo
- **Stars**: ~20k | Активная разработка
- **Язык**: PHP
- **БД**: MySQL/MariaDB
- **RAM**: 0.5-1.5 GB
- **Docker**: 2-3 контейнера (app + MySQL + опционально Redis)
- **Скрипт**: ~23 KB — тяжёлый
- **Cookie**: Да (по умолчанию, можно отключить)
- **GDPR**: Требует consent banner (с cookies)
- **Лицензия**: GPL-3.0
- **Traefik**: Работает за reverse proxy
- **Плюсы**:
  - Полный аналог Google Analytics (heatmaps, session recording, A/B тесты)
  - Самый зрелый проект
  - Огромная экосистема плагинов
- **Минусы**:
  - PHP-стек (ещё одна зависимость)
  - Тяжёлый скрипт (23 KB)
  - Cookies по умолчанию → нужен consent banner
  - Overkill для простого отслеживания посещаемости

### 4. PostHog (PostHog/posthog)

- **GitHub**: https://github.com/PostHog/posthog
- **Stars**: ~24k | Очень активная разработка
- **Язык**: Python (Django) + TypeScript (React)
- **БД**: PostgreSQL + ClickHouse + Redis + Kafka
- **RAM**: **16+ GB** — минимум
- **Docker**: 10+ контейнеров
- **Скрипт**: ~100 KB
- **Cookie**: Да
- **GDPR**: Требует настройки
- **Лицензия**: MIT (с ограничениями на некоторые фичи)
- **Плюсы**:
  - Продуктовая аналитика + веб-аналитика + feature flags + A/B тесты
  - Session recording, heatmaps
  - Мощный event tracking
- **Минусы**:
  - **16+ GB RAM** — неприемлемо для нашего сервера
  - 10+ контейнеров — сложный деплой и поддержка
  - Overkill — это платформа продуктовой аналитики, а не веб-аналитика

---

## Почему не подходят

| Инструмент | Причина |
|---|---|
| PostHog | 16+ GB RAM, 10+ контейнеров — overkill для веб-аналитики |
| Matomo | PHP-стек, cookies по умолчанию, тяжёлый скрипт (23 KB) |
| GoAccess | Анализирует логи, нет real-time tracking скрипта |
| Shynet | Слабо развивается, минимальный функционал |
| Ackee | Слабо развивается, GraphQL-only API |

---

## Интеграция с инфраструктурой

### Схема: Traefik → Umami → PostgreSQL

```
Internet
   |
   v
Traefik (:443, TLS termination)
   |
   |-- analytics.borisovai.ru  --> Umami (:3000)
   |-- admin.borisovai.ru      --> Management UI (:3000)
   |-- borisovai.ru             --> Next.js (:3000)
   |-- api.borisovai.ru         --> Strapi (:1337)
   |-- ...остальные сервисы...

Umami (:3000) --> PostgreSQL (:5432)
```

### Docker Compose (шаблон)

```yaml
services:
  umami:
    image: ghcr.io/umami-software/umami:postgresql-latest
    environment:
      DATABASE_URL: postgresql://umami:${UMAMI_DB_PASSWORD}@umami-db:5432/umami
      TRACKER_SCRIPT_NAME: ${TRACKER_SCRIPT_NAME:-stats}  # обход AdBlock
    ports:
      - "127.0.0.1:3001:3000"  # только localhost, Traefik проксирует
    restart: always
    depends_on:
      umami-db:
        condition: service_healthy

  umami-db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: umami
      POSTGRES_USER: umami
      POSTGRES_PASSWORD: ${UMAMI_DB_PASSWORD}
    volumes:
      - umami-db-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U umami"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: always

volumes:
  umami-db-data:
```

### Traefik dynamic config (`/etc/traefik/dynamic/analytics.yml`)

```yaml
http:
  routers:
    analytics:
      rule: "Host(`analytics.borisovai.ru`) || Host(`analytics.borisovai.tech`)"
      entryPoints:
        - websecure
      service: analytics
      tls:
        certResolver: letsencrypt

  services:
    analytics:
      loadBalancer:
        servers:
          - url: "http://127.0.0.1:3001"
```

### DNS записи

```
analytics.borisovai.ru   → A → IP сервера
analytics.borisovai.tech → A → IP сервера
```

### Интеграция с Next.js (borisovai-site)

В `frontend/src/app/layout.tsx`:

```tsx
import Script from 'next/script';

// В JSX:
<Script
  src="https://analytics.borisovai.ru/stats.js"
  data-website-id="WEBSITE_ID_FROM_UMAMI_DASHBOARD"
  strategy="afterInteractive"
/>
```

### Кастомные события (опционально)

```typescript
// Отслеживание клика по кнопке
umami.track('button-click', { name: 'download', page: '/projects' });

// Отслеживание просмотра проекта
umami.track('project-view', { slug: 'my-project' });
```

---

## Рекомендация

### Umami — лучший выбор

**Почему:**
- Минимальные ресурсы (64-128 MB RAM) — критично при загруженном сервере
- Без cookies, GDPR-compliant из коробки — не нужен consent banner
- Простой деплой (2 контейнера) и администрирование
- Node.js-стек — единый стек с Management UI и сайтом
- MIT лицензия — никаких ограничений
- `TRACKER_SCRIPT_NAME` — обход блокировщиков рекламы
- REST API — можно интегрировать данные в Management UI
- Идеально ложится в существующую инфраструктуру (Traefik, DNS, systemd/Docker)

### Plausible CE — альтернатива

Если потребуются продвинутые фичи (воронки, цели, custom properties) и будет достаточно RAM (2+ GB).

---

## План развёртывания

1. Создать скрипт `scripts/single-machine/install-umami.sh`
2. Добавить Traefik конфиг `analytics.yml` в `configure-traefik.sh`
3. Создать DNS записи через Management UI
4. Установить Umami, зайти в дашборд, создать сайт
5. Добавить скрипт аналитики в `borisovai-site/frontend/src/app/layout.tsx`
6. Проверить: визиты отображаются, AdBlock не блокирует

## Файлы для реализации

| Файл | Действие |
|------|----------|
| `scripts/single-machine/install-umami.sh` | Создать — скрипт установки Umami |
| `config/single-machine/umami-docker-compose.yml` | Создать — шаблон docker-compose |
| `scripts/single-machine/configure-traefik.sh` | Обновить — добавить analytics конфиг |
| `CLAUDE.md` | Обновить — добавить Umami в таблицу сервисов |

---

## Источники

- [Umami + Docker + Traefik guide](https://aaronjbecker.com/posts/self-hosted-analytics-umami-docker-compose-traefik/)
- [Self-host Umami with Traefik](https://andrebuilds.dev/blog/self-host-umami-with-traefik/)
- [Umami vs Plausible vs Matomo](https://aaronjbecker.com/posts/umami-vs-plausible-vs-matomo-self-hosted-analytics/)
- [Best open source analytics tools](https://posthog.com/blog/best-open-source-analytics-tools)
- [Privacy-focused analytics 2025](https://userbird.com/blog/privacy-focused-analytics)
- [Self-Host Umami with Docker Compose](https://www.paulsblog.dev/self-host-umami-analytics-with-docker-compose/)
