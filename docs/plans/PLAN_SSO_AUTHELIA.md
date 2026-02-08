# План: SSO через Authelia

> Основано на [RESEARCH_SSO.md](RESEARCH_SSO.md). Спроектировано: архитектор, SysOps, DevOps, разработчик.

## Решение

**Authelia** — Go-бинарник, ~30 MB RAM, SQLite, OIDC certified, нативная Traefik ForwardAuth.
Доступ: `auth.borisovai.ru` / `auth.borisovai.tech`, порт `9091` на `127.0.0.1`.

---

## Матрица доступа

| Сервис | Метод защиты | Authelia policy | Обоснование |
|--------|-------------|-----------------|-------------|
| Management UI | OIDC (express-openid-connect) + ForwardAuth | two_factor | Полный OIDC flow, SSO |
| GitLab CE | OIDC Provider в gitlab.rb | two_factor | Поддерживает внешний OIDC |
| n8n | Traefik ForwardAuth | two_factor | Нет встроенного OIDC |
| Mailu | Traefik ForwardAuth | two_factor | Нет OIDC в CE |
| Strapi API | **bypass** | — | Своя JWT auth, ломать опасно |
| Сайт (frontend) | **bypass** | — | Публичный |
| API сайта | **bypass** | — | Публичный |
| DNS API | Bearer token only | — | Внутренний (localhost:5353) |
| Туннели | **bypass** | — | Своя auth через frp token |
| Authelia portal | **bypass** | — | Сам себя не защищает |

---

## Cookie и session стратегия

Два домена — два отдельных session cookie:

```yaml
session:
  cookies:
    - domain: 'borisovai.ru'
      authelia_url: 'https://auth.borisovai.ru'
    - domain: 'borisovai.tech'
      authelia_url: 'https://auth.borisovai.tech'
```

- При логине на `*.borisovai.ru` — cookie ставится на `.borisovai.ru`
- При переходе на `*.borisovai.tech` — Authelia ставит cookie для `.borisovai.tech` (backend session та же, логин повторять не нужно)
- Express session **удаляется**, `express-openid-connect` хранит сессию в encrypted cookie (stateless RP)

---

## Фазы реализации

### Фаза 1: Установка Authelia (SysOps + DevOps)

**Новые файлы:**

| Файл | Описание |
|------|----------|
| `scripts/single-machine/install-authelia.sh` | Install-скрипт (7 шагов) |
| `config/contabo-sm-139/traefik/dynamic/authelia.yml` | ForwardAuth middleware + роутер |
| `config/contabo-sm-139/systemd/authelia.service` | Systemd unit |

**install-authelia.sh — 7 шагов:**

```
[1/7] Проверка зависимостей (idempotent, --force)
[2/7] Скачивание бинарника (/usr/local/bin/authelia)
[3/7] Генерация секретов (/etc/authelia/secrets/)
      - jwt_secret, session_secret, storage_encryption_key, oidc_hmac_secret
      - RSA ключ для OIDC (openssl genrsa 4096)
      - Client secrets для management-ui и gitlab
      - НЕ перегенерировать при --force
[4/7] Генерация конфигов
      - /etc/authelia/configuration.yml (подстановка base_domains, портов, секретов)
      - /etc/authelia/users_database.yml (admin из /etc/management-ui/auth.json)
[5/7] Systemd unit + запуск (User=authelia)
[6/7] DNS записи (create_dns_records_for_domains "auth")
[7/7] Traefik dynamic конфиг (/etc/traefik/dynamic/authelia.yml)
      - save_config_value "authelia_port" "9091"
```

**install-all.sh** — добавить `INSTALL_AUTHELIA` после Traefik, перед Management UI:

```
INSTALL_TRAEFIK → INSTALL_GITLAB → INSTALL_N8N →
INSTALL_AUTHELIA → INSTALL_MANAGEMENT_UI → INSTALL_DNS_API →
INSTALL_MAILU → INSTALL_FRPS → INSTALL_CICD
```

**Секреты** — генерируются однократно, хранятся в `/etc/authelia/secrets/`:

```
/etc/authelia/secrets/
  jwt_secret
  session_secret
  storage_encryption_key
  oidc_hmac_secret
  oidc.pem              # RSA private key
  mgmt_client_secret    # plain text (для config.json management-ui)
  gitlab_client_secret  # plain text (для gitlab.rb)
```

---

### Фаза 2: ForwardAuth для сервисов (SysOps)

Добавить middleware `authelia` в Traefik dynamic конфиги:

| Файл | Изменение |
|------|-----------|
| `management-ui.yml` | `middlewares: [management-ui-compress, authelia]` |
| `n8n.yml` | `middlewares: [n8n-compress, authelia]` |
| `mailu.yml` | `middlewares: [mailu-headers, mailu-compress, authelia]` для всех 3 роутеров |

**НЕ добавлять** для: `site.yml`, `gitlab.yml`, `gitlab-pages.yml`, `tunnels.yml`.

Обновить `configure-traefik.sh` — при генерации конфигов для защищённых сервисов добавлять `- authelia` в middlewares.

---

### Фаза 3: OIDC интеграция Management UI (Разработчик)

**server.js — dual-mode через `OIDC_ENABLED`:**

```js
const OIDC_ENABLED = config.oidc?.enabled === true;
```

| Компонент | OIDC_ENABLED=true | OIDC_ENABLED=false (default) |
|-----------|-------------------|------------------------------|
| Session | express-openid-connect cookie | express-session (как сейчас) |
| Login | Redirect на Authelia | POST /login (legacy) |
| Logout | GET /logout → Authelia | POST /logout → session.destroy |
| Bearer tokens | Работают как раньше | Работают как раньше |
| auth.json | Только tokens[] | Полный (username+password+tokens) |

**requireAuth (обновлённый):**

```js
function requireAuth(req, res, next) {
    // 1. Bearer token (агенты) — без изменений
    if (authHeader?.startsWith('Bearer ')) { ... }
    // 2. OIDC session
    if (OIDC_ENABLED && req.oidc?.isAuthenticated()) {
        req.authMethod = 'oidc';
        req.username = req.oidc.user?.preferred_username;
        return next();
    }
    // 3. Legacy session (dev mode)
    if (!OIDC_ENABLED && req.session?.authenticated) { ... }
}
```

**Зависимости:**
```diff
+ "express-openid-connect": "^2.17.1"
  "express-session" остаётся (для dev mode)
```

**config.json — новая секция:**
```json
{
    "oidc": {
        "enabled": true,
        "issuer": "https://auth.borisovai.ru",
        "base_url": "https://admin.borisovai.ru",
        "client_id": "management-ui",
        "client_secret": "...",
        "cookie_secret": "..."
    }
}
```

**HTML (5 файлов)** — единственное изменение: кнопка "Выход":
```js
// Универсальный logout
window.location.href = '/logout';
```

**GET /api/auth/check** — обновить для OIDC:
```js
if (OIDC_ENABLED) {
    return res.json({
        authenticated: !!req.oidc?.isAuthenticated(),
        username: req.oidc?.user?.preferred_username || null,
        authMethod: 'oidc'
    });
}
```

---

### Фаза 4: OIDC для GitLab CE

```ruby
# /etc/gitlab/gitlab.rb
gitlab_rails['omniauth_providers'] = [{
    name: "openid_connect",
    label: "BorisovAI SSO",
    args: {
        scope: ["openid", "profile", "email"],
        issuer: "https://auth.borisovai.ru",
        discovery: true,
        pkce: true,
        client_options: {
            identifier: "gitlab",
            secret: "<из /etc/authelia/secrets/gitlab_client_secret>",
            redirect_uri: "https://gitlab.dev.borisovai.ru/users/auth/openid_connect/callback"
        }
    }
}]
```

---

### Фаза 5: Убрать legacy auth

- Удалить `POST /login`, `POST /logout`, `login.html` (OIDC-only)
- Из `auth.json` убрать `username/password`, оставить только `tokens[]`
- `express-session` из зависимостей (dev mode через env переменную)

---

## CI/CD

**deploy-authelia.sh НЕ нужен.** Обоснование:
- Бинарник обновляется редко и вручную
- `configuration.yml` — серверный, содержит секреты, не в git
- Traefik `authelia.yml` — покрыт существующим `deploy-traefik.sh`

Файлы в git (деплоятся автоматически через CI):

| Файл | Деплой через |
|------|-------------|
| `config/contabo-sm-139/traefik/dynamic/authelia.yml` | deploy-traefik.sh |
| `config/contabo-sm-139/traefik/dynamic/management-ui.yml` | deploy-traefik.sh |
| `config/contabo-sm-139/traefik/dynamic/n8n.yml` | deploy-traefik.sh |
| `config/contabo-sm-139/traefik/dynamic/mailu.yml` | deploy-traefik.sh |
| `management-ui/server.js` | deploy-management-ui.sh |
| `scripts/single-machine/install-authelia.sh` | cp scripts/ |

---

## Риски

| Риск | Митигация |
|------|-----------|
| Два домена — нет cross-domain SSO | Dual-cookie + shared backend session в Authelia |
| Authelia падает → всё недоступно | systemd restart=always; Bearer tokens обходят ForwardAuth |
| GitLab CE: нет group sync | Ручное управление (1-2 пользователя) |
| Mixed auth (Bearer + OIDC) race | Bearer проверяется ДО OIDC middleware |
| express-openid-connect cookie >4KB | Минимальные scopes, rolling: false |
| SQLite lock при нагрузке | При 1-5 пользователях не проблема |

---

## Итого: затрагиваемые файлы

### Новые
- `scripts/single-machine/install-authelia.sh`
- `config/contabo-sm-139/traefik/dynamic/authelia.yml`
- `config/contabo-sm-139/systemd/authelia.service`

### Изменяемые
- `management-ui/server.js` (~50 строк: OIDC init, dual-mode middleware, conditional login/logout)
- `management-ui/package.json` (+express-openid-connect)
- `management-ui/public/*.html` (5 файлов — logout кнопка)
- `scripts/single-machine/install-all.sh` (INSTALL_AUTHELIA)
- `scripts/single-machine/configure-traefik.sh` (ForwardAuth middleware)
- `scripts/single-machine/install-management-ui.sh` (OIDC конфиг prompt)
- `config/contabo-sm-139/traefik/dynamic/management-ui.yml` (+authelia middleware)
- `config/contabo-sm-139/traefik/dynamic/n8n.yml` (+authelia middleware)
- `config/contabo-sm-139/traefik/dynamic/mailu.yml` (+authelia middleware)
- `CLAUDE.md` (документация)

### Не затрагиваются
- `.gitlab-ci.yml` (без изменений)
- `deploy-traefik.sh` (уже копирует все *.yml)
- `site.yml`, `gitlab.yml`, `tunnels.yml` (публичные/своя auth)
