# План рефакторинга скриптов установки

## Источники анализа

Анализ проведён тремя специалистами: архитектор, DevOps-инженер, SysOps-администратор.

## Фаза 1: Критические исправления (безопасность + баги)

Быстрые правки, не ломающие совместимость.

### 1.1 Баг: `safe_execute` в common.sh

**Проблема:** `local exit_code=$?` (строка 112) — `local` сбрасывает `$?` в 0.
```bash
# Было:
local exit_code=$?
# Надо:
local exit_code
exit_code=$?
```

### 1.2 Мёртвый код: `trap ERR` при `set +e`

**Проблема:** trap ERR не срабатывает при `set +e`. Переменная `ERROR_OCCURRED` в install-all.sh никогда не станет true.
**Решение:** убрать trap ERR, полагаться на явные проверки `$?` после критических команд.

### 1.3 Management UI от root → выделенный пользователь

**Проблема:** Node.js Express от root — при RCE полный контроль над сервером.
**Решение:** в install-management-ui.sh добавить:
```bash
adduser --system --no-create-home --group management-ui 2>/dev/null || true
chown -R management-ui:management-ui /opt/management-ui
```
В systemd unit: `User=management-ui`, `Group=management-ui`.
Права на `/etc/management-ui/` — `chown root:management-ui`, `chmod 640`.

### 1.4 Systemd hardening для frps и management-ui

Добавить в systemd units:
```ini
NoNewPrivileges=true
ProtectSystem=strict
ReadWritePaths=/etc/management-ui /var/log
PrivateTmp=true
```

### 1.5 Traefik Dashboard — закрыть доступ

**Проблема:** порт 8080 открыт без аутентификации.
**Решение:** в Traefik static config добавить basicAuth или привязать к 127.0.0.1.

### 1.6 Секреты не в stdout

**Проблема:** auth-токены выводятся в stdout, могут попасть в CI-логи.
**Решение:** записывать в файл `/root/.borisovai-credentials/<service>` с chmod 600. В stdout — только маскированные значения.

### 1.7 Ошибка: запятая в массиве upload-single-machine.sh

**Проблема:** строка 215 `"fix-mtu-issue.sh",` — запятая станет частью имени файла.
**Решение:** убрать запятую.

### 1.8 management-ui: Restart=on-failure → Restart=always

**Проблема:** `on-failure` не перезапускает при exit code 0 (SIGTERM). frps уже использует `always`.
**Решение:** заменить на `Restart=always` + добавить `StartLimitBurst=5`, `StartLimitIntervalSec=60`.

---

## Фаза 2: Предсказуемость и диагностика

### 2.1 `--dry-run` для install-all.sh и дочерних скриптов

Глобальная переменная `DRY_RUN=true`. При dry-run:
- Показать список действий: какие файлы создаются, порты открываются, сервисы перезапускаются
- Не выполнять команды
- Использовать функцию `run_cmd()` вместо прямых вызовов:
```bash
run_cmd() {
    if [ "$DRY_RUN" = true ]; then
        echo "  [DRY-RUN] $*"
    else
        "$@"
    fi
}
```

### 2.2 Логирование всего вывода в файл

В начале каждого install-скрипта:
```bash
INSTALL_LOG="/var/log/borisovai-install-$(date +%Y%m%d_%H%M%S).log"
exec > >(tee -a "$INSTALL_LOG") 2>&1
```

### 2.3 Health-check вместо `sleep 2 + systemctl is-active`

Функция в common.sh:
```bash
wait_for_service() {
    local service="$1"
    local url="${2:-}"       # опциональный HTTP endpoint
    local timeout="${3:-30}" # секунды

    systemctl start "$service"
    for i in $(seq 1 "$timeout"); do
        if ! systemctl is-active --quiet "$service"; then
            sleep 1; continue
        fi
        if [ -n "$url" ]; then
            if curl -sf --max-time 2 "$url" >/dev/null 2>&1; then
                echo "  [OK] $service запущен и отвечает"
                return 0
            fi
        else
            echo "  [OK] $service запущен"
            return 0
        fi
        sleep 1
    done
    echo "  [ОШИБКА] $service не запустился за ${timeout}с"
    return 1
}
```
Использование: `wait_for_service "management-ui" "http://127.0.0.1:3000" 15`

### 2.4 Скрипт `status.sh`

Одна команда для проверки всего:
```
$ sudo ./status.sh
=== Состояние сервисов ===
  traefik        : active (running) — порт 80,443
  management-ui  : active (running) — порт 3000 — HTTP 200
  frps           : active (running) — порт 17420
  local-dns-api  : active (running) — порт 5353
  gitlab         : inactive (dead)  — не установлен
  ...

=== SSL сертификаты ===
  admin.borisovai.ru    : valid until 2026-05-01 (83 дня)
  ...

=== Диск ===
  /              : 45% used (12G/26G)
  /var/log       : 2.1G

=== Порты ===
  80,443   traefik
  3000     management-ui (localhost)
  17420    frps (public)
  ...
```

---

## Фаза 3: DRY и модульность (common.sh v2)

### 3.1 JSON через jq (jq уже ставится в install-all.sh)

Заменить `get_config_value` / `save_config_value`:
```bash
get_config_value() {
    local key="$1"
    local file="${2:-$INSTALL_CONFIG_FILE}"
    [ -f "$file" ] && jq -r ".\"$key\" // empty" "$file" 2>/dev/null
}

save_config_value() {
    local key="$1" value="$2"
    local file="${3:-$INSTALL_CONFIG_FILE}"
    local tmp
    if [ -f "$file" ]; then
        tmp=$(jq --arg k "$key" --arg v "$value" '.[$k] = $v' "$file")
    else
        tmp=$(jq -n --arg k "$key" --arg v "$value" '{($k): $v}')
    fi
    echo "$tmp" > "$file"
}
```
**Миграция:** сначала добавить jq-версии как `get_config_value_jq` / `save_config_value_jq`, затем заменить основные, оставив grep-fallback для систем без jq.

### 3.2 Вынести повторяющиеся блоки в common.sh

```bash
# Парсинг --force
parse_args() {
    FORCE_MODE=false
    for arg in "$@"; do
        case $arg in --force) FORCE_MODE=true ;; esac
    done
}

# Проверка root
require_root() {
    if [ "$EUID" -ne 0 ]; then
        echo "Ошибка: Запустите скрипт с правами root (sudo)"
        exit 1
    fi
}

# Создание/обновление systemd unit
install_systemd_unit() {
    local name="$1"      # имя сервиса (без .service)
    local unit_file="$2" # путь к шаблону или heredoc
    local target="/etc/systemd/system/${name}.service"

    if [ "$FORCE_MODE" = true ] || [ ! -f "$target" ]; then
        if [ -f "$target" ]; then
            cp "$target" "${target}.backup.$(date +%Y%m%d_%H%M%S)"
        fi
        cp "$unit_file" "$target"
        echo "  [OK] Создан ${target}"
    else
        echo "  [Пропуск] ${name}.service уже существует"
    fi
    systemctl daemon-reload
    systemctl enable "$name"
}

# Проверка идемпотентности
check_already_installed() {
    local name="$1"       # имя сервиса
    local binary="${2:-}" # путь к бинарнику (опционально)

    if [ "$FORCE_MODE" = true ]; then return 1; fi

    local installed=false
    if [ -n "$binary" ] && [ -f "$binary" ]; then installed=true; fi
    if [ -z "$binary" ] && is_service_installed "${name}.service" 2>/dev/null; then installed=true; fi

    if [ "$installed" = true ]; then
        echo "  [Пропуск] ${name} уже установлен"
        if is_service_running "${name}.service" 2>/dev/null; then
            echo "  [OK] ${name} запущен"
        else
            echo "  [Предупреждение] ${name} установлен, но не запущен"
            systemctl start "$name"
        fi
        return 0
    fi
    return 1
}
```

### 3.3 Миграция конфигов

При обновлении дополнять config.json недостающими полями:
```bash
migrate_config() {
    local file="$1"
    shift
    # Пары: ключ дефолт
    while [ $# -ge 2 ]; do
        local key="$1" default="$2"; shift 2
        local current=$(get_config_value "$key" "$file")
        if [ -z "$current" ]; then
            save_config_value "$key" "$default" "$file"
            echo "  [Миграция] Добавлен $key = $default"
        fi
    done
}
```

---

## Фаза 4: Бэкапы и откат

### 4.1 Единый каталог бэкапов

`/var/backups/borisovai-admin/YYYYMMDD_HHMMSS/`

### 4.2 Функции backup / restore в common.sh

```bash
create_backup() {
    local backup_dir="/var/backups/borisovai-admin/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"
    # Конфиги
    cp -a /etc/management-ui/ "$backup_dir/management-ui-etc/" 2>/dev/null
    cp -a /etc/frp/ "$backup_dir/frp-etc/" 2>/dev/null
    cp -a /etc/traefik/dynamic/ "$backup_dir/traefik-dynamic/" 2>/dev/null
    cp -a /etc/install-config.json "$backup_dir/" 2>/dev/null
    # Systemd units
    for svc in management-ui frps traefik local-dns-api; do
        cp "/etc/systemd/system/${svc}.service" "$backup_dir/" 2>/dev/null
    done
    echo "$backup_dir"
}

# Ротация: оставить последние N бэкапов
rotate_backups() {
    local keep="${1:-5}"
    local backup_root="/var/backups/borisovai-admin"
    ls -dt "$backup_root"/*/ 2>/dev/null | tail -n +$((keep + 1)) | xargs rm -rf
}
```

### 4.3 Скрипт `rollback.sh`

Показывает список бэкапов, позволяет выбрать и восстановить.

---

## Фаза 5: Расширяемость (компонентный реестр)

### 5.1 Структура каталогов

```
scripts/single-machine/
  common.sh
  install-all.sh
  status.sh
  backup.sh
  rollback.sh
  components/
    traefik/
      install.sh
      meta.conf        # name, depends, ports, systemd_name
      traefik.yml.tpl   # шаблон Traefik dynamic config
    management-ui/
      install.sh
      meta.conf
    frps/
      install.sh
      meta.conf
      tunnels.yml.tpl
    ...
```

### 5.2 meta.conf

```ini
name="frps"
description="frp server (туннелирование)"
depends="traefik"
systemd_service="frps"
binary="/usr/local/bin/frps"
config_files="/etc/frp/frps.toml"
ports_public="17420"
ports_internal="17480 17490"
install_config_keys="frp_control_port frp_vhost_port frp_dashboard_port frp_prefix"
```

### 5.3 install-all.sh v2

Сканирует `components/*/meta.conf`, строит меню динамически, проверяет зависимости, вызывает `components/<name>/install.sh`.

### 5.4 upload-single-machine.sh v2

Собирает файлы через glob: `scripts/single-machine/*.sh` + `scripts/single-machine/components/**/*` вместо хардкода массива.

---

## Порядок реализации

| Фаза | Что | Объём | Приоритет |
|------|-----|-------|-----------|
| 1 | Критические исправления | ~50 строк правок | Высокий |
| 2 | Предсказуемость (dry-run, logging, status.sh) | ~200 строк новых | Высокий |
| 3 | DRY + jq + миграция конфигов | ~150 строк в common.sh | Средний |
| 4 | Бэкапы и откат | ~100 строк + backup.sh, rollback.sh | Средний |
| 5 | Компонентный реестр | Рефакторинг install-all.sh | Низкий |

## Миграция

Фазы 1-4 обратно совместимы — можно применять инкрементально без перелома.
Фаза 5 — перестройка структуры, требует миграции всех install-скриптов.
