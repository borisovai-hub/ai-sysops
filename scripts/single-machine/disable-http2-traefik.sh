#!/bin/bash
# Отключение HTTP/2 на Traefik (только HTTP/1.1) — устраняет ERR_HTTP2_PING_FAILED в браузере.
# Использование: sudo ./disable-http2-traefik.sh [--check-only]

set +e
if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: Запустите с правами root (sudo)"
    exit 1
fi

CHECK_ONLY=false
[ "$1" = "--check-only" ] && CHECK_ONLY=true

DYNAMIC_DIR="/etc/traefik/dynamic"
TLS_OPTIONS="$DYNAMIC_DIR/tls-options.yml"

echo "=== Отключение HTTP/2 в Traefik (только HTTP/1.1) ==="
echo ""

if [ "$CHECK_ONLY" = true ]; then
    if [ -f "$TLS_OPTIONS" ]; then
        echo "Файл $TLS_OPTIONS уже есть:"
        cat "$TLS_OPTIONS"
    else
        echo "Файл $TLS_OPTIONS не найден — HTTP/2 включён (по умолчанию)"
    fi
    exit 0
fi

mkdir -p "$DYNAMIC_DIR"
cat > "$TLS_OPTIONS" << 'EOF'
# Только HTTP/1.1 — устраняет ERR_HTTP2_PING_FAILED в браузере на нестабильных сетях
tls:
  options:
    default:
      alpnProtocols:
        - http/1.1
        - acme-tls/1
EOF

chmod 644 "$TLS_OPTIONS"
echo "Создан $TLS_OPTIONS"

if systemctl is-active --quiet traefik 2>/dev/null; then
    systemctl restart traefik
    sleep 2
    if systemctl is-active --quiet traefik; then
        echo "Traefik перезапущен. Клиенты будут подключаться по HTTP/1.1."
    else
        echo "Ошибка: Traefik не запустился. Проверьте: journalctl -u traefik -n 30"
        exit 1
    fi
else
    echo "Traefik не запущен — при следующем старте подхватит конфиг."
fi
echo ""
echo "Чтобы снова включить HTTP/2: удалите $TLS_OPTIONS и перезапустите traefik."
echo ""
