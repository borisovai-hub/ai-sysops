# Быстрое руководство по установке

**Для одной физической машины**: Все VM находятся в одной подсети (например, `192.168.1.0/24`). Используйте один мост `vmbr0` в Proxmox.

## Минимальные шаги для запуска

### 1. VM 2 (GitLab) - 5 минут

```bash
# Подключитесь к VM 2
ssh root@<VM2_IP>

# Загрузите и запустите скрипт
chmod +x install-gitlab.sh
sudo ./install-gitlab.sh
# Введите: IP Traefik VM, домен для GitLab

# Сохраните начальный пароль root!
```

### 2. VM 1 (Traefik) - 10 минут

```bash
# Подключитесь к VM 1
ssh root@<VM1_IP>

# Установка Traefik
chmod +x install-traefik.sh
sudo ./install-traefik.sh
# Введите: IP GitLab VM, домен GitLab, email

# Настройка DNS API
chmod +x setup-dns-api.sh
sudo ./setup-dns-api.sh
# Выберите провайдера и введите данные

# Установка веб-интерфейса
chmod +x install-management-ui.sh
sudo ./install-management-ui.sh

# Настройка Traefik для веб-интерфейса
chmod +x setup-management-ui-traefik.sh
sudo ./setup-management-ui-traefik.sh
# Введите домен для веб-интерфейса
```

### 3. Проверка - 2 минуты

```bash
# На VM 1
./check-status.sh

# Проверьте в браузере:
# - https://gitlab.example.com
# - https://manage.example.com
```

## Добавление нового сервиса

### Через веб-интерфейс:
1. Откройте https://manage.example.com
2. Нажмите "Добавить сервис"
3. Заполните форму
4. Готово!

### Через командную строку:
```bash
sudo ./deploy-service.sh app1 192.168.1.100 8080
```

## Полезные команды

```bash
# Статус сервисов
systemctl status traefik
systemctl status management-ui
gitlab-ctl status

# Логи
journalctl -u traefik -f
journalctl -u management-ui -f

# Управление DNS
manage-dns create subdomain 1.2.3.4
manage-dns delete subdomain
manage-dns test
```

## Решение проблем

### GitLab не доступен
```bash
# Проверьте на VM 2
curl http://localhost
gitlab-ctl status

# Проверьте на VM 1
curl http://<GITLAB_IP>
```

### SSL не работает
```bash
# Проверьте логи Traefik
journalctl -u traefik | grep -i acme

# Проверьте права
ls -la /var/lib/traefik/acme/acme.json
```

### DNS не создается
```bash
# Проверьте API
manage-dns test

# Проверьте конфигурацию
cat /etc/dns-api/config.json
```
