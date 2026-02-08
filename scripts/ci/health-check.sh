#!/bin/bash
# Пост-деплой проверка здоровья сервисов
set -e

echo "=== Health Check ==="

ERRORS=0

# Management UI
echo -n "Management UI (порт 3000)... "
if curl -sf --max-time 5 http://127.0.0.1:3000/api/auth/check > /dev/null 2>&1; then
    echo "OK"
else
    echo "ОШИБКА"
    ERRORS=$((ERRORS + 1))
fi

# DNS API (опционально)
if systemctl is-active --quiet dns-api 2>/dev/null; then
    echo -n "DNS API (порт 5353)... "
    if curl -sf --max-time 5 http://127.0.0.1:5353/api/records > /dev/null 2>&1; then
        echo "OK"
    else
        echo "ПРЕДУПРЕЖДЕНИЕ (опционально)"
    fi
else
    echo "DNS API — сервис не запущен (пропуск)"
fi

# Authelia (опционально)
if systemctl is-active --quiet authelia 2>/dev/null; then
    echo -n "Authelia (порт 9091)... "
    if curl -sf --max-time 5 http://127.0.0.1:9091/api/health > /dev/null 2>&1; then
        echo "OK"
    else
        echo "ПРЕДУПРЕЖДЕНИЕ"
    fi
else
    echo "Authelia — не установлена (пропуск)"
fi

# Traefik
echo -n "Traefik (порт 8080)... "
if curl -sf --max-time 5 http://127.0.0.1:8080/api/rawdata > /dev/null 2>&1; then
    echo "OK"
else
    echo "ПРЕДУПРЕЖДЕНИЕ"
fi

echo ""
if [ "$ERRORS" -gt 0 ]; then
    echo "Health check FAILED ($ERRORS ошибок)"
    exit 1
fi

echo "Health check PASSED"
