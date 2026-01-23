# Установка всех инструментов на одну машину

Комплексная установка GitLab, Traefik, n8n и веб-интерфейса управления на одной физической машине.

## Что устанавливается

- **Traefik** - reverse proxy с автоматическим SSL
- **GitLab CE** - полнофункциональный Git сервер
- **n8n** - автоматизация workflow
- **Веб-интерфейс управления** - управление сервисами
- **DNS API интеграция** - автоматическое управление поддоменами
- **Let's Encrypt** - автоматические SSL сертификаты

## Системные требования

- **ОС**: Debian 11/12 или Ubuntu 20.04/22.04
- **RAM**: минимум 8GB (рекомендуется 16GB+)
- **CPU**: минимум 4 ядра (рекомендуется 8+)
- **Диск**: минимум 100GB (рекомендуется 200GB+)
- **Сеть**: внешний IP адрес, доступ к портам 80 и 443

## Быстрый старт

### 1. Загрузка скриптов на сервер

**Windows (BAT файл):**
```cmd
upload-single-machine.bat
```

**Windows (PowerShell):**
```powershell
.\scripts\upload-single-machine.ps1
```

**Linux/Mac:**
```bash
chmod +x scripts/upload-single-machine.sh
./scripts/upload-single-machine.sh
```

### 2. Установка на сервере

```bash
# Подключитесь к серверу
ssh root@<SERVER_IP>

# Перейдите в директорию со скриптами
cd ~/install/scripts/single-machine

# Сделайте скрипты исполняемыми
chmod +x *.sh

# Запустите установку (можно запускать из любой директории)
sudo ./install-all.sh

# Или запустите из другой директории (скрипты определят свое расположение автоматически)
cd /tmp
sudo ~/install/scripts/single-machine/install-all.sh
```

Скрипт запросит:
- Домены для всех сервисов (GitLab, n8n, веб-интерфейс)
- Email для Let's Encrypt
- Настройку DNS API (опционально)

### 3. После установки

Сервисы будут доступны по адресам:
- **GitLab**: https://gitlab.example.com
- **n8n**: https://n8n.example.com
- **Веб-интерфейс**: https://manage.example.com
- **Traefik Dashboard**: http://localhost:8080

## Архитектура

```
Одна физическая машина
├── Traefik (порты 80/443)
│   ├── Проксирование GitLab (localhost:80)
│   ├── Проксирование n8n (localhost:5678)
│   ├── Проксирование веб-интерфейса (localhost:3000)
│   └── Автоматический SSL (Let's Encrypt)
├── GitLab CE (localhost:80)
├── n8n (localhost:5678)
└── Веб-интерфейс управления (localhost:3000)
```

## Порядок установки

Скрипт `install-all.sh` автоматически выполняет:

1. Проверку системных требований
2. Обновление системы
3. Установку базовых пакетов
4. Настройку firewall
5. Установку Traefik
6. Настройку DNS API (если выбрано)
7. Установку GitLab
8. Установку n8n
9. Установку веб-интерфейса
10. Конфигурацию Traefik для всех сервисов

## Важная информация

### Начальный пароль GitLab

После установки GitLab сохраните начальный пароль root:
```bash
cat /etc/gitlab/initial_root_password
```

### Пароль n8n

По умолчанию:
- **Пользователь**: `admin`
- **Пароль**: `changeme`

**ВАЖНО**: Измените пароль после установки!

Редактируйте `/etc/systemd/system/n8n.service`:
```bash
# Измените строку:
Environment="N8N_BASIC_AUTH_PASSWORD=changeme"

# Затем:
systemctl daemon-reload
systemctl restart n8n
```

### SSL сертификаты

SSL сертификаты будут получены автоматически через Let's Encrypt в течение нескольких минут после установки.

Убедитесь, что:
- DNS записи для всех доменов настроены
- Порты 80 и 443 доступны извне
- Домены указывают на IP адрес сервера

## Управление сервисами

### Проверка статуса

```bash
systemctl status traefik
systemctl status gitlab-runsvdir
systemctl status n8n
systemctl status management-ui
```

### Просмотр логов

```bash
# Traefik
journalctl -u traefik -f

# GitLab
gitlab-ctl tail

# n8n
journalctl -u n8n -f

# Веб-интерфейс
journalctl -u management-ui -f
```

### Перезапуск сервисов

```bash
systemctl restart traefik
gitlab-ctl restart
systemctl restart n8n
systemctl restart management-ui
```

## Добавление новых сервисов

### Через веб-интерфейс

1. Откройте https://manage.example.com
2. Нажмите "Добавить сервис"
3. Заполните форму и нажмите "Создать"

### Через командную строку

Используйте скрипт из `scripts/vm1-traefik/deploy-service.sh`:
```bash
sudo ./deploy-service.sh <service-name> 127.0.0.1 <port> [domain]
```

## Решение проблем

### GitLab недоступен

```bash
# Проверьте статус
gitlab-ctl status

# Проверьте доступность на localhost
curl http://127.0.0.1

# Проверьте конфигурацию Traefik
cat /etc/traefik/dynamic/gitlab.yml
```

### n8n недоступен

```bash
# Проверьте статус
systemctl status n8n

# Проверьте доступность на localhost
curl http://127.0.0.1:5678

# Проверьте логи
journalctl -u n8n -n 50
```

### SSL сертификат не получается

```bash
# Проверьте логи Traefik
journalctl -u traefik | grep -i acme

# Проверьте права на файл
ls -la /var/lib/traefik/acme/acme.json

# Проверьте доступность домена
curl -I http://your-domain.com
```

## Безопасность

- Все сервисы работают на localhost
- Внешний доступ только через Traefik
- SSL для всех доменов
- Firewall настроен (открыты только 22, 80, 443)
- Измените пароли по умолчанию!

## Обновление

### Обновление GitLab

```bash
apt update
apt upgrade gitlab-ce
gitlab-ctl reconfigure
```

### Обновление n8n

```bash
npm update -g n8n
systemctl restart n8n
```

### Обновление Traefik

Скачайте новую версию и замените бинарный файл:
```bash
cd /opt/traefik
# Скачайте новую версию
# Замените бинарный файл
systemctl restart traefik
```

## Полезные ссылки

- [GitLab Documentation](https://docs.gitlab.com/)
- [n8n Documentation](https://docs.n8n.io/)
- [Traefik Documentation](https://doc.traefik.io/traefik/)
