#!/bin/bash
# Скрипт проверки и установки Docker + Docker Compose v2
# Идемпотентный — безопасно запускать многократно
# Использование: bash scripts/ci/install-docker.sh
#
# CI/CD: автоматически запускается в install stage перед установкой Umami

set -e

echo "=== Проверка Docker ==="

# ============================================================
# Проверка Docker Engine
# ============================================================
if command -v docker &>/dev/null; then
    DOCKER_VERSION=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1 || echo "unknown")
    echo "  [OK] Docker установлен (версия: $DOCKER_VERSION)"
else
    echo "  [Установка] Docker не найден, устанавливаю..."

    # Установка Docker через официальный скрипт get.docker.com
    if curl -fsSL https://get.docker.com | sh; then
        echo "  [OK] Docker установлен"
    else
        echo "  [ОШИБКА] Не удалось установить Docker"
        exit 1
    fi

    # Включение автозапуска Docker
    systemctl enable docker
    systemctl start docker

    # Проверка установки
    if command -v docker &>/dev/null; then
        DOCKER_VERSION=$(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1 || echo "unknown")
        echo "  [OK] Docker $DOCKER_VERSION готов к работе"
    else
        echo "  [ОШИБКА] Docker установлен, но команда docker недоступна"
        exit 1
    fi
fi

# ============================================================
# Проверка Docker Compose v2 (плагин)
# ============================================================
if docker compose version &>/dev/null; then
    COMPOSE_VERSION=$(docker compose version --short || echo "unknown")
    echo "  [OK] Docker Compose v2 установлен (версия: $COMPOSE_VERSION)"
else
    echo "  [ОШИБКА] Docker Compose v2 не найден"
    echo ""
    echo "  Docker Compose v2 устанавливается как плагин к Docker Engine."
    echo "  Если вы установили Docker через get.docker.com, плагин должен быть включён."
    echo ""
    echo "  Ручная установка Docker Compose v2:"
    echo "    COMPOSE_VERSION=\$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep tag_name | cut -d'\"' -f4)"
    echo "    mkdir -p /usr/local/lib/docker/cli-plugins"
    echo "    curl -SL \"https://github.com/docker/compose/releases/download/\${COMPOSE_VERSION}/docker-compose-\$(uname -s)-\$(uname -m)\" -o /usr/local/lib/docker/cli-plugins/docker-compose"
    echo "    chmod +x /usr/local/lib/docker/cli-plugins/docker-compose"
    echo ""
    exit 1
fi

# ============================================================
# Проверка запуска Docker daemon
# ============================================================
if ! docker ps &>/dev/null; then
    echo "  [ОШИБКА] Docker daemon не запущен"
    echo "  Попытка запуска..."

    if systemctl start docker; then
        sleep 3
        if docker ps &>/dev/null; then
            echo "  [OK] Docker daemon запущен"
        else
            echo "  [ОШИБКА] Docker daemon не отвечает после запуска"
            systemctl status docker --no-pager
            exit 1
        fi
    else
        echo "  [ОШИБКА] Не удалось запустить Docker daemon"
        systemctl status docker --no-pager
        exit 1
    fi
else
    echo "  [OK] Docker daemon запущен"
fi

# ============================================================
# Проверка прав доступа (для gitlab-runner user)
# ============================================================
CURRENT_USER=$(whoami)
if [ "$CURRENT_USER" != "root" ]; then
    if ! groups "$CURRENT_USER" | grep -q '\bdocker\b'; then
        echo "  [Предупреждение] Пользователь $CURRENT_USER не в группе docker"
        echo "  Для работы без sudo добавьте пользователя в группу:"
        echo "    sudo usermod -aG docker $CURRENT_USER"
        echo "    newgrp docker"
    fi
fi

# ============================================================
# Итоги
# ============================================================
echo ""
echo "=== Docker готов к работе ==="
echo "  Docker Engine:  $DOCKER_VERSION"
echo "  Docker Compose: $(docker compose version --short)"
echo ""
