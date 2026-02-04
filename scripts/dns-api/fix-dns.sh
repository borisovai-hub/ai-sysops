#!/bin/bash
# Быстрое исправление типичных проблем DNS в сети (конфликт порта 53, перезапуск сервисов).
# Использование: sudo ./fix-dns.sh

set -e

if [ "$EUID" -ne 0 ]; then
    echo "Запустите с правами root: sudo ./fix-dns.sh"
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Исправление DNS ==="

# 1. Отключить stub listener systemd-resolved только если установлен dnsmasq (иначе на сервере пропадёт DNS)
DNSMASQ_INSTALLED=false
command -v dnsmasq &>/dev/null && DNSMASQ_INSTALLED=true
systemctl list-unit-files 2>/dev/null | grep -q 'dnsmasq' && DNSMASQ_INSTALLED=true
if [ "$DNSMASQ_INSTALLED" = true ] && systemctl is-active --quiet systemd-resolved 2>/dev/null; then
    if ss -tulnp 2>/dev/null | grep -q '127.0.0.53:53'; then
        echo "[1] systemd-resolved слушает 53, отключаем stub listener..."
        if ! grep -q '^DNSStubListener=no' /etc/systemd/resolved.conf 2>/dev/null; then
            sed -i 's/^#*DNSStubListener=.*/DNSStubListener=no/' /etc/systemd/resolved.conf 2>/dev/null || true
            grep -q 'DNSStubListener' /etc/systemd/resolved.conf 2>/dev/null || echo "DNSStubListener=no" >> /etc/systemd/resolved.conf
        fi
        systemctl restart systemd-resolved
        echo "    Готово."
    else
        echo "[1] Порт 53 не занят systemd-resolved, пропуск."
    fi
elif [ "$DNSMASQ_INSTALLED" = false ] && systemctl is-active --quiet systemd-resolved 2>/dev/null && ss -tulnp 2>/dev/null | grep -q '127.0.0.53:53'; then
    echo "[1] dnsmasq не установлен; отключение systemd-resolved не выполняется, чтобы не нарушить DNS на сервере."
else
    echo "[1] systemd-resolved не активен или dnsmasq не требуется, пропуск."
fi

# 2. Обновить dnsmasq из записей и перезапустить
if [ -f "$SCRIPT_DIR/update-dnsmasq.sh" ]; then
    echo "[2] Обновление конфигурации dnsmasq..."
    if ! bash "$SCRIPT_DIR/update-dnsmasq.sh"; then
        echo "  [Предупреждение] update-dnsmasq не выполнен (нет записей или конфига? Проверьте /etc/dns-api/records.json и config.json)."
    fi
fi
DNSMASQ_STARTED=false
if systemctl is-active --quiet dnsmasq 2>/dev/null; then
    echo "[3] Перезапуск dnsmasq..."
    systemctl restart dnsmasq
    echo "    dnsmasq перезапущен."
    DNSMASQ_STARTED=true
elif systemctl list-unit-files 2>/dev/null | grep -q dnsmasq; then
    echo "[3] Запуск dnsmasq..."
    systemctl start dnsmasq
    echo "    dnsmasq запущен."
    DNSMASQ_STARTED=true
else
    echo "[3] dnsmasq не установлен, пропуск."
fi
if [ "$DNSMASQ_STARTED" = true ]; then
    echo "    Если на этом сервере DNS не работает, проверьте: cat /etc/resolv.conf. При необходимости укажите nameserver 127.0.0.1"
fi

# 4. Перезапуск Local DNS API при наличии
if systemctl is-active --quiet local-dns-api 2>/dev/null; then
    echo "[4] Перезапуск local-dns-api..."
    systemctl restart local-dns-api
    echo "    local-dns-api перезапущен."
else
    echo "[4] local-dns-api не запущен, пропуск."
fi

echo ""
echo "Проверка порта 53:"
ss -tulnp 2>/dev/null | grep :53 || echo "  Ничего не слушает 53."
echo ""
echo "Готово. Если проблема осталась — см. DNS_TROUBLESHOOTING.md"
