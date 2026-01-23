# Инструкция по установке GitLab, Traefik и системы управления

## Обзор

Этот проект содержит скрипты для установки и настройки:
- **GitLab CE** на отдельной VM (VM 2)
- **Traefik** как входящего прокси-сервера на отдельной VM (VM 1)
- **Веб-интерфейс управления** для добавления новых сервисов
- **DNS API интеграция** для автоматического управления поддоменами
- **Let's Encrypt** для автоматических SSL сертификатов

## Архитектура

**Для одной физической машины:**

```
Физическая машина (Proxmox)
├── VM 1 (Traefik) - 192.168.1.101/24
│   ├── Traefik (порты 80/443) - внешний доступ
│   ├── Веб-интерфейс управления
│   ├── DNS API клиент
│   └── Let's Encrypt
└── VM 2 (GitLab) - 192.168.1.102/24
    └── GitLab CE (порт 80) - доступен только из локальной сети
    
Все VM в одной подсети, используют один мост vmbr0
Traefik проксирует запросы к GitLab по локальному IP
```

## Требования

### VM 1 (Traefik)
- **ОС**: Debian 11/12 или Ubuntu 20.04/22.04
- **RAM**: минимум 2GB (рекомендуется 4GB)
- **CPU**: минимум 2 ядра
- **Диск**: минимум 20GB
- **Сеть**: внешний IP адрес, доступ к портам 80 и 443

### VM 2 (GitLab)
- **ОС**: Debian 11/12 или Ubuntu 20.04/22.04
- **RAM**: минимум 4GB (рекомендуется 8GB)
- **CPU**: минимум 4 ядра
- **Диск**: минимум 50GB (рекомендуется 100GB)
- **Сеть**: внутренний IP адрес, доступен из VM 1

### Дополнительно
- Домен с возможностью управления DNS через API (Cloudflare, DigitalOcean)
- Email для Let's Encrypt сертификатов

## Порядок установки

### Шаг 0: Настройка Proxmox VE 7

**ВАЖНО**: Перед установкой сервисов необходимо настроить Proxmox.

См. подробную инструкцию: [PROXMOX_SETUP.md](PROXMOX_SETUP.md)

Кратко (для одной физической машины):
1. Установите Proxmox VE 7 на сервер
2. Настройте сеть (один мост `vmbr0` - достаточно для одной физической машины)
3. Создайте две VM:
   - VM 1 (Traefik): 2GB RAM, 2 CPU, 20GB диск
   - VM 2 (GitLab): 4GB RAM, 4 CPU, 50GB диск
4. Установите Debian/Ubuntu на обе VM
5. Настройте сеть на VM в одной подсети (например, `192.168.1.101` и `192.168.1.102`)
6. Запишите IP адреса обеих VM

### Шаг 1: Подготовка виртуальных машин

#### Проверка сетевой связности

**Для одной физической машины** - обе VM должны быть в одной подсети:

На VM 1 выполните:
```bash
# Проверка IP адреса
ip addr show

# Проверка связи с VM 2
ping <IP_VM2>  # например, ping 192.168.1.102

# Проверка связи с Proxmox
ping <IP_PROXMOX>  # например, ping 192.168.1.100
```

На VM 2 выполните:
```bash
# Проверка IP адреса
ip addr show

# Проверка связи с VM 1
ping <IP_VM1>  # например, ping 192.168.1.101

# Проверка связи с Proxmox
ping <IP_PROXMOX>  # например, ping 192.168.1.100
```

**Важно**: Если ping не работает, проверьте:
- Что обе VM в одной подсети
- Что firewall не блокирует ICMP
- Настройки сети в Proxmox

### Шаг 2: Установка GitLab на VM 2

1. Подключитесь к VM 2 по SSH

2. Загрузите скрипт установки:
```bash
# Скопируйте файл scripts/vm2-gitlab/install-gitlab.sh на сервер
# Или создайте его вручную
```

3. Сделайте скрипт исполняемым:
```bash
chmod +x install-gitlab.sh
```

4. Запустите установку:
```bash
sudo ./install-gitlab.sh
```

Скрипт запросит:
- Внутренний IP адрес Traefik VM (VM 1)
- Домен для GitLab (например, `gitlab.example.com`)

5. После установки:
   - Сохраните начальный пароль root (отображается в конце установки)
   - Проверьте доступность GitLab:
     ```bash
     curl http://<INTERNAL_IP_VM2>
     ```

### Шаг 3: Установка Traefik на VM 1

1. Подключитесь к VM 1 по SSH

2. Загрузите скрипт установки:
```bash
# Скопируйте файл scripts/vm1-traefik/install-traefik.sh на сервер
```

3. Сделайте скрипт исполняемым:
```bash
chmod +x install-traefik.sh
```

4. Запустите установку:
```bash
sudo ./install-traefik.sh
```

Скрипт запросит:
- IP адрес GitLab VM (VM 2) - например, `192.168.1.102` (для одной физической машины это IP в той же подсети)
- Домен для GitLab
- Email для Let's Encrypt

5. После установки:
   - Проверьте статус Traefik:
     ```bash
     systemctl status traefik
     ```
   - Проверьте доступность GitLab через домен:
     ```bash
     curl -I https://gitlab.example.com
     ```

### Шаг 4: Настройка DNS API

1. На VM 1 запустите скрипт настройки DNS API:
```bash
sudo ./setup-dns-api.sh
```

2. Выберите провайдера (Cloudflare или DigitalOcean)

3. Введите необходимые данные:
   - **Cloudflare**: API Token, Zone ID, домен
   - **DigitalOcean**: API Token, домен

4. Проверьте подключение:
```bash
manage-dns test
```

### Шаг 5: Установка веб-интерфейса управления

1. На VM 1 скопируйте директорию `management-ui` в `/opt/management-ui`

2. Запустите скрипт установки:
```bash
sudo ./install-management-ui.sh
```

3. Настройте Traefik для проксирования веб-интерфейса:
```bash
# Создайте конфигурацию для веб-интерфейса
sudo nano /etc/traefik/dynamic/management-ui.yml
```

Добавьте:
```yaml
http:
  routers:
    management-ui:
      rule: "Host(`manage.example.com`)"
      service: management-ui
      entryPoints:
        - websecure
      tls:
        certResolver: letsencrypt

  services:
    management-ui:
      loadBalancer:
        servers:
          - url: "http://localhost:3000"
```

4. Создайте DNS запись для веб-интерфейса:
```bash
manage-dns create manage <EXTERNAL_IP>
```

5. Перезагрузите Traefik:
```bash
sudo systemctl reload traefik
```

6. Откройте веб-интерфейс в браузере:
```
https://manage.example.com
```

## Использование

### Добавление нового сервиса через веб-интерфейс

1. Откройте веб-интерфейс управления
2. Нажмите "Добавить сервис"
3. Заполните форму:
   - Имя сервиса
   - Внутренний IP адрес
   - Порт
   - Домен (опционально)
4. Нажмите "Создать"

Сервис будет автоматически:
- Добавлен в DNS
- Настроен в Traefik
- Получит SSL сертификат от Let's Encrypt

### Добавление сервиса через командную строку

```bash
sudo ./deploy-service.sh <service-name> <internal-ip> <port> [domain]
```

Пример:
```bash
sudo ./deploy-service.sh app1 192.168.1.100 8080
```

### Управление DNS записями

```bash
# Создать DNS запись
manage-dns create <subdomain> <ip>

# Удалить DNS запись
manage-dns delete <subdomain>

# Проверить подключение к API
manage-dns test
```

## Проверка и диагностика

### Проверка статуса сервисов

```bash
# Traefik
systemctl status traefik
journalctl -u traefik -f

# GitLab
systemctl status gitlab-runsvdir
gitlab-ctl status

# Веб-интерфейс управления
systemctl status management-ui
journalctl -u management-ui -f
```

### Проверка конфигурации Traefik

```bash
# Просмотр конфигурации
traefik version
cat /etc/traefik/traefik.yml

# Просмотр динамических конфигураций
ls -la /etc/traefik/dynamic/
```

### Проверка SSL сертификатов

```bash
# Просмотр сертификатов
ls -la /var/lib/traefik/acme/

# Проверка сертификата через браузер
# Откройте https://your-domain.com и проверьте сертификат
```

## Решение проблем

### GitLab недоступен через Traefik

1. Проверьте доступность GitLab по внутреннему IP:
   ```bash
   curl http://<GITLAB_IP>
   ```

2. Проверьте конфигурацию Traefik:
   ```bash
   cat /etc/traefik/dynamic/gitlab.yml
   ```

3. Проверьте логи Traefik:
   ```bash
   journalctl -u traefik -n 100
   ```

### SSL сертификат не получается

1. Проверьте доступность домена извне:
   ```bash
   curl -I http://your-domain.com
   ```

2. Проверьте права доступа к файлу acme.json:
   ```bash
   ls -la /var/lib/traefik/acme/acme.json
   ```

3. Проверьте логи Traefik на ошибки Let's Encrypt

### DNS записи не создаются

1. Проверьте конфигурацию DNS API:
   ```bash
   cat /etc/dns-api/config.json
   ```

2. Проверьте подключение к API:
   ```bash
   manage-dns test
   ```

3. Проверьте права доступа к конфигурации:
   ```bash
   ls -la /etc/dns-api/config.json
   ```

## Безопасность

### Рекомендации

1. **Firewall**: Настройте UFW на обеих VM
   ```bash
   # VM 1: открыть только 80, 443
   # VM 2: открыть только 80 для внутренней сети
   ```

2. **Traefik Dashboard**: Ограничьте доступ к dashboard
   - Используйте базовую аутентификацию
   - Или ограничьте доступ по IP

3. **API ключи**: Храните API ключи в безопасном месте
   - Не коммитьте в git
   - Используйте переменные окружения

4. **Регулярные обновления**:
   ```bash
   apt update && apt upgrade -y
   ```

## Поддержка

При возникновении проблем:
1. Проверьте логи сервисов
2. Проверьте конфигурационные файлы
3. Убедитесь в правильности сетевых настроек
4. Проверьте доступность всех компонентов
