# Исследование: Self-hosted туннелирование (замена ngrok)

## Задача

Развернуть на своём сервере инструмент для туннелирования трафика с сервера на локальную машину разработчика:
- Self-hosted на Debian/Ubuntu
- Автоматические поддомены `*.tunnel.borisovai.ru` / `*.tunnel.borisovai.tech`
- HTTPS через существующий Traefik (Let's Encrypt)
- HTTP + TCP туннели
- Аутентификация клиентов

## Текущая инфраструктура

- Traefik на 80/443, TLS termination, file provider (`/etc/traefik/dynamic/`)
- Два base_domain: `borisovai.ru`, `borisovai.tech`
- DNS API на порту 5353

---

## Сводная таблица (10 инструментов)

| Инструмент | Stars | Язык | Wildcard DNS | HTTP | TCP | UDP | Auth | Web UI | Traefik | Подходит? |
|---|---|---|---|---|---|---|---|---|---|---|
| **frp** | ~104k | Go | Да (`subdomainHost`) | Да | Да | Да | Token, OIDC | Dashboard | Отлично | **ДА** |
| **sish** | ~4.4k | Go | Да | Да | Да | Нет | SSH-ключи | Нет | Хорошо | **ДА** |
| **pgrok** | ~3.4k | Go | Да | Да | Да | Нет | OIDC/SSO | Да | Средне | Условно |
| **zrok** | ~3.8k | Go | Да | Да | Да | Да | Аккаунты | Да | Сложно | Нет (overkill) |
| **chisel** | ~15.4k | Go | Нет | Нет | Да | Да | User:pass | Нет | Нужен сверху | Нет |
| **rathole** | ~10k | Rust | Нет | Нет | Да | Да | Token | Нет | Нужен сверху | Нет |
| **bore** | ~9k | Rust | Нет | Нет | Да | Нет | HMAC | Нет | Нет | Нет |
| **Expose** | ~4.5k | PHP | Да | Да | Нет | Нет | Token | Dashboard | Нужен RP | Нет |
| **tunnelto** | ~3.7k | Rust | Да | Да | Нет | Нет | API Key | Inspection | Нужен RP | Нет |
| **boringproxy** | ~2k | Go | Да | Да | Нет | Нет | Token | Да | Конфликт | Нет |

---

## Детальный анализ

### 1. frp (fatedier/frp)

- **GitHub**: https://github.com/fatedier/frp
- **Stars**: ~104k | **Последний релиз**: v0.66.0 (январь 2026)
- **Язык**: Go
- **Архитектура**: frps (сервер) + frpc (клиент), отдельные бинарники
- **Wildcard DNS**: Да — `subdomainHost` в конфиге сервера, клиент указывает `subdomain = "myapp"` → `myapp.tunnel.borisovai.ru`
- **TLS**: Встроенного ACME нет, но отлично работает за Traefik — Traefik терминирует TLS, frps слушает на внутреннем порту
- **Туннели**: HTTP, HTTPS, TCP, UDP, STCP (секретный TCP), XTCP (P2P)
- **Auth**: Token (по умолчанию), OIDC (Client Credentials Grant)
- **Web UI**: Встроенный dashboard с мониторингом (порт 7500)
- **Traefik**: **Отличная совместимость** — frps слушает HTTP на `vhostHTTPPort` (7080), Traefik проксирует `*.tunnel.borisovai.ru` на этот порт
- **Плюсы**:
  - Самый зрелый проект, огромное сообщество
  - Встроенная поддержка wildcard поддоменов через `subdomainHost`
  - OIDC auth для безопасности
  - TCP/UDP/HTTP — полный набор
  - Горячая перезагрузка конфигов клиента
  - Load balancing между несколькими клиентами
  - Dashboard для мониторинга активных туннелей
- **Минусы**:
  - Нет встроенного ACME (не проблема с Traefik)
  - Клиенту нужно скачать бинарник frpc

### 2. sish (antoniomika/sish)

- **GitHub**: https://github.com/antoniomika/sish
- **Stars**: ~4.4k | Активная разработка
- **Язык**: Go
- **Архитектура**: Единый сервер (sish), клиент — стандартный SSH
- **Wildcard DNS**: Да — wildcard A-запись `*.tunnel.borisovai.ru`, sish автоматически создает поддомены
- **TLS**: Внешние сертификаты (директория с .crt/.key), нет встроенного ACME
- **Туннели**: HTTP(S), WebSocket (WS/WSS), TCP
- **Auth**: SSH-ключи (authorized_keys), пароль, IP-whitelisting по CIDR
- **Web UI**: Нет
- **Traefik**: **Хорошая совместимость** — sish слушает HTTP на внутреннем порту, Traefik терминирует TLS и проксирует wildcard
- **Плюсы**:
  - Клиент — обычный `ssh`, нулевая установка (`ssh -R 80:localhost:3000 tunnel.borisovai.ru`)
  - Автоматические поддомены
  - Load balancing
  - Минимальная конфигурация
- **Минусы**:
  - Нет Web UI / dashboard
  - Нет встроенного ACME
  - Нет UDP
  - **Один `--domain`** — не поддерживает два base_domain нативно (нужен workaround или два инстанса)

### 3. pgrok (pgrok/pgrok)

- **GitHub**: https://github.com/pgrok/pgrok
- **Stars**: ~3.4k | Средняя активность
- **Язык**: Go
- **Архитектура**: pgrokd (сервер) + pgrok (клиент) или стандартный SSH
- **Wildcard DNS**: Да — стабильный поддомен на каждого пользователя
- **TLS**: Внешний (reverse proxy)
- **Туннели**: HTTP, TCP
- **Auth**: OIDC/SSO (Google, Okta, GitLab, Keycloak)
- **Web UI**: Да (управление пользователями, просмотр туннелей)
- **Traefik**: Средняя — работает за Traefik через reverse proxy
- **Плюсы**:
  - Multi-tenant, OIDC SSO из коробки
  - Стабильные поддомены per-user
  - Path-based routing
  - Веб-панель управления
- **Минусы**:
  - Заточен под команды разработчиков
  - Нет UDP
  - **Требует SSO-провайдер** (Keycloak, GitLab, Google) — лишняя инфраструктура

### 4. zrok (openziti/zrok)

- **GitHub**: https://github.com/openziti/zrok
- **Stars**: ~3.8k | Последний релиз: v2.0 (2025-2026)
- **Язык**: Go
- **Архитектура**: Ziti Controller + Ziti Router + zrok Controller + zrok Frontend (сложный стек)
- **Wildcard DNS**: Да — `*.share.example.com`
- **TLS**: Внешний (Caddy с DNS-plugin или reverse proxy)
- **Туннели**: HTTP/HTTPS, TCP, UDP, файлы
- **Auth**: Аккаунты с токенами, приватные/публичные share
- **Web UI**: Да (консоль управления)
- **Traefik**: **Сложная интеграция** — собственный стек (OpenZiti overlay network)
- **Плюсы**:
  - Zero-trust networking
  - Приватные туннели без публичного endpoint
  - Custom domains
  - Полнофункциональная консоль
- **Минусы**:
  - **Очень сложное развертывание** (Ziti Controller + Router + zrok)
  - Overkill для простых dev-туннелей
  - Тяжело вписать в существующий Traefik

### 5. chisel (jpillora/chisel)

- **GitHub**: https://github.com/jpillora/chisel
- **Stars**: ~15.4k | Последний релиз: v1.10.0
- **Язык**: Go
- **Архитектура**: chisel server + chisel client (один бинарник)
- **Wildcard DNS**: Нет (TCP/UDP туннель через HTTP transport)
- **TLS**: Да (встроенный Let's Encrypt)
- **Туннели**: TCP, UDP через HTTP/WebSocket транспорт
- **Auth**: Username:password, SSH fingerprint
- **Web UI**: Нет
- **Traefik**: Работает за Traefik, но нет HTTP-уровня маршрутизации по доменам
- **Плюсы**:
  - Один бинарник, LE из коробки
  - SSH шифрование
  - Множественные туннели через одно соединение
- **Минусы**:
  - **Нет HTTP-уровня** — нет поддоменов, только port-forwarding через HTTP transport
  - Не подходит для wildcard-маршрутизации

### 6. rathole (rathole-org/rathole)

- **GitHub**: https://github.com/rathole-org/rathole
- **Stars**: ~10k | Средняя активность
- **Язык**: Rust
- **Архитектура**: rathole server + rathole client
- **Wildcard DNS**: Нет — TCP-only проксирование
- **TLS**: Шифрование транспорта (Noise Protocol, TLS), но не ACME
- **Туннели**: TCP, UDP только
- **Auth**: Token (обязательный, per-service)
- **Web UI**: Нет
- **Traefik**: Нужен Traefik/Nginx сверху для HTTP routing и поддоменов
- **Плюсы**:
  - Минимальное потребление ресурсов (~500KB бинарник)
  - Очень высокая производительность
  - Hot-reload конфигов
- **Минусы**:
  - **Нет HTTP-уровня** — не понимает домены/поддомены, только порт-форвардинг
  - Нужен отдельный reverse proxy для wildcard

### 7. bore (ekzhang/bore)

- **GitHub**: https://github.com/ekzhang/bore
- **Stars**: ~9k | Стабильный (v0.6.0)
- **Язык**: Rust
- **Архитектура**: bore server + bore local (клиент)
- **Wildcard DNS**: Нет
- **TLS**: Нет
- **Туннели**: TCP только
- **Auth**: HMAC shared secret
- **Web UI**: Нет
- **Traefik**: Нет (TCP only, без HTTP-уровня)
- **Плюсы**:
  - ~400 строк кода, тривиальная установка
  - Минимализм
- **Минусы**:
  - **Не подходит** — только TCP, нет HTTP/поддоменов/TLS

### 8. Expose (exposedev/expose)

- **GitHub**: https://github.com/exposedev/expose
- **Stars**: ~4.5k | Средняя активность
- **Язык**: PHP
- **Архитектура**: expose server + expose client
- **Wildcard DNS**: Да (автоматические поддомены)
- **TLS**: Через reverse proxy (Nginx/Traefik)
- **Туннели**: HTTP только
- **Auth**: Token (SQLite база пользователей)
- **Web UI**: Да (dashboard для инспекции запросов)
- **Traefik**: Работает за reverse proxy
- **Плюсы**:
  - Dashboard, инспекция запросов
  - Простой в использовании
- **Минусы**:
  - PHP-стек (требует PHP 7.4+)
  - Только HTTP, нет TCP/UDP

### 9. tunnelto (agrinman/tunnelto)

- **GitHub**: https://github.com/agrinman/tunnelto
- **Stars**: ~3.7k | Низкая активность
- **Язык**: Rust
- **Архитектура**: tunnelto_server + tunnelto_client
- **Wildcard DNS**: Да (пользовательские поддомены)
- **TLS**: Через reverse proxy
- **Туннели**: HTTP только
- **Auth**: API Key
- **Web UI**: Inspection dashboard
- **Traefik**: Работает за reverse proxy
- **Плюсы**:
  - Простой, Rust, async-io на tokio
- **Минусы**:
  - Только HTTP, низкая активность разработки
  - Мало документации для self-hosted

### 10. boringproxy (boringproxy/boringproxy)

- **GitHub**: https://github.com/boringproxy/boringproxy
- **Stars**: ~2k | Низкая активность
- **Язык**: Go
- **Архитектура**: boringproxy server + boringproxy client (один бинарник)
- **Wildcard DNS**: Да (per-tunnel домены)
- **TLS**: Да (встроенный Let's Encrypt ACME)
- **Туннели**: HTTP/HTTPS только
- **Auth**: Token
- **Web UI**: Да (полноценный веб-интерфейс)
- **Traefik**: **Конфликт** — сам является reverse proxy, занимает порты 80/443
- **Плюсы**:
  - Всё-в-одном, zero config, веб-UI, автоматический HTTPS
- **Минусы**:
  - **Не совместим с Traefik** — конфликтует на портах 80/443
  - Нет TCP/UDP
  - Beta-качество

---

## Почему не подходят

| Инструмент | Причина |
|---|---|
| bore, rathole, chisel | TCP-only, нет HTTP-уровня (нет маршрутизации по доменам/поддоменам) |
| boringproxy | Сам является reverse proxy, конфликтует с Traefik на портах 80/443 |
| zrok | Overkill — требует OpenZiti Controller + Router + zrok Controller |
| tunnelto | Только HTTP, низкая активность разработки |
| Expose | PHP-стек, только HTTP, нет TCP/UDP |
| pgrok | Требует SSO-провайдер (Keycloak/Authentik) — лишняя инфраструктура |

---

## Интеграция с Traefik

Ключевой вопрос: как tunnel server сосуществует с Traefik, который уже слушает 80/443?

### Схема: Traefik → tunnel server → локальная машина

```
Internet
   |
   v
Traefik (:443, TLS termination)
   |
   |-- *.tunnel.borisovai.ru  --> tunnel server (:8080, HTTP vhost)
   |-- admin.borisovai.ru     --> Management UI (:3000)
   |-- gitlab.dev.borisovai.ru --> GitLab (:8929)
   |-- ...остальные сервисы...
   |
tunnel server (:8080 HTTP vhost, :7000 control channel)
   |
   |-- myapp.tunnel.borisovai.ru --> клиент на локальной машине --> localhost:3000
   |-- api.tunnel.borisovai.ru   --> клиент на локальной машине --> localhost:8080
```

### Принцип работы

1. **Traefik** остается единственным listener на 80/443, терминирует TLS
2. **Tunnel server** слушает HTTP на внутреннем порту (8080) — только localhost, не открыт в firewall
3. **Traefik** проксирует `*.tunnel.borisovai.ru` на tunnel server по `HostRegexp` правилу
4. **Control channel** (порт 7000) — единственный порт, который нужно открыть в firewall для подключения клиентов
5. **TLS/сертификаты** управляются Traefik (certResolver: letsencrypt)
6. **DNS** — wildcard A-запись `*.tunnel.borisovai.ru` → IP сервера (один раз)

### Решение конфликта портов

Tunnel server **никогда не слушает** 80/443. Только:
- Внутренний HTTP порт (8080) — доступен через Traefik
- Control channel (7000) — для подключения клиентов
- Dashboard (7500) — только localhost

---

## Рекомендации

### 1. frp — лучший выбор

**Почему:**
- Самый зрелый проект (104k stars, активная разработка)
- Встроенный `subdomainHost` — клиент указывает `subdomain = "myapp"` → `myapp.tunnel.borisovai.ru`
- HTTP + TCP + UDP + P2P туннели
- OIDC / Token аутентификация
- Dashboard для мониторинга
- Идеально ложится за Traefik
- Поддержка двух base_domains через Host header (Traefik форвардит оба wildcard-домена на один порт)
- Один бинарник, systemd, 5 минут на установку

### 2. sish — альтернатива (SSH-клиент)

**Почему:**
- Клиент — обычный SSH, нулевая установка: `ssh -R 80:localhost:3000 tunnel.borisovai.ru -p 2222`
- Автоматические поддомены

**Ограничение:** один `--domain`, для двух base_domains нужен workaround

### 3. pgrok — для команды с SSO

**Почему:**
- OIDC SSO из коробки, стабильные поддомены per-user, multi-tenant

**Ограничение:** требует SSO-провайдер

### Сравнение frp vs sish

| Критерий | frp | sish |
|---|---|---|
| Клиент | frpc (бинарник, нужна установка) | ssh (есть везде) |
| Субдомены | `subdomainHost` (встроен) | `--domain` (один) |
| Мульти-домен | Да (через Host header) | Нет (один domain) |
| TCP туннели | Да (полноценно) | Через SSH port forwarding |
| UDP туннели | Да | Нет |
| Auth | Token, OIDC | SSH-ключи |
| Dashboard | Да (порт 7500) | Нет |
| Зрелость | 104k stars | 4.4k stars |
| Установка клиента | Скачать бинарник + конфиг | Ничего |

---

## Готовые конфиги (frp + Traefik)

### DNS (wildcard A-записи, один раз)

```
*.tunnel.borisovai.ru   → A → IP сервера
*.tunnel.borisovai.tech → A → IP сервера
```

### frps — сервер (`/etc/frp/frps.toml`)

```toml
bindPort = 7000                          # control channel (открыть в firewall)
vhostHTTPPort = 8080                     # HTTP vhost (за Traefik, НЕ открывать в firewall)
subdomainHost = "tunnel.borisovai.ru"    # автоматические поддомены
auth.method = "token"
auth.token = "CHANGE_ME_SECURE_TOKEN"
webServer.addr = "127.0.0.1"            # dashboard (только локально)
webServer.port = 7500
webServer.user = "admin"
webServer.password = "CHANGE_ME_SECRET"
```

### Traefik dynamic config (`/etc/traefik/dynamic/tunnels.yml`)

```yaml
http:
  routers:
    tunnels:
      rule: "HostRegexp(`^.+\\.tunnel\\.borisovai\\.ru$`) || HostRegexp(`^.+\\.tunnel\\.borisovai\\.tech$`)"
      service: tunnel-frp
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt
      priority: 1
  services:
    tunnel-frp:
      loadBalancer:
        passHostHeader: true
        servers:
          - url: "http://127.0.0.1:8080"
```

### Systemd unit (`/etc/systemd/system/frps.service`)

```ini
[Unit]
Description=frp server
After=network.target

[Service]
Type=simple
ExecStart=/usr/local/bin/frps -c /etc/frp/frps.toml
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### frpc — клиент Windows (`frpc.toml`)

```toml
serverAddr = "borisovai.ru"
serverPort = 7000
auth.token = "CHANGE_ME_SECURE_TOKEN"

[[proxies]]
name = "my-project"
type = "http"
localPort = 3000
subdomain = "my-project"
# Результат: https://my-project.tunnel.borisovai.ru → localhost:3000
```

### Firewall

```bash
# Открыть только control channel
ufw allow 7000/tcp comment "frp control channel"

# Порты 8080 и 7500 НЕ открывать — доступны только через Traefik/localhost
```

---

## Шаги реализации

1. **DNS** — создать wildcard A-записи `*.tunnel.borisovai.ru` и `*.tunnel.borisovai.tech` → IP сервера
2. **Установка frps** — скачать бинарник, создать `/etc/frp/frps.toml`
3. **Systemd** — создать и запустить `frps.service`
4. **Traefik** — добавить `/etc/traefik/dynamic/tunnels.yml` (wildcard HostRegexp → frps:8080)
5. **Firewall** — открыть порт 7000 (control channel)
6. **Клиент** — скачать frpc на Windows, создать `frpc.toml`, запустить
7. **Опционально** — интеграция с Management UI (генерация конфигов, мониторинг, dashboard proxy)

## Верификация

1. `systemctl start frps && systemctl status frps` — frps запущен
2. `curl -H "Host: test.tunnel.borisovai.ru" http://127.0.0.1:8080` — ответ frp "tunnel not found"
3. Запустить frpc на локальной машине с `localPort = 3000`
4. Открыть `https://test.tunnel.borisovai.ru` — проксирует на localhost:3000
5. Dashboard: `http://127.0.0.1:7500`

---

## Источники

- [frp GitHub](https://github.com/fatedier/frp) (~104k stars)
- [frp subdomain docs](https://gofrp.org/en/docs/features/http-https/subdomain/)
- [frp auth docs](https://gofrp.org/en/docs/features/common/authentication/)
- [sish GitHub](https://github.com/antoniomika/sish) (~4.4k stars)
- [sish docs](https://docs.ssi.sh/getting-started)
- [pgrok GitHub](https://github.com/pgrok/pgrok) (~3.4k stars)
- [zrok GitHub](https://github.com/openziti/zrok) (~3.8k stars)
- [chisel GitHub](https://github.com/jpillora/chisel) (~15.4k stars)
- [rathole GitHub](https://github.com/rathole-org/rathole) (~10k stars)
- [bore GitHub](https://github.com/ekzhang/bore) (~9k stars)
- [Expose GitHub](https://github.com/exposedev/expose) (~4.5k stars)
- [tunnelto GitHub](https://github.com/agrinman/tunnelto) (~3.7k stars)
- [boringproxy GitHub](https://github.com/boringproxy/boringproxy) (~2k stars)
- [awesome-tunneling](https://github.com/anderspitman/awesome-tunneling)
