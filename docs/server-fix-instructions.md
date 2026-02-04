# Исправление проблемы Path MTU на сервере mail.dev.borisovai.tech

## Проблема
Большие файлы (vendor.css 1.3MB, vendor.js 587KB) не загружаются из-за Path MTU Discovery Black Hole.

---

## РЕШЕНИЕ ДЛЯ TRAEFIK (проект borisovai-admin)

Если сервер использует **Traefik** как reverse proxy (как в этом репозитории), GZIP сжатие включается через middleware Traefik, а не nginx.

### Применение ко всем сервисам за Traefik

- **TCP MTU Probing** (`net.ipv4.tcp_mtu_probing = 1`) — настройка ядра Linux, действует на **все** исходящие TCP-соединения сервера. Её достаточно задать один раз (скрипт `fix-mtu-issue.sh` это делает); все сервисы за Traefik (GitLab, n8n, веб-интерфейс, Mailu, сайт) уже получают пользу.
- **GZIP (compress)** — в конфигурации Traefik для каждого сервиса добавлен свой compress-middleware:
  - GitLab: `gitlab-compress`
  - n8n: `n8n-compress`
  - Веб-интерфейс управления: `management-ui-compress`
  - Сайт (Next.js): `site-compress`
  - Mailu: `mailu-compress`

При новой установке или после `configure-traefik.sh --force` все эти конфиги создаются/обновляются уже с compress. Для уже существующих конфигов без compress один раз выполните: `sudo ./configure-traefik.sh --force` (из `scripts/single-machine` на сервере), чтобы перегенерировать конфиги с GZIP для всех сервисов.

### Быстрое применение на существующем сервере

Скрипт `scripts/single-machine/fix-mtu-issue.sh` добавляет compress для Mailu, TCP MTU Probing и **принудительно ограничивает TCP MSS для всех исходящих соединений**:

```bash
# На сервере (из директории репозитория или скопируйте скрипт)
sudo ./scripts/single-machine/fix-mtu-issue.sh
```

Без ограничения MSS (только GZIP + tcp_mtu_probing): `sudo ./scripts/single-machine/fix-mtu-issue.sh --no-iptables`

### Что делает скрипт

1. Добавляет middleware `mailu-compress` (GZIP) в `/etc/traefik/dynamic/mailu.yml`, если его ещё нет.
2. Включает `net.ipv4.tcp_mtu_probing = 1` в `/etc/sysctl.conf`.
3. Добавляет правило iptables TCPMSS (MSS 1360) для всех исходящих TCP — меньшие пакеты проходят в «узких» сетях.
4. Перезагружает Traefik.

### Новая установка Mailu

При установке Mailu через `install-mailu.sh` конфигурация Traefik для Mailu уже создаётся с compress middleware. Дополнительные действия не требуются.

### Ручная правка конфигурации Traefik

**Файл:** `/etc/traefik/dynamic/mailu.yml`

Добавьте middleware и подключите его ко всем роутерам Mailu:

```yaml
http:
  middlewares:
    mailu-headers:
      # ... существующие настройки ...
    mailu-compress:
      compress:
        excludedContentTypes:
          - "text/event-stream"

  routers:
    mailu-admin:
      middlewares:
        - mailu-headers
        - mailu-compress
      # ...
    mailu-webmail:
      middlewares:
        - mailu-headers
        - mailu-compress
      # ...
    mailu-catchall:
      middlewares:
        - mailu-headers
        - mailu-compress
      # ...
```

После правки: `systemctl reload traefik`

**Эффект:** vendor.css и vendor.js сжимаются (примерно до 150–200KB и 100–150KB соответственно), загрузка больших файлов восстанавливается.

---

## РЕШЕНИЕ 1: Включить GZIP сжатие (для nginx)
### Если используется nginx напрямую (не Traefik)

**Файл:** `/etc/nginx/nginx.conf` или `/etc/nginx/sites-available/mail.dev.borisovai.tech`

```nginx
http {
    # ... существующие настройки ...
    
    # Включить gzip сжатие
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript 
               application/javascript application/x-javascript 
               application/json application/xml+rss;
    gzip_min_length 1000;
    gzip_disable "msie6";
    
    # Буферизация для больших файлов
    gzip_buffers 16 8k;
    gzip_http_version 1.1;
}
```

**Применение:**
```bash
# Проверить конфигурацию
nginx -t

# Перезагрузить nginx
systemctl reload nginx
# или
service nginx reload
```

**Эффект:** vendor.css уменьшится с 1.3MB до ~150-200KB, vendor.js с 587KB до ~100-150KB

---

## РЕШЕНИЕ 2: Настройка TCP MSS на сервере

**Вариант A: Через iptables (универсально)**

```bash
# Проверить текущие правила
iptables -t mangle -L -n -v

# Добавить TCP MSS clamping
iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1360

# Сохранить правила
iptables-save > /etc/iptables/rules.v4
# или для Ubuntu/Debian
netfilter-persistent save
```

**Вариант B: Через nginx (если поддерживается)**

```nginx
server {
    listen 443 ssl http2;
    server_name mail.dev.borisovai.tech;
    
    # Установить TCP MSS
    tcp_nodelay on;
    tcp_nopush on;
    
    # ... остальные настройки ...
}
```

---

## РЕШЕНИЕ 3: Изменить MTU на сетевом интерфейсе сервера

```bash
# Проверить текущий MTU
ip link show

# Временно изменить MTU (для тестирования)
ip link set dev eth0 mtu 1420

# Постоянное изменение (для Ubuntu/Debian)
# Редактировать /etc/netplan/50-cloud-init.yaml
```

**Файл:** `/etc/netplan/50-cloud-init.yaml`
```yaml
network:
  version: 2
  ethernets:
    eth0:
      dhcp4: true
      mtu: 1420
```

```bash
# Применить
netplan apply
```

**Для CentOS/RHEL:**

**Файл:** `/etc/sysconfig/network-scripts/ifcfg-eth0`
```
MTU=1420
```

```bash
# Перезапустить сеть
systemctl restart network
```

---

## РЕШЕНИЕ 4: Разрешить ICMP Fragmentation Needed

```bash
# Проверить, что ICMP не блокируется
iptables -L INPUT -n -v | grep icmp

# Если ICMP блокируется, добавить правило
iptables -I INPUT -p icmp --icmp-type fragmentation-needed -j ACCEPT
iptables -I OUTPUT -p icmp --icmp-type fragmentation-needed -j ACCEPT

# Сохранить
netfilter-persistent save
```

---

## РЕШЕНИЕ 5: Настройка TCP параметров ядра Linux

**Файл:** `/etc/sysctl.conf`

```bash
# Включить Path MTU Discovery
net.ipv4.ip_no_pmtu_disc = 0

# Включить TCP MTU Probing (автоматическое определение)
net.ipv4.tcp_mtu_probing = 1

# Базовый MSS для TCP MTU probing
net.ipv4.tcp_base_mss = 1024

# Увеличить размер TCP буферов
net.ipv4.tcp_rmem = 4096 87380 6291456
net.ipv4.tcp_wmem = 4096 65536 6291456

# Включить window scaling
net.ipv4.tcp_window_scaling = 1
```

**Применение:**
```bash
sysctl -p
```

---

## КОМПЛЕКСНАЯ КОНФИГУРАЦИЯ NGINX (РЕКОМЕНДУЕТСЯ)

**Файл:** `/etc/nginx/sites-available/mail.dev.borisovai.tech`

```nginx
server {
    listen 443 ssl http2;
    server_name mail.dev.borisovai.tech;
    
    # SSL настройки
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    # GZIP сжатие
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript 
               application/javascript application/x-javascript 
               application/json application/xml+rss;
    gzip_min_length 1000;
    
    # TCP оптимизация
    tcp_nodelay on;
    tcp_nopush on;
    
    # Буферизация
    proxy_buffering on;
    proxy_buffer_size 4k;
    proxy_buffers 8 4k;
    proxy_busy_buffers_size 8k;
    
    # Кэширование статики
    location ~* \.(css|js|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf)$ {
        expires 1y;
        add_header Cache-Control "public, immutable";
        access_log off;
        
        # Включить gzip для статики
        gzip_static on;
    }
    
    # Остальные location блоки
    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## ПРОВЕРКА ПОСЛЕ НАСТРОЙКИ

### 1. Проверить GZIP сжатие:
```bash
curl -I -H "Accept-Encoding: gzip" https://mail.dev.borisovai.tech/static/vendor.css
# Должен быть заголовок: Content-Encoding: gzip
```

### 2. Проверить размер сжатого файла:
```bash
curl -H "Accept-Encoding: gzip" https://mail.dev.borisovai.tech/static/vendor.css | wc -c
```

### 3. Проверить MTU на сервере:
```bash
ip link show eth0
```

### 4. Проверить TCP MSS:
```bash
iptables -t mangle -L -n -v | grep TCPMSS
```

### 5. Мониторинг в реальном времени:
```bash
# Смотреть логи nginx
tail -f /var/log/nginx/access.log

# Мониторинг сетевых пакетов
tcpdump -i eth0 'tcp port 443' -nn -c 100
```

---

## ПРИОРИТЕТ РЕШЕНИЙ

1. **GZIP сжатие** - ОБЯЗАТЕЛЬНО, решит проблему сразу
2. **tcp_mtu_probing = 1** в sysctl - автоматическое определение MTU
3. **TCP MSS clamping** через iptables - если первые два не помогли
4. **Изменение MTU интерфейса** - крайний случай

---

## КОМАНДЫ ДЛЯ БЫСТРОГО ПРИМЕНЕНИЯ

### Для Traefik (проект borisovai-admin)

```bash
# Одной командой: compress + TCP MTU Probing + перезагрузка Traefik
sudo ./scripts/single-machine/fix-mtu-issue.sh

# Проверить результат
curl -I -H "Accept-Encoding: gzip" https://mail.dev.borisovai.tech/static/vendor.css
```

### Для nginx

```bash
# 1. Бэкап конфигурации
cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.backup

# 2. Включить GZIP (добавить в /etc/nginx/nginx.conf)
cat << 'EOF' >> /etc/nginx/nginx.conf

# GZIP Configuration
gzip on;
gzip_vary on;
gzip_proxied any;
gzip_comp_level 6;
gzip_types text/plain text/css text/xml text/javascript application/javascript application/json;
gzip_min_length 1000;
EOF

# 3. Включить TCP MTU Probing
echo "net.ipv4.tcp_mtu_probing = 1" >> /etc/sysctl.conf
sysctl -p

# 4. Проверить и перезагрузить nginx
nginx -t && systemctl reload nginx

# 5. Проверить результат
curl -I -H "Accept-Encoding: gzip" https://mail.dev.borisovai.tech/static/vendor.css
```
