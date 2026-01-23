#!/bin/bash
# Скрипт установки и настройки dnsmasq для локальной сети
# Использование: sudo ./install-dnsmasq.sh

set -e

if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

echo "=== Установка и настройка dnsmasq ==="
echo ""

# Установка dnsmasq
echo "[1/4] Установка dnsmasq..."
export DEBIAN_FRONTEND=noninteractive
apt update
apt install -y dnsmasq

# Определение интерфейса для прослушивания
echo ""
echo "[2/4] Настройка dnsmasq..."
read -p "Введите интерфейс для прослушивания (например, eth0, или Enter для всех): " INTERFACE

if [ -z "$INTERFACE" ]; then
    LISTEN_ADDRESS="0.0.0.0"
else
    # Получение IP адреса интерфейса
    INTERFACE_IP=$(ip -4 addr show "$INTERFACE" 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -1 || echo "")
    if [ -z "$INTERFACE_IP" ]; then
        echo "Предупреждение: Не удалось определить IP для интерфейса $INTERFACE"
        LISTEN_ADDRESS="0.0.0.0"
    else
        LISTEN_ADDRESS="$INTERFACE_IP"
    fi
fi

# Резервная копия конфигурации
if [ -f "/etc/dnsmasq.conf" ]; then
    cp /etc/dnsmasq.conf /etc/dnsmasq.conf.backup
fi

# Создание конфигурации dnsmasq
cat > /etc/dnsmasq.conf << EOF
# Основная конфигурация dnsmasq
# Локальные домены загружаются из /etc/dnsmasq.d/local-domains.conf

# Прослушивание на указанном адресе
listen-address=$LISTEN_ADDRESS
listen-address=127.0.0.1

# Не использовать файл /etc/hosts
no-hosts

# Использовать конфигурацию из директории
conf-dir=/etc/dnsmasq.d/,*.conf

# Логирование
log-queries
log-facility=/var/log/dnsmasq.log

# Кэш
cache-size=1000
EOF

# Создание директории для локальных доменов
mkdir -p /etc/dnsmasq.d

# Создание пустого файла конфигурации локальных доменов
if [ ! -f "/etc/dnsmasq.d/local-domains.conf" ]; then
    cat > /etc/dnsmasq.d/local-domains.conf << EOF
# Автоматически генерируется из /etc/dns-api/records.json
# Не редактируйте вручную!
EOF
fi

# Настройка firewall (если используется)
echo ""
echo "[3/4] Настройка firewall..."
if command -v ufw &> /dev/null; then
    ufw allow 53/udp
    ufw allow 53/tcp
    echo "Firewall настроен: порт 53 открыт"
fi

# Запуск dnsmasq
echo ""
echo "[4/4] Запуск dnsmasq..."
systemctl enable dnsmasq
systemctl restart dnsmasq

sleep 2
if systemctl is-active --quiet dnsmasq; then
    echo ""
    echo "=== Установка dnsmasq завершена! ==="
    echo ""
    echo "dnsmasq запущен и слушает на: $LISTEN_ADDRESS:53"
    echo ""
    echo "Конфигурация локальных доменов: /etc/dnsmasq.d/local-domains.conf"
    echo "Логи: /var/log/dnsmasq.log"
    echo ""
    echo "Проверка статуса: systemctl status dnsmasq"
    echo "Просмотр логов: tail -f /var/log/dnsmasq.log"
    echo ""
    echo "ВАЖНО: Настройте клиенты в локальной сети использовать этот сервер как DNS"
    echo "  IP адрес DNS сервера: $LISTEN_ADDRESS"
else
    echo ""
    echo "Ошибка: dnsmasq не запустился"
    echo "Проверьте логи: journalctl -u dnsmasq -n 50"
    exit 1
fi
