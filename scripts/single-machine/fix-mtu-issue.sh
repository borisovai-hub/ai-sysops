#!/bin/bash
# Исправление Path MTU Discovery Black Hole на сервере (Traefik + Mailu).
# Добавляет GZIP в Traefik для Mailu, TCP MTU Probing и принудительно ограничивает
# TCP MSS для всех исходящих соединений (меньшие пакеты — стабильнее в «узких» сетях).
# Использование: sudo ./fix-mtu-issue.sh [--no-iptables] [--check-only]

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MAILU_YML="/etc/traefik/dynamic/mailu.yml"
TCP_MSS=1360

set +e

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

SKIP_IPTABLES=false
CHECK_ONLY=false
for arg in "$@"; do
    case $arg in
        --no-iptables) SKIP_IPTABLES=true ;;
        --check-only) CHECK_ONLY=true ;;
    esac
done

echo "=== Исправление Path MTU на сервере ==="
echo ""

# 1. Добавить compress middleware в конфигурацию Traefik для Mailu
if [ -f "$MAILU_YML" ]; then
    if grep -q "mailu-compress" "$MAILU_YML"; then
        echo "[1/4] Compress middleware уже есть в $MAILU_YML"
    else
        echo "[1/4] Добавление compress middleware в $MAILU_YML..."
        cp "$MAILU_YML" "${MAILU_YML}.backup.$(date +%Y%m%d_%H%M%S)"
        COMPRESS_BLOCK=$(cat << 'COMPRESSEOF'

    mailu-compress:
      compress:
        excludedContentTypes:
          - "text/event-stream"
COMPRESSEOF
        )
        awk -v block="$COMPRESS_BLOCK" '
            /forceSTSHeader: false/ { print; print block; next }
            /^        - mailu-headers$/ { print; print "        - mailu-compress"; next }
            { print }
        ' "$MAILU_YML" > "${MAILU_YML}.tmp"
        if [ -s "${MAILU_YML}.tmp" ]; then
            mv "${MAILU_YML}.tmp" "$MAILU_YML"
            echo "  [OK] Compress middleware добавлен"
        else
            rm -f "${MAILU_YML}.tmp"
            echo "  [Предупреждение] Не удалось вставить блок, проверьте файл вручную"
        fi
    fi
else
    echo "[1/4] Файл $MAILU_YML не найден — шаг пропущен"
    echo "  Подсказка: при настройке через base_domains запустите configure-traefik.sh — конфиг Mailu создастся при отсутствии"
fi

# 2. TCP MTU Probing в sysctl
echo ""
echo "[2/4] Настройка TCP MTU Probing..."
if grep -q "net.ipv4.tcp_mtu_probing" /etc/sysctl.conf; then
    sed -i 's/^net\.ipv4\.tcp_mtu_probing.*/net.ipv4.tcp_mtu_probing = 1/' /etc/sysctl.conf
else
    echo "net.ipv4.tcp_mtu_probing = 1" >> /etc/sysctl.conf
fi
sysctl -p /etc/sysctl.conf 2>/dev/null | grep -E "tcp_mtu_probing|error" || true
echo "  [OK] net.ipv4.tcp_mtu_probing = 1"

# 3. Принудительное ограничение TCP MSS для всех исходящих соединений
echo ""
if [ "$SKIP_IPTABLES" = true ]; then
    echo "[3/4] TCP MSS через iptables отключён (--no-iptables)"
else
    echo "[3/4] Ограничение TCP MSS для всех соединений (iptables)..."
    if iptables -t mangle -C POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss "$TCP_MSS" 2>/dev/null; then
        echo "  [Пропуск] Правило TCPMSS $TCP_MSS уже есть"
    else
        iptables -t mangle -A POSTROUTING -p tcp --tcp-flags SYN,RST SYN -j TCPMSS --set-mss "$TCP_MSS"
        if command -v netfilter-persistent &>/dev/null; then
            netfilter-persistent save 2>/dev/null || true
        elif [ -d /etc/iptables ]; then
            iptables-save > /etc/iptables/rules.v4 2>/dev/null || true
        fi
        echo "  [OK] TCP MSS $TCP_MSS установлен для всех исходящих TCP"
    fi
fi

# 4. Перезагрузка Traefik и проверка
echo ""
echo "[4/4] Перезагрузка Traefik..."
if [ "$CHECK_ONLY" = true ]; then
    echo "  [Пропуск] Режим --check-only"
else
    if systemctl is-active --quiet traefik 2>/dev/null; then
        systemctl reload traefik 2>/dev/null || systemctl restart traefik 2>/dev/null
        sleep 2
        if systemctl is-active --quiet traefik; then
            echo "  [OK] Traefik перезагружен"
        else
            echo "  [Ошибка] Traefik не запустился, проверьте: journalctl -u traefik -n 30"
        fi
    else
        echo "  [Пропуск] Traefik не запущен"
    fi
fi

echo ""
echo "=== Готово ==="
echo ""
echo "Проверка GZIP (подставьте свой домен):"
echo "  curl -I -H \"Accept-Encoding: gzip\" https://mail.dev.borisovai.tech/static/vendor.css"
echo "  Ожидается заголовок: Content-Encoding: gzip"
echo ""
echo "Проверка sysctl: sysctl net.ipv4.tcp_mtu_probing"
echo "Проверка iptables MSS: iptables -t mangle -L -n -v | grep TCPMSS"
echo "Отключить MSS clamping: sudo ./fix-mtu-issue.sh --no-iptables (только sysctl/GZIP)"