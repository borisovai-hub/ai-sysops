# План: повышение стабильности туннелей (двухуровневое решение)

## Context

**Проблема.** Существующая связка `frpc (Windows) → frps (Contabo) → Traefik` даёт
незапланированный downtime при нестабильной сети:

- Клиент резолвит `serverAddr = "borisovai.tech"` при каждом переподключении.
  Системный DNS периодически отвечает `no such host` / `i/o timeout`, из-за чего
  короткий TCP-разрыв превращается в минуты downtime.
- TCP-транспорт frpc чувствителен к packet loss: при 5–10% потерь heartbeat
  (дефолт 30/90 с) не успевает восстановить сессию.
- Особенно болезненно для Ollama-туннелей (11434/11435/11436), где на сервере
  запущены агенты, которые ломаются при разрыве LLM-backend.

**Цель.** Минимально-инвазивно уменьшить среднее время восстановления туннеля с
десятков/сотен секунд до ≤5 секунд, не разрушая текущий стек
(Traefik vhost + Authelia + CI deploy).

**Принцип.** Двухуровневое решение: сначала выжимаем стабильность из уже
установленного frp (этап 1). Если для Ollama этого недостаточно — только
LLM-туннели переносим на Headscale/Tailscale mesh (этап 2). HTTP dev-туннели
(`*.tunnel.borisovai.ru/.tech`) остаются на frp в любом случае — для браузера
разрыв на 30 секунд безболезнен (автоматический retry).

---

## Текущее состояние

- **Сервер**: `frps` на Contabo, control port 17420 (TCP), vhost HTTP 17480 за
  Traefik, dashboard 17490. Конфиг: `/etc/frp/frps.toml`. Systemd unit
  `frps.service`. Установка: [`scripts/single-machine/install-frps.sh`](../../scripts/single-machine/install-frps.sh).
- **Клиенты**: Windows-машины с `frpc` как службой (`sc.exe`). Конфиги:
  [`config/frpc-template/frpc.toml`](../../config/frpc-template/frpc.toml),
  `frpc-ollama-11434/5/6.toml`, `frpc-ollama-tier.toml`. Bootstrap через
  PowerShell-скрипты [`scripts/frpc/setup-frpc-ollama*.ps1`](../../scripts/frpc/).
- **Уже сделано в коммите `c430a81`:**
  - `serverAddr` заменён с `borisovai.tech` на IP `144.91.108.139` во всех
    шаблонах и PS1-скриптах.
  - Добавлены `loginFailExit = false` и `dnsServer = "1.1.1.1"` для независимости
    от локального резолвера.
  - `install-frps.sh` печатает IP (через `getent hosts` + `hostname -I` fallback),
    а не hostname.

---

## Этап 1 — KCP transport в frp (минимальные изменения)

**Что даёт.** KCP — UDP-based reliable transport (аналог QUIC). Переживает 30%
packet loss, восстановление сессии за 1–3 секунды вместо 30–90 секунд TCP
heartbeat. Это лечит основной класс проблем «короткий дроп → длинный downtime».

**Изменения на сервере** (`/etc/frp/frps.toml`, через config-repo):

```toml
# В дополнение к существующим bindPort / vhostHTTPPort
kcpBindPort = 17420   # тот же порт, но UDP (frp слушает UDP и TCP одновременно)
```

UFW: `ufw allow 17420/udp` (TCP уже открыт).

**Изменения на клиенте** (`config/frpc-template/*.toml`):

```toml
serverAddr = "144.91.108.139"
serverPort = 17420
auth.token = "..."

# KCP-транспорт: UDP reliable, переживает packet loss
transport.protocol = "kcp"

# С KCP безопасно уменьшить heartbeat без ложных срабатываний
transport.heartbeatInterval = 15
transport.heartbeatTimeout = 45

loginFailExit = false
dnsServer = "1.1.1.1"
```

**Файлы для правки:**
- [`scripts/single-machine/install-frps.sh`](../../scripts/single-machine/install-frps.sh) — добавить генерацию `kcpBindPort` в `frps.toml` + `ufw allow 17420/udp`.
- [`config/frpc-template/frpc.toml`](../../config/frpc-template/frpc.toml), `frpc-ollama-*.toml`, `frpc-ollama-tier.toml` — добавить `transport.protocol`, `heartbeatInterval`, `heartbeatTimeout`.
- [`scripts/frpc/setup-frpc-ollama.ps1`](../../scripts/frpc/setup-frpc-ollama.ps1), `setup-frpc-ollama-tier.ps1` — те же поля в генерируемом `.toml`.

**Деплой:**
1. Commit в main → GitLab CI `deploy:frps` (manual job) → обновит сервер.
2. На каждом Windows-клиенте: обновить `C:\tools\frp\*.toml` (вручную или пере-run setup-скрипта), `sc.exe stop frpc-*` → `sc.exe start frpc-*`.

**Verification:**
```bash
# На сервере
ss -lnup | grep 17420        # UDP слушает
journalctl -u frps -n 50     # frps принял KCP-подключения

# На клиенте (Windows PowerShell)
Get-Content C:\tools\frp\frpc.log -Tail 50
# Ожидание: "[kcp]" в логах вместо "[tcp]"
```

**Метрики успеха (этап 1):**
- Искусственно рвать трафик на 10–30 секунд → туннель восстанавливается ≤5 секунд.
- Пропадание DNS на клиенте не влияет на туннель (IP уже зашит).
- За неделю эксплуатации: 0 случаев downtime >30 секунд по Ollama-туннелям.

**Время работы:** 1–2 часа (CI pipeline + обновление 2–3 клиентов).

**Риск:** минимальный. KCP встроен в frp, не требует отдельных компонентов. Если
не зайдёт — откатить `transport.protocol` → TCP в шаблоне и передеплоить.

---

## Этап 2 — Headscale для Ollama-туннелей (только если этап 1 недостаточен)

**Когда запускать этап 2.**
- Если через 1–2 недели наблюдения после этапа 1 остаются частые разрывы
  Ollama-туннелей (>1 раза в день), или
- Если на клиенте ISP блокирует/throttle UDP, из-за чего KCP тоже нестабилен.

**Что меняется.**
- Ollama-туннели `frpc-ollama-11434/11435/11436/tier` → выключаются на клиенте.
- Вместо них: Tailscale-клиент на Windows-машине, Headscale-сервер на Contabo.
- На сервере сервисы обращаются не к `localhost:11434`, а к
  `http://<tailnet-name>:11434` (или `<peer-ip>:11434`).
- Поверх mesh'а при необходимости — Traefik router внутрь tailnet
  (для красивого имени вроде `ollama.tunnel.borisovai.tech` → peer).

**Почему именно Headscale/Tailscale:**
- Официальный Windows-клиент MSI + autostart service + autoupdate — **не
  нужно** nssm/sc.exe/ручной релоад.
- Встроенный DERP-fallback: если UDP hole-punch не прошёл, автоматически
  переключается на TCP 443 relay без участия пользователя. Именно это решает
  flaky-NAT/CGNAT-ISP.
- Нулевой ingress на клиенте (CGNAT-friendly).
- Mesh VPN — Ollama становится «частным сервисом в домашней сети», без
  публичных портов. Security-win.
- У нас уже есть план [`PLAN_VPN_HEADSCALE.md`](PLAN_VPN_HEADSCALE.md),
  который это закрывает.

**Архитектура после этапа 2:**

```
┌─ Windows PC (AI workstation) ─────┐
│ Ollama 11434/11435/11436 (listen  │
│   127.0.0.1 + tailnet interface)  │
│ tailscale.exe (Windows Service)   │────udp/tcp-443───▶ Headscale control
└───────────────────────────────────┘                        (Contabo)
                  │ tailnet mesh
                  ▼
┌─ Contabo сервер ──────────────────┐
│ tailscaled (systemd)              │
│ n8n, strapi, agents:              │
│   OLLAMA_HOST=ai-box.tailnet:11434│
│ Traefik + frp (для dev HTTP       │
│   vhost — остаются как есть)      │
└───────────────────────────────────┘
```

**Основные шаги (выжимка, детали — в `PLAN_VPN_HEADSCALE.md`):**

1. Установить headscale systemd-сервис на Contabo; домен `headscale.borisovai.tech`
   через Traefik + Let's Encrypt.
2. Зарегистрировать сервер как node (`tailscale up --login-server=https://headscale...`).
3. Установить Tailscale MSI на Windows-машине → `tailscale login --login-server=...`.
4. `OLLAMA_HOST=0.0.0.0:11434` на клиенте (или bind на tailnet interface),
   firewall: разрешить 11434 только для tailnet-subnet.
5. На сервере обновить env-переменные сервисов (`agents-genkit`, `n8n` и т.д.)
   с `localhost:11434` на `ai-box.borisovai.net:11434` (магическое имя tailnet).
6. Остановить `frpc-ollama-*` сервисы на клиенте, выключить
   `ollama-11434/11435/11436` proxies в frps.
7. Оставить `frpc.exe` с общим `frpc.toml` только для HTTP dev-публикаций.

**Verification:**
- `tailscale status` на обеих сторонах — оба видят друг друга.
- С сервера: `curl http://ai-box.borisovai.net:11434/api/tags` → отдаёт список
  моделей.
- Агенты работают, в логах нет `ECONNREFUSED`.
- Намеренный kill сетевого адаптера на клиенте на 30 секунд → после восстановления
  tailnet сам починится без ручных действий (проверить `tailscale ping`
  перед/после).

**Метрики успеха (этап 2):**
- Ollama API-доступность с сервера ≥99.9% за неделю.
- MTTR при разрыве сети на клиенте ≤10 секунд (DERP relay fallback).
- 0 manual интервенций в туннель за месяц.

**Время работы:** 1–2 дня (установка headscale, OIDC-интеграция с Authelia,
миграция ENV-переменных сервисов, тестирование).

**Риски и их mitigation:**
- *Tailscale MSI может требовать административных прав на клиенте* — это
  проверяется при первой установке, дальше service работает без интерактива.
- *Headscale требует рабочего DERP* — по умолчанию Tailscale-клиенты используют
  public DERP-ноды Tailscale даже на Headscale. Для полной self-hosted —
  поднять свой `derper`, опционально.
- *Если сервисы на сервере жёстко ссылаются на `localhost:11434`* — нужен
  аудит env-переменных. Сделать в виде alias через hosts-файл или через
  переконфигурирование сервисов разом.

---

## Что остаётся на frp после обоих этапов

HTTP dev-туннели `*.tunnel.borisovai.ru/.tech` — остаются в frp. Обоснование:
- Домены нужны для публичного ингресса (нельзя mesh).
- Они работают через Traefik vhost → это именно та задача, для которой frp
  оптимизирован.
- Короткие разрывы браузер переживает автоматически retry-ем.
- Vhost-роутинг (subdomain → port) у frp удобнее, чем ручное конфигурирование
  Traefik-роутов для каждого проекта.

После этапа 2 frp упрощается: только `frpc.toml` с HTTP-проксями, без Ollama-TCP.

---

## Последовательность действий

### Сейчас (этап 1)

- [ ] Правка [`scripts/single-machine/install-frps.sh`](../../scripts/single-machine/install-frps.sh): добавить `kcpBindPort` и `ufw allow 17420/udp`.
- [ ] Правка всех `config/frpc-template/*.toml`: добавить `transport.protocol = "kcp"` + heartbeat.
- [ ] Правка [`scripts/frpc/setup-frpc-ollama.ps1`](../../scripts/frpc/setup-frpc-ollama.ps1), `setup-frpc-ollama-tier.ps1`: те же поля в генерируемых конфигах.
- [ ] Commit + push → CI `deploy:frps` (manual).
- [ ] Обновить все Windows-клиенты: rerun PS1-скриптов или ручное редактирование `C:\tools\frp\*.toml`.
- [ ] Мониторинг 1 неделя: журнал `journalctl -u frps`, количество reconnect'ов, MTTR.

### Если этап 1 недостаточен (этап 2)

- [ ] Открыть [`PLAN_VPN_HEADSCALE.md`](PLAN_VPN_HEADSCALE.md), выполнить план.
- [ ] Адаптировать: фокус только на Ollama-туннелях, не на всех сервисах.
- [ ] Миграция ENV-переменных сервисов через Management UI
      (`/etc/management-ui/config.json` для agents, gitlab CI variables для n8n и т.д.).
- [ ] Выключить `frpc-ollama-*` сервисы на клиенте (не удалять, чтобы можно
      было откатиться): `sc.exe config frpc-ollama-tier start= disabled`.
- [ ] Удалить Ollama-прокси из `frps.toml`.
- [ ] Мониторинг 1 неделя: Ollama API uptime с сервера.

### Критерии «этап 2 не нужен»

Если в течение **двух недель** после этапа 1:
- средний MTTR Ollama-туннеля ≤ 10 секунд,
- нет разрывов дольше 60 секунд,
- нет случаев, когда агент на сервере падает из-за недоступности Ollama,

— этап 2 **не запускаем**. Фиксируем этап 1 как достаточное решение и
возвращаемся к нему только при регрессии.

---

## Обновления в документации/коде при завершении

После успешного этапа 1:
- Обновить [`docs/plans/RESEARCH_TUNNELING.md`](RESEARCH_TUNNELING.md) —
  добавить секцию «Применённое решение: frp + KCP».
- Обновить `CLAUDE.md` раздел «frp Tunneling» — указать `transport.protocol = "kcp"`
  как дефолт и что клиенты используют IP.

После этапа 2 (если запустится):
- Обновить диаграммы в `AGENT_SERVICES.md` и `AGENT_FULL_GUIDE.md`.
- Архивировать `frpc-ollama-*.toml` шаблоны (не удалять — для rollback).

---

## Критические файлы

- [`scripts/single-machine/install-frps.sh`](../../scripts/single-machine/install-frps.sh) — генерация серверного `frps.toml` + UFW.
- [`config/frpc-template/`](../../config/frpc-template/) — 5 шаблонов клиентских конфигов.
- [`scripts/frpc/`](../../scripts/frpc/) — PowerShell setup для Windows.
- [`docs/plans/PLAN_VPN_HEADSCALE.md`](PLAN_VPN_HEADSCALE.md) — полный план
  headscale (используется при переходе на этап 2).
- [`docs/plans/RESEARCH_TUNNELING.md`](RESEARCH_TUNNELING.md) — исторический
  анализ альтернатив (frp, sish, rathole, Pangolin, Headscale и др.).

## Связанные документы

- [CLAUDE.md](../../CLAUDE.md) — раздел «frp Tunneling».
- [AGENT_FULL_GUIDE.md](../agents/AGENT_FULL_GUIDE.md) — обзор инфраструктуры.
