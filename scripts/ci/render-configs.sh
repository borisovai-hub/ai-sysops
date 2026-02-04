#!/bin/bash
# Подстановка CI Variables в шаблоны конфигов
# Использование: render-configs.sh [--validate]
set -e

VALIDATE_ONLY=false
[ "$1" = "--validate" ] && VALIDATE_ONLY=true

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
TEMPLATE_DIR="$REPO_ROOT/config/single-machine"
OUTPUT_DIR="$REPO_ROOT/rendered-configs"

# Обязательные CI переменные
required_vars=(GITLAB_URL GITLAB_TOKEN STRAPI_URL STRAPI_TOKEN BASE_DOMAIN)

echo "=== Проверка CI переменных ==="
missing=0
for var in "${required_vars[@]}"; do
    if [ -z "${!var}" ]; then
        echo "ОШИБКА: переменная $var не задана"
        missing=1
    else
        if [ "$var" = "GITLAB_TOKEN" ] || [ "$var" = "STRAPI_TOKEN" ]; then
            echo "  $var = [masked]"
        else
            echo "  $var = ${!var}"
        fi
    fi
done

if [ "$missing" -eq 1 ]; then
    echo ""
    echo "Задайте переменные в GitLab → Settings → CI/CD → Variables"
    exit 1
fi

if [ "$VALIDATE_ONLY" = true ]; then
    echo "Валидация пройдена: все переменные заданы"
    exit 0
fi

# Рендеринг шаблонов
echo ""
echo "=== Рендеринг конфигов ==="
mkdir -p "$OUTPUT_DIR"

# Management UI config
if [ -f "$TEMPLATE_DIR/management-ui.config.json" ]; then
    sed -e "s|{{GITLAB_URL}}|$GITLAB_URL|g" \
        -e "s|{{GITLAB_TOKEN}}|$GITLAB_TOKEN|g" \
        -e "s|{{STRAPI_URL}}|$STRAPI_URL|g" \
        -e "s|{{STRAPI_TOKEN}}|$STRAPI_TOKEN|g" \
        -e "s|{{BASE_DOMAIN}}|$BASE_DOMAIN|g" \
        "$TEMPLATE_DIR/management-ui.config.json" \
        > "$OUTPUT_DIR/management-ui.config.json"
    chmod 600 "$OUTPUT_DIR/management-ui.config.json"
    echo "  management-ui.config.json → OK"
else
    echo "  ПРЕДУПРЕЖДЕНИЕ: $TEMPLATE_DIR/management-ui.config.json не найден"
fi

# DNS API config
if [ -f "$TEMPLATE_DIR/dns-api.config.json" ]; then
    sed -e "s|{{BASE_DOMAIN}}|$BASE_DOMAIN|g" \
        "$TEMPLATE_DIR/dns-api.config.json" \
        > "$OUTPUT_DIR/dns-api.config.json"
    chmod 600 "$OUTPUT_DIR/dns-api.config.json"
    echo "  dns-api.config.json → OK"
else
    echo "  ПРЕДУПРЕЖДЕНИЕ: $TEMPLATE_DIR/dns-api.config.json не найден"
fi

echo ""
echo "Конфиги отрендерены в $OUTPUT_DIR/"
