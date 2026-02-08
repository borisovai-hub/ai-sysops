# Исследование: Единая система входа (SSO) для borisovai-admin

## 1. Текущее состояние авторизации

| Компонент | Тип авторизации | Метод | Хранилище |
|-----------|----------------|-------|-----------|
| Management UI (веб) | Session | username/password | memory (cookies 24ч) |
| Management UI (API) | Bearer Token | `Authorization: Bearer` | `/etc/management-ui/auth.json` |
| Traefik | **Нет** | — | — |
| GitLab CE | Встроенная | PRIVATE-TOKEN (API) | GitLab DB |
| DNS API | **Нет** | — | Только localhost:5353 |
| Strapi Admin | Встроенная + JWT | login/password | Strapi DB |
| Strapi API | Bearer Token | `Authorization: Bearer` | Strapi Admin Tokens |
| Next.js сайт | **Нет** | — | Публичный |

**Проблемы текущей системы:**
- 4 отдельных набора учётных данных (Management UI, GitLab, Strapi Admin, Strapi API tokens)
- Нет единой точки управления пользователями
- Нет MFA (кроме GitLab)
- Traefik не защищает сервисы на уровне прокси
- Sessions хранятся в памяти Express (теряются при рестарте)

---

## 2. Сравнение SSO-решений

### Сводная таблица

| Критерий | **Authelia** | **Authentik** | **Keycloak** | **Zitadel** |
|---|---|---|---|---|
| Язык | Go | Python + Go | Java (Quarkus) | Go |
| RAM idle | **20-30 MB** | 700-800 MB | 400-500 MB | 370-512 MB |
| RAM нагрузка | <100 MB | 1.5-2+ GB | 1.2-2 GB | 700 MB-1 GB |
| Docker image | <20 MB | ~1 GB | ~400 MB | ~200 MB |
| Контейнеры | **1** | 3+ (server+worker+postgres) | 2 (keycloak+postgres) | 2 (zitadel+postgres) |
| Хранилище | **SQLite + YAML** | PostgreSQL (обязательно) | PostgreSQL | PostgreSQL |
| OIDC | Да (certified) | Да | Да (certified) | Да (certified) |
| SAML 2.0 | Нет | Да | Да | Да |
| LDAP provider | Нет | Да | Да | Нет |
| MFA (TOTP) | Да | Да | Да | Да |
| MFA (WebAuthn) | Да | Да | Да | Да |
| Passkeys | Да | Да | Да | Да |
| Traefik ForwardAuth | **Нативная** | Нативная | Через стороннее | Через стороннее |
| Admin UI | **Нет** (YAML) | Отличный | Мощный | Современный |
| Self-service портал | Да (MFA, пароль) | Полный | Полный | Полный |
| RBAC / группы | Базовый | Полный | Полный (UMA, FGAP) | Через Organizations |
| GitHub stars | ~22.5K | ~14.5K | ~30-41K | ~12.9K |
| Зрелость | С 2019 | С 2020 | С 2014 (Red Hat) | С 2020 |
| Установка | **10-15 мин** | 30-45 мин | 20-30 мин | 20-30 мин |

### GitLab CE как OIDC Provider

GitLab CE **может** выступать как OIDC Provider (Admin > Applications > OAuth Application с scope `openid`). Endpoint: `https://<gitlab>/.well-known/openid-configuration`.

**Ограничения:**
- Нет ForwardAuth — только redirect-based OIDC flow
- Нет MFA enforcement для внешних клиентов
- Нет кастомных scopes
- Нет SAML provider
- Нет fine-grained RBAC для внешних приложений
- Подходит для простых сценариев (2-5 приложений), но не для полноценного SSO

---

## 3. Интеграция с компонентами инфраструктуры

### 3.1. Traefik ForwardAuth

```yaml
# /etc/traefik/dynamic/authelia.yml
http:
  middlewares:
    authelia:
      forwardAuth:
        address: 'http://authelia:9091/api/authz/forward-auth'
        trustForwardHeader: true
        authResponseHeaders:
          - 'Remote-User'
          - 'Remote-Groups'
          - 'Remote-Email'
          - 'Remote-Name'
```

SSO на все поддомены через одну cookie:
```yaml
# authelia configuration.yml
session:
  cookies:
    - domain: 'borisovai.ru'
      authelia_url: 'https://auth.borisovai.ru'
      default_redirection_url: 'https://admin.borisovai.ru'
```

### 3.2. GitLab CE OIDC

```ruby
# /etc/gitlab/gitlab.rb
gitlab_rails['omniauth_enabled'] = true
gitlab_rails['omniauth_allow_single_sign_on'] = ['openid_connect']
gitlab_rails['omniauth_auto_link_user'] = ['openid_connect']
gitlab_rails['omniauth_block_auto_created_users'] = false

gitlab_rails['omniauth_providers'] = [
  {
    name: "openid_connect",
    label: "BorisovAI SSO",
    args: {
      name: "openid_connect",
      scope: ["openid", "profile", "email"],
      response_type: "code",
      issuer: "https://auth.borisovai.ru",
      discovery: true,
      client_auth_method: "query",
      uid_field: "preferred_username",
      pkce: true,
      client_options: {
        identifier: "gitlab",
        secret: "CLIENT_SECRET",
        redirect_uri: "https://gitlab.borisovai.ru/users/auth/openid_connect/callback"
      }
    }
  }
]
```

**Доступно в CE** (Free tier). Group sync — только Premium.

### 3.3. Strapi v5 (Community Edition)

SSO для admin panel — **только Enterprise**. Но есть community-плагин:

```bash
npm install strapi-plugin-sso
```

```javascript
// config/plugins.js
module.exports = {
  'strapi-plugin-sso': {
    enabled: true,
    config: {
      OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
      OIDC_CLIENT_SECRET: process.env.OIDC_CLIENT_SECRET,
      OIDC_AUTHORIZATION_ENDPOINT: 'https://auth.borisovai.ru/api/oidc/authorization',
      OIDC_TOKEN_ENDPOINT: 'https://auth.borisovai.ru/api/oidc/token',
      OIDC_USER_INFO_ENDPOINT: 'https://auth.borisovai.ru/api/oidc/userinfo',
      OIDC_REDIRECT_URI: 'https://strapi.borisovai.ru/strapi-plugin-sso/oidc/callback',
    },
  },
};
```

**Альтернатива:** Защитить Strapi Admin через Traefik ForwardAuth (проще и надёжнее).

### 3.4. Management UI (Express.js)

Рекомендуемый пакет: `express-openid-connect` (~370K weekly downloads).

```javascript
const { auth, requiresAuth } = require('express-openid-connect');

app.use(auth({
  authRequired: false,
  issuerBaseURL: 'https://auth.borisovai.ru',
  baseURL: 'https://admin.borisovai.ru',
  clientID: 'management-ui',
  clientSecret: process.env.OIDC_CLIENT_SECRET,
  secret: process.env.SESSION_SECRET,
  authorizationParams: {
    response_type: 'code',
    scope: 'openid profile email',
  },
}));

// Защита маршрутов
app.get('/api/services', requiresAuth(), (req, res) => { ... });
```

**Важно:** Bearer token auth для агентов остаётся как есть. OIDC добавляется для браузерного доступа.

### 3.5. Next.js (borisovai-site)

Auth.js v5 с custom OIDC provider:

```typescript
// auth.ts
import NextAuth from "next-auth";

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    {
      id: "borisovai-sso",
      name: "BorisovAI SSO",
      type: "oidc",
      issuer: "https://auth.borisovai.ru",
      clientId: process.env.AUTH_CLIENT_ID,
      clientSecret: process.env.AUTH_CLIENT_SECRET,
    },
  ],
});
```

---

## 4. Три варианта архитектуры

### Вариант A: Authelia (рекомендуемый)

```
                    ┌─────────────────────────────┐
                    │        Traefik               │
                    │   (reverse proxy)            │
                    │                              │
                    │  ForwardAuth middleware ──────┼──► Authelia (auth.borisovai.ru)
                    │                              │    ├── OIDC Provider
                    └──┬──────┬──────┬──────┬──────┘    ├── MFA (TOTP/WebAuthn)
                       │      │      │      │           ├── SQLite + users.yml
                       ▼      ▼      ▼      ▼           └── ~30 MB RAM
                    GitLab  Strapi  Mgmt   Next.js
                    (OIDC)  (FwdA)  (OIDC) (OIDC/public)
```

**Преимущества:**
- Минимум ресурсов (30 MB RAM, один контейнер)
- Нативная интеграция с Traefik (3 строки конфига)
- SQLite + YAML — нет зависимости от PostgreSQL
- SSO на все `*.borisovai.ru` через одну cookie
- MFA из коробки (TOTP + WebAuthn + Passkeys)
- OIDC certified — работает с GitLab, Express, Next.js

**Недостатки:**
- Нет Admin UI — всё через YAML файлы
- Нет SAML (только OIDC)
- Нет LDAP provider
- Добавление пользователей — редактирование файла

**Ресурсы:** +30 MB RAM, +1 контейнер

### Вариант B: Authentik

```
                    ┌─────────────────────────────┐
                    │        Traefik               │
                    │   (reverse proxy)            │
                    │                              │
                    │  ForwardAuth middleware ──────┼──► Authentik (auth.borisovai.ru)
                    │                              │    ├── OIDC/SAML/LDAP Provider
                    └──┬──────┬──────┬──────┬──────┘    ├── Full Admin UI
                       │      │      │      │           ├── PostgreSQL required
                       ▼      ▼      ▼      ▼           └── ~800 MB RAM
                    GitLab  Strapi  Mgmt   Next.js
                    (OIDC)  (OIDC)  (OIDC) (OIDC/public)
```

**Преимущества:**
- Полноценный IdP с красивым Admin UI
- Visual flow designer (уникальная фича)
- OIDC + SAML + LDAP provider
- Управление пользователями через веб-интерфейс
- Self-service портал для пользователей

**Недостатки:**
- Тяжёлый: 800 MB+ RAM, 3+ контейнера
- Требует PostgreSQL
- Сложнее в настройке и поддержке

**Ресурсы:** +800 MB RAM, +3 контейнера, +PostgreSQL

### Вариант C: GitLab CE как IdP (минимальный)

```
                    ┌─────────────────────────────┐
                    │        Traefik               │
                    │   (reverse proxy)            │
                    │                              │
                    └──┬──────┬──────┬──────┬──────┘
                       │      │      │      │
                       ▼      ▼      ▼      ▼
                    GitLab  Strapi  Mgmt   Next.js
                    (IdP)   (OIDC)  (OIDC) (OIDC/public)
                       │
                       └── OIDC Provider (встроенный)
```

**Преимущества:**
- Нулевые дополнительные ресурсы — GitLab уже есть
- Все пользователи уже в GitLab
- Нет новых компонентов в инфраструктуре

**Недостатки:**
- Нет ForwardAuth — нельзя защитить Traefik
- Нет MFA enforcement для внешних клиентов
- Ограниченный RBAC (только groups claim)
- Нет self-service портала
- GitLab = Single Point of Failure для всей авторизации

**Ресурсы:** +0 (используется существующий GitLab)

---

## 5. Рекомендация

### Для borisovai-admin: **Вариант A — Authelia**

**Почему:**

1. **Ресурсы.** Single-server инфраструктура — 30 MB vs 800 MB критично
2. **Traefik.** Нативная ForwardAuth интеграция — эталонная документация
3. **Простота.** Один контейнер, один YAML конфиг, SQLite
4. **Достаточность.** OIDC certified покрывает все компоненты (GitLab, Express, Next.js)
5. **MFA.** TOTP + WebAuthn + Passkeys из коробки
6. **SSO.** Одна cookie на `*.borisovai.ru` — вход один раз, доступ ко всему

**Компромисс:** Нет Admin UI (управление через YAML), но при малом числе пользователей это не проблема. При росте можно мигрировать на Authentik.

### План внедрения (поэтапный)

**Фаза 1: Базовая установка Authelia**
- Развернуть Authelia на `auth.borisovai.ru`
- Настроить users.yml с текущими пользователями
- Настроить SQLite для sessions/storage
- Включить TOTP MFA

**Фаза 2: Traefik ForwardAuth**
- Добавить ForwardAuth middleware в Traefik
- Защитить Management UI через ForwardAuth
- Защитить Strapi Admin через ForwardAuth
- Настроить access control rules (по URL/группам)

**Фаза 3: OIDC интеграция**
- Настроить Authelia как OIDC provider
- Подключить GitLab CE через OIDC (gitlab.rb)
- Интегрировать Management UI через `express-openid-connect`
- Добавить Auth.js в Next.js (если нужны защищённые страницы)

**Фаза 4: Убрать legacy auth**
- Удалить session auth из Management UI (заменён OIDC)
- Оставить Bearer token для агентов (API)
- Централизовать управление пользователями в Authelia

---

## 6. Источники

- [Authelia — Traefik Integration](https://www.authelia.com/integration/proxies/traefik/)
- [Authentik — Traefik ForwardAuth](https://docs.goauthentik.io/add-secure-apps/providers/proxy/server_traefik/)
- [GitLab CE — OIDC Authentication](https://docs.gitlab.com/administration/auth/oidc/)
- [GitLab — OpenID Connect Provider](https://docs.gitlab.com/integration/openid_connect_provider/)
- [Auth.js — Custom OIDC Providers](https://authjs.dev/guides/configuring-oauth-providers)
- [strapi-plugin-sso (Community)](https://github.com/yasudacloud/strapi-plugin-sso)
- [The State of Open-Source Identity in 2025](https://www.houseoffoss.com/post/the-state-of-open-source-identity-in-2025-authentik-vs-authelia-vs-keycloak-vs-zitadel)
- [Authentik vs Authelia vs Keycloak (Elest.io 2026)](https://blog.elest.io/authentik-vs-authelia-vs-keycloak-choosing-the-right-self-hosted-identity-provider-in-2026/)
- [La Contre-Voie — 11 SSO solutions comparison](https://lacontrevoie.fr/en/blog/2024/comparatif-de-onze-solutions-de-sso-libres/)
