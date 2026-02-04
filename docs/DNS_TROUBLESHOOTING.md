# Устранение проблем DNS в сети

Краткие шаги, если в сети появляются ошибки DNS (сайт не открывается, «не удаётся найти адрес», неверный IP).

**Если сайт открывается в одной сети, но не в другой** (таймаут, обрыв загрузки) — см. также [docs/site-not-accessible-some-networks.md](docs/site-not-accessible-some-networks.md) (Path MTU и DNS).

---

## 1. На вашем ПК (Windows)

### Очистить кэш DNS

В PowerShell **от имени администратора**:

```powershell
Clear-DnsClientCache
```

Или в cmd:

```cmd
ipconfig /flushdns
```

### Проверить, какой DNS использует система

```powershell
Get-DnsClientServerAddress -AddressFamily IPv4 | Where-Object { $_.ServerAddresses }
```

Если используется нестабильный или блокирующий DNS (провайдер, AdGuard и т.п.), смените на:

- **Яндекс:** 77.88.8.8, 77.88.8.1  
- **Google:** 8.8.8.8, 8.8.4.4  
- **Cloudflare:** 1.1.1.1, 1.0.0.1  

Смена DNS: Параметры → Сеть и Интернет → Ethernet/Wi‑Fi → свой адаптер → Изменить параметры адаптера → Свойства → «IP версии 4» → Указать предпочитаемый/альтернативный DNS.

### Временно подменить адрес (обход)

Файл `C:\Windows\System32\drivers\etc\hosts` (открыть от имени администратора), добавить (IP замените на ваш сервер):

```
144.91.108.139    dev.borisovai.ru
144.91.108.139    borisovai.tech www.borisovai.tech
```

Сохранить и снова попробовать открыть сайт.

---

## 2. На сервере (где развёрнут проект)

Подключиться по SSH и выполнить проверки ниже.

### Конфликт порта 53 (systemd-resolved и dnsmasq)

Частая причина: `systemd-resolved` слушает 127.0.0.53:53, из‑за этого dnsmasq не может занять порт 53.

Проверка:

```bash
sudo ss -tulnp | grep :53
```

Если видите `systemd-resolved` на 53:

```bash
# Отключить stub listener (универсально: с решёткой и без)
sudo sed -i 's/^#*DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf
grep -q 'DNSStubListener' /etc/systemd/resolved.conf || echo "DNSStubListener=no" | sudo tee -a /etc/systemd/resolved.conf
sudo systemctl restart systemd-resolved
```

После этого перезапустить dnsmasq:

```bash
sudo systemctl restart dnsmasq
sudo ss -tulnp | grep :53
```

Должен слушать только dnsmasq (или ваш DNS‑сервер).

**Важно:** после отключения stub файл `/etc/resolv.conf` может по-прежнему указывать на `127.0.0.53`, который больше не отвечает — тогда DNS на самом сервере перестанет работать. Убедитесь, что dnsmasq запущен, и при необходимости пропишите в resolv.conf `nameserver 127.0.0.1` (или внешний DNS, например `8.8.8.8`). Проверка: `cat /etc/resolv.conf`.

### Проверить и перезапустить dnsmasq

```bash
sudo systemctl status dnsmasq
sudo systemctl restart dnsmasq
```

Обновить записи из DNS API (если используется локальный DNS API):

```bash
sudo /root/install/scripts/dns-api/update-dnsmasq.sh
# или из директории скриптов:
# sudo ./scripts/dns-api/update-dnsmasq.sh
```

### Проверить Local DNS API (порт 5353)

```bash
sudo systemctl status local-dns-api
sudo systemctl restart local-dns-api
curl -s http://127.0.0.1:5353/api/health || echo "API не отвечает"
```

### Проверить /etc/resolv.conf на сервере

```bash
cat /etc/resolv.conf
```

Для работы локального dnsmasq на этом же сервере обычно достаточно:

- `nameserver 127.0.0.1`  
или  
- `nameserver 8.8.8.8` (если dnsmasq не используется как основной DNS на сервере).

---

## 3. В локальной сети (клиенты не резолвят dev.borisovai.ru)

- Если **DNS раздаёт сервер** (dnsmasq на нём): на роутере или на клиентах в настройках IPv4 укажите **DNS‑сервер = IP вашего сервера** (где запущен dnsmasq).
- Если **DNS не на сервере**: клиенты должны использовать стабильный публичный DNS (77.88.8.8, 8.8.8.8 и т.д.). Запись `dev.borisovai.ru` при этом берётся из интернета (с NS ihc.ru), а не из локального dnsmasq.

---

## 4. Проверка разрешения имени

С вашего ПК:

```powershell
Resolve-DnsName dev.borisovai.ru -Server 8.8.8.8
Resolve-DnsName borisovai.tech -Server 8.8.8.8
Resolve-DnsName borisovai.tech -Server 77.88.8.8
```

Ожидаемый IP для dev.borisovai.ru и borisovai.tech (если на одном сервере): **144.91.108.139**. Если другой IP — возможен кэш у провайдера или DNS; подождать или использовать другой DNS / hosts (см. выше).

---

## Быстрый чек-лист

| Где        | Действие |
|-----------|----------|
| Windows   | `Clear-DnsClientCache` или `ipconfig /flushdns` |
| Windows   | При необходимости сменить DNS на 77.88.8.8 или 8.8.8.8 |
| Сервер    | Отключить `DNSStubListener` в systemd-resolved, перезапустить dnsmasq |
| Сервер    | Запустить `update-dnsmasq.sh`, проверить `local-dns-api` |
| Сеть      | Убедиться, что клиенты используют нужный DNS (сервер или 77.88.8.8) |
