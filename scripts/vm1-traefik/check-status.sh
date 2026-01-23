#!/bin/bash
# Скрипт проверки статуса всех сервисов
# Использование: ./check-status.sh

echo "=== Проверка статуса сервисов ==="
echo ""

# Проверка Traefik
echo "Traefik:"
if systemctl is-active --quiet traefik; then
    echo "  ✓ Запущен"
    systemctl status traefik --no-pager -l | head -3
else
    echo "  ✗ Не запущен"
fi
echo ""

# Проверка веб-интерфейса
echo "Веб-интерфейс управления:"
if systemctl is-active --quiet management-ui; then
    echo "  ✓ Запущен"
    systemctl status management-ui --no-pager -l | head -3
else
    echo "  ✗ Не запущен"
fi
echo ""

# Проверка DNS API
echo "DNS API:"
if [ -f "/etc/dns-api/config.json" ]; then
    echo "  ✓ Конфигурация найдена"
    if manage-dns test 2>/dev/null; then
        echo "  ✓ Подключение к API работает"
    else
        echo "  ✗ Ошибка подключения к API"
    fi
else
    echo "  ✗ Конфигурация не найдена"
fi
echo ""

# Проверка конфигураций Traefik
echo "Конфигурации Traefik:"
DYNAMIC_DIR="/etc/traefik/dynamic"
if [ -d "$DYNAMIC_DIR" ]; then
    CONFIG_COUNT=$(find "$DYNAMIC_DIR" -name "*.yml" | wc -l)
    echo "  Найдено конфигураций: $CONFIG_COUNT"
    echo "  Файлы:"
    ls -1 "$DYNAMIC_DIR"/*.yml 2>/dev/null | sed 's/^/    - /'
else
    echo "  ✗ Директория не найдена"
fi
echo ""

# Проверка сетевых подключений
echo "Сетевые подключения:"
INTERNAL_IP=$(hostname -I | awk '{print $1}')
EXTERNAL_IP=$(curl -s ifconfig.me 2>/dev/null || echo "не определен")
echo "  Внутренний IP: $INTERNAL_IP"
echo "  Внешний IP: $EXTERNAL_IP"
echo ""

# Проверка портов
echo "Открытые порты:"
if command -v netstat &> /dev/null; then
    netstat -tlnp | grep -E ':(80|443|3000|8080)' | awk '{print "  " $4 " -> " $7}' | head -5
elif command -v ss &> /dev/null; then
    ss -tlnp | grep -E ':(80|443|3000|8080)' | awk '{print "  " $4 " -> " $6}' | head -5
fi
echo ""

echo "=== Проверка завершена ==="
