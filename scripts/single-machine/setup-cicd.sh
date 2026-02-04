#!/bin/bash
# Скрипт настройки CI/CD для деплоя проектов
# Использование: sudo ./setup-cicd.sh [--force]
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение.

# Определение директории скрипта (абсолютный путь)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

# Загрузка общих функций
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Предупреждение: common.sh не найден, некоторые функции могут быть недоступны"
fi

set +e

if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Параметры
FORCE_MODE=false

for arg in "$@"; do
    case $arg in
        --force)
            FORCE_MODE=true
            ;;
    esac
done

echo "=== Настройка CI/CD для деплоя ==="
echo ""

# Проверка установки GitLab Runner
if ! is_command_exists "gitlab-runner"; then
    echo "Ошибка: GitLab Runner не установлен"
    echo "Сначала запустите: sudo ./install-gitlab-runner.sh"
    exit 1
fi

# Получение конфигурации GitLab
GITLAB_URL=$(get_config_value "gitlab_domain")
if [ -z "$GITLAB_URL" ]; then
    GITLAB_URL=$(prompt_and_save "gitlab_domain" "Введите домен GitLab (например, gitlab.dev.borisovai.ru)" "gitlab.dev.borisovai.ru")
fi

# Добавляем https:// если нет протокола
if [[ ! "$GITLAB_URL" =~ ^https?:// ]]; then
    GITLAB_URL="https://${GITLAB_URL}"
fi

echo "GitLab URL: $GITLAB_URL"
echo ""

# Проверка регистрации runner
RUNNER_REGISTERED=false
if [ -f "/etc/gitlab-runner/config.toml" ]; then
    if grep -q "url = \"$GITLAB_URL\"" /etc/gitlab-runner/config.toml 2>/dev/null; then
        RUNNER_REGISTERED=true
    fi
fi

# Регистрация GitLab Runner
if [ "$FORCE_MODE" = true ] || [ "$RUNNER_REGISTERED" = false ]; then
    echo "[1/6] Регистрация GitLab Runner..."
    echo ""
    echo "Для регистрации runner нужен registration token."
    echo "Получить токен можно в GitLab:"
    echo "  Settings → CI/CD → Runners → Expand"
    echo ""
    
    REGISTRATION_TOKEN=$(prompt_and_save "gitlab_runner_token" "Введите registration token из GitLab")
    if [ -z "$REGISTRATION_TOKEN" ]; then
        echo "Ошибка: Registration token обязателен"
        exit 1
    fi
    
    RUNNER_TAG=$(prompt_and_save "gitlab_runner_tag" "Введите тег для runner (например, deploy-production)" "deploy-production")
    if [ -z "$RUNNER_TAG" ]; then
        RUNNER_TAG="deploy-production"
    fi
    
    RUNNER_DESCRIPTION=$(prompt_and_save "gitlab_runner_description" "Введите описание runner" "Production server")
    if [ -z "$RUNNER_DESCRIPTION" ]; then
        RUNNER_DESCRIPTION="Production server"
    fi
    
    echo ""
    echo "Регистрация runner..."
    gitlab-runner register \
        --url "$GITLAB_URL" \
        --registration-token "$REGISTRATION_TOKEN" \
        --executor shell \
        --tag-list "$RUNNER_TAG" \
        --description "$RUNNER_DESCRIPTION" \
        --non-interactive
    
    if [ $? -eq 0 ]; then
        echo "  [OK] Runner зарегистрирован"
        systemctl restart gitlab-runner
    else
        echo "  [ОШИБКА] Не удалось зарегистрировать runner"
        echo "  Проверьте токен и URL GitLab"
        exit 1
    fi
else
    echo "[1/6] Runner уже зарегистрирован (пропуск)"
fi

# Установка Node.js и PM2
echo ""
echo "[2/6] Проверка Node.js и PM2..."
if ! command -v node &> /dev/null; then
    echo "Установка Node.js 20.x..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y nodejs
    echo "  [OK] Node.js установлен: $(node --version)"
else
    echo "  [Пропуск] Node.js уже установлен: $(node --version)"
fi

if ! command -v pm2 &> /dev/null; then
    echo "Установка PM2..."
    npm install -g pm2
    pm2 startup systemd -u root --hp /root
    echo "  [OK] PM2 установлен"
else
    echo "  [Пропуск] PM2 уже установлен"
fi

# Создание директорий деплоя
echo ""
echo "[3/6] Создание директорий деплоя..."
DEPLOY_PATH="/var/www/borisovai-site"
mkdir -p "$DEPLOY_PATH/frontend"
mkdir -p "$DEPLOY_PATH/backend"
echo "  [OK] Директории созданы: $DEPLOY_PATH/{frontend,backend}"

# Настройка прав доступа для gitlab-runner
echo ""
echo "[4/6] Настройка прав доступа..."
chown -R gitlab-runner:gitlab-runner "$DEPLOY_PATH"
chmod -R 755 "$DEPLOY_PATH"
echo "  [OK] Права доступа настроены"

# Создание .env файлов из шаблонов
echo ""
echo "[5/6] Создание .env файлов..."
CONFIG_CICD_PATH="$PROJECT_ROOT/config/single-machine/cicd"

if [ -d "$CONFIG_CICD_PATH" ]; then
    if [ -f "$CONFIG_CICD_PATH/.env.frontend.example" ]; then
        if [ ! -f "$DEPLOY_PATH/frontend/.env.local" ]; then
            cp "$CONFIG_CICD_PATH/.env.frontend.example" "$DEPLOY_PATH/frontend/.env.local"
            chown gitlab-runner:gitlab-runner "$DEPLOY_PATH/frontend/.env.local"
            chmod 600 "$DEPLOY_PATH/frontend/.env.local"
            echo "  [OK] Создан $DEPLOY_PATH/frontend/.env.local"
        else
            echo "  [Пропуск] $DEPLOY_PATH/frontend/.env.local уже существует"
        fi
    fi
    
    if [ -f "$CONFIG_CICD_PATH/.env.backend.example" ]; then
        if [ ! -f "$DEPLOY_PATH/backend/.env" ]; then
            cp "$CONFIG_CICD_PATH/.env.backend.example" "$DEPLOY_PATH/backend/.env"
            chown gitlab-runner:gitlab-runner "$DEPLOY_PATH/backend/.env"
            chmod 600 "$DEPLOY_PATH/backend/.env"
            echo "  [OK] Создан $DEPLOY_PATH/backend/.env"
        else
            echo "  [Пропуск] $DEPLOY_PATH/backend/.env уже существует"
        fi
    fi
else
    echo "  [Предупреждение] Директория с шаблонами не найдена: $CONFIG_CICD_PATH"
    echo "  Создайте .env файлы вручную:"
    echo "    nano $DEPLOY_PATH/frontend/.env.local"
    echo "    nano $DEPLOY_PATH/backend/.env"
fi

# Настройка SSH ключей для gitlab-runner
echo ""
echo "[6/6] Настройка SSH ключей для gitlab-runner..."
RUNNER_HOME="/home/gitlab-runner"
RUNNER_SSH_DIR="$RUNNER_HOME/.ssh"

if [ ! -d "$RUNNER_SSH_DIR" ]; then
    mkdir -p "$RUNNER_SSH_DIR"
    chown gitlab-runner:gitlab-runner "$RUNNER_SSH_DIR"
    chmod 700 "$RUNNER_SSH_DIR"
fi

if [ ! -f "$RUNNER_SSH_DIR/id_rsa" ]; then
    echo "Создание SSH ключа для gitlab-runner..."
    sudo -u gitlab-runner ssh-keygen -t rsa -b 4096 -f "$RUNNER_SSH_DIR/id_rsa" -N "" -q
    if [ $? -eq 0 ]; then
        echo "  [OK] SSH ключ создан"
        echo ""
        echo "ВАЖНО: Добавьте публичный ключ в GitLab:"
        echo "  1. Скопируйте публичный ключ:"
        echo "     cat $RUNNER_SSH_DIR/id_rsa.pub"
        echo "  2. В GitLab: Settings → SSH Keys → Add SSH Key"
        echo ""
        echo "Публичный ключ:"
        cat "$RUNNER_SSH_DIR/id_rsa.pub"
        echo ""
    else
        echo "  [ОШИБКА] Не удалось создать SSH ключ"
    fi
else
    echo "  [Пропуск] SSH ключ уже существует"
    echo "  Публичный ключ:"
    cat "$RUNNER_SSH_DIR/id_rsa.pub" 2>/dev/null || echo "    (не удалось прочитать)"
fi

# Настройка SSH config для GitLab
SSH_CONFIG="$RUNNER_SSH_DIR/config"
if [ ! -f "$SSH_CONFIG" ] || [ "$FORCE_MODE" = true ]; then
    cat > "$SSH_CONFIG" << EOF
Host gitlab.dev.borisovai.ru
    HostName gitlab.dev.borisovai.ru
    User git
    IdentityFile $RUNNER_SSH_DIR/id_rsa
    StrictHostKeyChecking no
    UserKnownHostsFile $RUNNER_SSH_DIR/known_hosts
EOF
    chown gitlab-runner:gitlab-runner "$SSH_CONFIG"
    chmod 600 "$SSH_CONFIG"
    echo "  [OK] SSH config создан"
fi

# Добавление GitLab в known_hosts
echo "Добавление GitLab в known_hosts..."
sudo -u gitlab-runner ssh-keyscan -H gitlab.dev.borisovai.ru >> "$RUNNER_SSH_DIR/known_hosts" 2>/dev/null
chown gitlab-runner:gitlab-runner "$RUNNER_SSH_DIR/known_hosts" 2>/dev/null
chmod 644 "$RUNNER_SSH_DIR/known_hosts" 2>/dev/null

echo ""
echo "=== Настройка CI/CD завершена! ==="
echo ""
echo "Важная информация:"
echo "  - Deploy path: $DEPLOY_PATH"
echo "  - Frontend: $DEPLOY_PATH/frontend"
echo "  - Backend: $DEPLOY_PATH/backend"
echo ""
echo "Следующие шаги:"
echo "  1. Добавьте SSH ключ gitlab-runner в GitLab (см. выше)"
echo "  2. Добавьте переменную в GitLab CI/CD:"
echo "     Settings → CI/CD → Variables"
echo "     Key: DEPLOY_PATH"
echo "     Value: $DEPLOY_PATH"
echo "  3. Настройте Traefik для frontend/backend:"
echo "     sudo ./configure-traefik-deploy.sh <frontend-domain> <backend-domain>"
echo ""
echo "Проверка runner:"
gitlab-runner list
echo ""
