#!/bin/bash
# Скрипт установки GitLab CE на VM 2
# Использование: sudo ./install-gitlab.sh

set -e

echo "=== Установка GitLab CE ==="
echo ""

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Проверка системных требований
echo "[1/8] Проверка системных требований..."
TOTAL_RAM=$(free -g | awk '/^Mem:/{print $2}')
TOTAL_CPU=$(nproc)

echo "  RAM: ${TOTAL_RAM}GB (требуется минимум 4GB)"
echo "  CPU: ${TOTAL_CPU} (требуется минимум 4)"

if [ "$TOTAL_RAM" -lt 4 ]; then
    echo "Предупреждение: Рекомендуется минимум 4GB RAM для GitLab"
    read -p "Продолжить? (y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
        exit 1
    fi
fi

# Запрос IP адреса Traefik VM
echo ""
read -p "Введите внутренний IP адрес Traefik VM (VM 1): " TRAEFIK_IP
if [ -z "$TRAEFIK_IP" ]; then
    echo "Ошибка: IP адрес Traefik VM обязателен"
    exit 1
fi

# Запрос домена для GitLab
echo ""
read -p "Введите домен для GitLab (например, gitlab.example.com): " GITLAB_DOMAIN
if [ -z "$GITLAB_DOMAIN" ]; then
    echo "Ошибка: Домен обязателен"
    exit 1
fi

# Определение внутреннего IP этой VM
INTERNAL_IP=$(hostname -I | awk '{print $1}')
echo ""
echo "Внутренний IP этой VM: $INTERNAL_IP"
echo "IP Traefik VM: $TRAEFIK_IP"
echo "Домен GitLab: $GITLAB_DOMAIN"
echo ""
read -p "Продолжить установку? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    exit 1
fi

# Обновление системы
echo ""
echo "[2/8] Обновление системы..."
export DEBIAN_FRONTEND=noninteractive
apt update
apt upgrade -y

# Установка зависимостей
echo ""
echo "[3/8] Установка зависимостей..."
apt install -y curl openssh-server ca-certificates tzdata perl

# Настройка firewall
echo ""
echo "[4/8] Настройка firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 22/tcp
    # Разрешаем доступ только с IP Traefik VM
    ufw allow from $TRAEFIK_IP to any port 80
    # Блокируем доступ извне (для одной физической машины это важно)
    ufw deny 80/tcp
    ufw --force enable
    echo "Firewall настроен: порт 80 доступен только для Traefik VM ($TRAEFIK_IP)"
    echo "Внешний доступ к GitLab заблокирован - доступ только через Traefik"
else
    echo "UFW не установлен, настройте firewall вручную"
    echo "ВАЖНО: Разрешите доступ к порту 80 только с IP $TRAEFIK_IP"
fi

# Добавление репозитория GitLab
echo ""
echo "[5/8] Добавление репозитория GitLab..."
curl -sS https://packages.gitlab.com/install/repositories/gitlab/gitlab-ce/script.deb.sh | bash

# Установка GitLab
echo ""
echo "[6/8] Установка GitLab CE (это может занять несколько минут)..."
apt install -y gitlab-ce

# Настройка GitLab
echo ""
echo "[7/8] Настройка GitLab..."
GITLAB_CONFIG="/etc/gitlab/gitlab.rb"

# Создание резервной копии
cp "$GITLAB_CONFIG" "${GITLAB_CONFIG}.backup"

# Настройка external_url
sed -i "s|external_url 'GENERATED_EXTERNAL_URL'|external_url 'http://${GITLAB_DOMAIN}'|g" "$GITLAB_CONFIG"

# Настройка для работы за прокси
cat >> "$GITLAB_CONFIG" << EOF

# Настройки для работы за reverse proxy (Traefik)
nginx['listen_port'] = 80
nginx['listen_https'] = false
nginx['proxy_set_headers'] = {
  "Host" => "\$http_host",
  "X-Real-IP" => "\$remote_addr",
  "X-Forwarded-For" => "\$proxy_add_x_forwarded_for",
  "X-Forwarded-Proto" => "https",
  "X-Forwarded-Ssl" => "on"
}

# Доверенные прокси
gitlab_rails['trusted_proxies'] = ['$TRAEFIK_IP', '127.0.0.1']

# Отключение встроенного Let's Encrypt (используется Traefik)
letsencrypt['enable'] = false
EOF

# Применение конфигурации
echo "Применение конфигурации GitLab (это может занять несколько минут)..."
gitlab-ctl reconfigure

# Получение начального пароля
echo ""
echo "[8/8] Получение начального пароля root..."
INITIAL_PASSWORD=$(grep 'Password:' /etc/gitlab/initial_root_password 2>/dev/null | cut -d' ' -f2- || echo "Пароль не найден в /etc/gitlab/initial_root_password")

echo ""
echo "=== Установка GitLab завершена! ==="
echo ""
echo "Важная информация:"
echo "  - Домен: http://${GITLAB_DOMAIN}"
echo "  - Внутренний IP: ${INTERNAL_IP}"
echo "  - Порт: 80 (только для внутренней сети)"
echo ""
echo "Начальный пароль root:"
echo "  ${INITIAL_PASSWORD}"
echo ""
echo "ВАЖНО: Сохраните этот пароль! Он понадобится при первом входе."
echo ""
echo "Проверка доступности GitLab:"
echo "  curl http://${INTERNAL_IP}"
echo ""
echo "Следующие шаги:"
echo "  1. Проверьте доступность GitLab по внутреннему IP"
echo "  2. Настройте Traefik на VM 1 для проксирования GitLab"
echo "  3. После настройки Traefik войдите в GitLab через домен ${GITLAB_DOMAIN}"
echo ""
