#!/bin/bash
# Главный скрипт установки всех инструментов на одну машину
# Использование: sudo ./install-all.sh [--continue] [--force] [--ask] [--new-only]
# 
# Параметры:
#   --continue  - продолжить установку с места остановки
#   --force     - переустановить все компоненты
#   --ask       - интерактивный режим (спрашивать о переустановке каждого компонента)
#   --new-only  - установить только новые компоненты (по умолчанию)
# 
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение и найдет все необходимые файлы.
# 
# Меню: при наличии dialog — TUI с выбором курсором (чеклист и меню). Без dialog — текстовый ввод 1-7, D, P, A, S, Q.
# Установка dialog для TUI: apt-get install dialog

# Определение директории скрипта (абсолютный путь)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Загрузка общих функций
if [ -f "$SCRIPT_DIR/common.sh" ]; then
    source "$SCRIPT_DIR/common.sh"
else
    echo "Ошибка: common.sh не найден"
    exit 1
fi

# Нормализация окончаний строк (убрать \r) для всех .sh — избежать CRLF при SCP с Windows
for f in "$SCRIPT_DIR"/*.sh; do
    [ -f "$f" ] && sed -i 's/\r$//' "$f" 2>/dev/null || true
done
DNS_API_DIR="$SCRIPT_DIR/../dns-api"
if [ -d "$DNS_API_DIR" ]; then
    for f in "$DNS_API_DIR"/*.sh; do
        [ -f "$f" ] && sed -i 's/\r$//' "$f" 2>/dev/null || true
    done
fi

# Параметры командной строки
CONTINUE_MODE=false
FORCE_MODE=false
INSTALL_MODE="auto"  # По умолчанию: автоматический пропуск установленных

for arg in "$@"; do
    case $arg in
        --continue)
            CONTINUE_MODE=true
            ;;
        --force)
            FORCE_MODE=true
            INSTALL_MODE="force"
            ;;
        --ask)
            INSTALL_MODE="ask"
            ;;
        --new-only)
            INSTALL_MODE="auto"
            ;;
        *)
            echo "Неизвестный параметр: $arg"
            echo "Использование: $0 [--continue] [--force] [--ask] [--new-only]"
            exit 1
            ;;
    esac
done

# Отключаем немедленный выход при ошибке для лучшей обработки
set +e
ERROR_OCCURRED=false

# Настройка обработки ошибок
trap 'err_code=$?; err_line=$LINENO; ERROR_OCCURRED=true; handle_error $err_code $err_line' ERR

echo "=========================================="
echo "  Установка всех инструментов на одну машину"
echo "=========================================="
echo ""

# Проверка прав root
if [ "$EUID" -ne 0 ]; then 
    echo "Ошибка: Запустите скрипт с правами root (sudo)"
    exit 1
fi

# Текущая настройка доменов (для отображения в меню)
domain_mode_summary() {
    if [ -n "$(get_config_value "base_domains")" ]; then
        get_base_domains | tr '\n' ',' | sed 's/,$//'
    else
        echo "один домен на сервис"
    fi
}

# Функция для отображения интерактивного меню выбора компонентов
show_component_menu() {
    echo ""
    echo "=== Выбор компонентов для установки ==="
    echo ""
    echo "Доступные компоненты:"
    echo ""
    echo "  [1] Traefik (reverse proxy с SSL) - ОБЯЗАТЕЛЬНО"
    echo "  [2] GitLab CE (Git сервер)"
    echo "  [3] n8n (автоматизация workflow)"
    echo "  [4] Веб-интерфейс управления"
    echo "  [5] DNS API интеграция"
    echo "  [6] Mailu Mail Server"
    echo "  [7] CI/CD для автоматического деплоя"
    echo ""
    echo "  [D] Настройка доменов (сейчас: $(domain_mode_summary))"
    echo "  [P] Параметры установки (email, домены, DNS, порты)"
    echo "  [A] Установить все компоненты"
    echo "  [S] Показать выбранные компоненты"
    echo "  [Q] Завершить выбор и продолжить"
    echo ""
    echo "  Можно ввести несколько пунктов через пробел или запятую (например: 2 3 4)"
    echo ""
}

# Функция для загрузки сохранённого выбора компонентов
load_component_selection() {
    INSTALL_TRAEFIK=$(get_config_value "install_traefik")
    INSTALL_GITLAB=$(get_config_value "install_gitlab")
    INSTALL_N8N=$(get_config_value "install_n8n")
    INSTALL_MANAGEMENT_UI=$(get_config_value "install_management_ui")
    INSTALL_DNS_API=$(get_config_value "install_dns_api")
    INSTALL_MAILU=$(get_config_value "install_mailu")
    INSTALL_CICD=$(get_config_value "install_cicd")
    
    # Значения по умолчанию (если не сохранены)
    [ -z "$INSTALL_TRAEFIK" ] && INSTALL_TRAEFIK="y"
    [ -z "$INSTALL_GITLAB" ] && INSTALL_GITLAB="y"
    [ -z "$INSTALL_N8N" ] && INSTALL_N8N="y"
    [ -z "$INSTALL_MANAGEMENT_UI" ] && INSTALL_MANAGEMENT_UI="y"
    [ -z "$INSTALL_DNS_API" ] && INSTALL_DNS_API="n"
    [ -z "$INSTALL_MAILU" ] && INSTALL_MAILU="n"
    [ -z "$INSTALL_CICD" ] && INSTALL_CICD="n"
}

# Функция для сохранения выбора компонентов
save_component_selection() {
    save_config_value "install_traefik" "$INSTALL_TRAEFIK"
    save_config_value "install_gitlab" "$INSTALL_GITLAB"
    save_config_value "install_n8n" "$INSTALL_N8N"
    save_config_value "install_management_ui" "$INSTALL_MANAGEMENT_UI"
    save_config_value "install_dns_api" "$INSTALL_DNS_API"
    save_config_value "install_mailu" "$INSTALL_MAILU"
    save_config_value "install_cicd" "$INSTALL_CICD"
}

# Краткая сводка параметров установки (для меню [P])
params_summary() {
    local v
    v=$(get_config_value "letsencrypt_email"); echo "Email Let's Encrypt: ${v:-— не задан}"
    if [ -n "$(get_config_value "base_domains")" ]; then
        v=$(get_config_value "site_port"); a=$(get_config_value "site_api_port"); echo "Порт frontend: ${v:-—}, API: ${a:-4002}"
    else
        v=$(get_config_value "gitlab_domain"); echo "GitLab: ${v:-—}"
        v=$(get_config_value "n8n_domain"); echo "n8n: ${v:-—}"
        v=$(get_config_value "ui_domain"); echo "Веб-интерфейс: ${v:-—}"
        v=$(get_config_value "mail_domain"); echo "Почта Mailu: ${v:-—}"
    fi
    v=$(get_config_value "dns_provider"); echo "DNS провайдер: ${v:-—}"
}

# Подменю параметров установки
show_params_submenu() {
    echo ""
    echo "=== Параметры установки ==="
    params_summary | sed 's/^/  /'
    echo ""
    echo "  1) Email для Let's Encrypt"
    echo "  2) Порт Next.js (при нескольких доменах)"
    echo "  3) Домен GitLab"
    echo "  4) Домен n8n"
    echo "  5) Домен веб-интерфейса"
    echo "  6) Домен почты Mailu"
    echo "  7) DNS провайдер (1=Cloudflare 2=DigitalOcean 3=Локальный)"
    echo "  8) Показать все параметры"
    echo "  Enter) Назад"
    echo ""
}

# Функция для отображения текущего выбора
show_selected_components() {
    echo ""
    echo "=== Выбранные компоненты ==="
    echo ""
    [ "$INSTALL_TRAEFIK" = "y" ] && echo "  [✓] Traefik" || echo "  [ ] Traefik"
    [ "$INSTALL_GITLAB" = "y" ] && echo "  [✓] GitLab CE" || echo "  [ ] GitLab CE"
    [ "$INSTALL_N8N" = "y" ] && echo "  [✓] n8n" || echo "  [ ] n8n"
    [ "$INSTALL_MANAGEMENT_UI" = "y" ] && echo "  [✓] Веб-интерфейс управления" || echo "  [ ] Веб-интерфейс управления"
    [ "$INSTALL_DNS_API" = "y" ] && echo "  [✓] DNS API" || echo "  [ ] DNS API"
    [ "$INSTALL_MAILU" = "y" ] && echo "  [✓] Mailu Mail Server" || echo "  [ ] Mailu Mail Server"
    [ "$INSTALL_CICD" = "y" ] && echo "  [✓] CI/CD" || echo "  [ ] CI/CD"
    echo "  Домены: $(domain_mode_summary)"
    echo ""
}

# Загрузка сохранённого выбора
load_component_selection

# TUI: проверка наличия dialog (меню с курсором)
USE_DIALOG=false
if command -v dialog &>/dev/null; then
    USE_DIALOG=true
fi
TMPFILE=""
cleanup_tmp() { [ -n "$TMPFILE" ] && [ -f "$TMPFILE" ] && rm -f "$TMPFILE"; }
trap cleanup_tmp EXIT

# Запрос значения через dialog (inputbox)
prompt_and_save_dialog() {
    local key="$1"
    local title="$2"
    local default="${3:-}"
    local saved
    saved=$(get_config_value "$key")
    [ -n "$saved" ] && default="$saved"
    TMPFILE=$(mktemp)
    dialog --clear --backtitle "Установка — borisovai-admin" --inputbox "$title" 8 60 "$default" 2> "$TMPFILE"
    local val
    val=$(cat "$TMPFILE" 2>/dev/null | _sanitize_value)
    rm -f "$TMPFILE"
    [ -n "$val" ] && save_config_value "$key" "$val"
    echo "$val"
}

# Интерактивное меню: TUI (dialog) или текстовый ввод (read)
if [ "$USE_DIALOG" = true ]; then
    while true; do
        TMPFILE=$(mktemp)
        dialog --clear --backtitle "Установка — borisovai-admin" --menu "Выберите действие" 18 60 10 \
            "components" "Выбор компонентов (чеклист)" \
            "params" "Параметры установки (email, домены, DNS)" \
            "domains" "Настройка доменов" \
            "all" "Включить все компоненты" \
            "show" "Показать выбранные компоненты" \
            "done" "Завершить и продолжить установку" \
            2> "$TMPFILE"
        dialog_ret=$?
        choice_content=$(cat "$TMPFILE" 2>/dev/null)
        rm -f "$TMPFILE"
        TMPFILE=""

        if [ $dialog_ret -ne 0 ] || [ -z "$choice_content" ]; then
            choice="done"
        else
            choice="$choice_content"
        fi

        case "$choice" in
            components)
                TMPFILE=$(mktemp)
                dialog --clear --backtitle "Установка — borisovai-admin" --checklist "Выбор компонентов (Пробел — вкл/выкл, Enter — OK)" 20 70 10 \
                    "traefik" "Traefik (reverse proxy, обязательно)" "$([ "$INSTALL_TRAEFIK" = y ] && echo ON || echo OFF)" \
                    "gitlab" "GitLab CE" "$([ "$INSTALL_GITLAB" = y ] && echo ON || echo OFF)" \
                    "n8n" "n8n (workflow)" "$([ "$INSTALL_N8N" = y ] && echo ON || echo OFF)" \
                    "management_ui" "Веб-интерфейс управления" "$([ "$INSTALL_MANAGEMENT_UI" = y ] && echo ON || echo OFF)" \
                    "dns_api" "DNS API" "$([ "$INSTALL_DNS_API" = y ] && echo ON || echo OFF)" \
                    "mailu" "Mailu Mail Server" "$([ "$INSTALL_MAILU" = y ] && echo ON || echo OFF)" \
                    "cicd" "CI/CD" "$([ "$INSTALL_CICD" = y ] && echo ON || echo OFF)" \
                    2> "$TMPFILE"
                res=$(cat "$TMPFILE" 2>/dev/null | tr -d '"' | tr '\n' ' ')
                rm -f "$TMPFILE"
                TMPFILE=""
                for tag in traefik gitlab n8n management_ui dns_api mailu cicd; do
                    case "$tag" in
                        traefik) if echo " $res " | grep -q " traefik "; then INSTALL_TRAEFIK=y; else INSTALL_TRAEFIK=n; fi ;;
                        gitlab)  if echo " $res " | grep -q " gitlab "; then INSTALL_GITLAB=y; else INSTALL_GITLAB=n; fi ;;
                        n8n)     if echo " $res " | grep -q " n8n "; then INSTALL_N8N=y; else INSTALL_N8N=n; fi ;;
                        management_ui) if echo " $res " | grep -q " management_ui "; then INSTALL_MANAGEMENT_UI=y; else INSTALL_MANAGEMENT_UI=n; fi ;;
                        dns_api) if echo " $res " | grep -q " dns_api "; then INSTALL_DNS_API=y; else INSTALL_DNS_API=n; fi ;;
                        mailu)   if echo " $res " | grep -q " mailu "; then INSTALL_MAILU=y; else INSTALL_MAILU=n; fi ;;
                        cicd)    if echo " $res " | grep -q " cicd "; then INSTALL_CICD=y; else INSTALL_CICD=n; fi ;;
                    esac
                done
                save_component_selection
                ;;
            params)
                while true; do
                    TMPFILE=$(mktemp)
                    dialog --clear --backtitle "Параметры установки" --menu "Параметр" 16 55 10 \
                        1 "Email для Let's Encrypt" \
                        2 "Порт frontend (apex)" \
                        3 "Домен GitLab" \
                        4 "Домен n8n" \
                        5 "Домен веб-интерфейса" \
                        6 "Домен почты Mailu" \
                        7 "DNS провайдер" \
                        8 "Показать все параметры" \
                        back "Назад" \
                        2> "$TMPFILE"
                    pr=$?
                    pchoice=$(cat "$TMPFILE" 2>/dev/null)
                    rm -f "$TMPFILE"
                    TMPFILE=""
                    [ $pr -ne 0 ] && break
                    case "$pchoice" in
                        1) prompt_and_save_dialog "letsencrypt_email" "Email для Let's Encrypt" "" >/dev/null ;;
                        2) prompt_and_save_dialog "site_port" "Порт frontend (apex)" "4001" >/dev/null ;;
                        3) prompt_and_save_dialog "gitlab_domain" "Домен GitLab" "" >/dev/null ;;
                        4) prompt_and_save_dialog "n8n_domain" "Домен n8n" "" >/dev/null ;;
                        5) prompt_and_save_dialog "ui_domain" "Домен веб-интерфейса" "" >/dev/null ;;
                        6) prompt_and_save_dialog "mail_domain" "Домен почты Mailu" "mail.example.com" >/dev/null ;;
                        7)
                            TMPFILE=$(mktemp)
                            dialog --clear --menu "DNS провайдер" 10 40 3 1 "Cloudflare" 2 "DigitalOcean" 3 "Локальный" 2> "$TMPFILE"
                            dp=$(cat "$TMPFILE" 2>/dev/null)
                            rm -f "$TMPFILE"
                            TMPFILE=""
                            case "$dp" in
                                1) save_config_value "dns_provider" "cloudflare"; save_config_value "dns_provider_choice" "1" ;;
                                2) save_config_value "dns_provider" "digitalocean"; save_config_value "dns_provider_choice" "2" ;;
                                3) save_config_value "dns_provider" "local"; save_config_value "dns_provider_choice" "3" ;;
                            esac
                            ;;
                        8)
                            msg="Email Let's Encrypt: $(get_config_value "letsencrypt_email")"
                            msg="$msg\nПорт frontend: $(get_config_value "site_port")"
                            msg="$msg\nПорт API: $(get_config_value "site_api_port")"
                            msg="$msg\nGitLab: $(get_config_value "gitlab_domain")"
                            msg="$msg\nn8n: $(get_config_value "n8n_domain")"
                            msg="$msg\nВеб-интерфейс: $(get_config_value "ui_domain")"
                            msg="$msg\nMailu: $(get_config_value "mail_domain")"
                            msg="$msg\nDNS: $(get_config_value "dns_provider")"
                            dialog --msgbox "$(printf '%b' "$msg")" 14 50
                            ;;
                        back) break ;;
                    esac
                done
                ;;
            domains)
                TMPFILE=$(mktemp)
                dialog --clear --backtitle "Настройка доменов" --menu "Режим доменов" 12 50 4 \
                    1 "Несколько базовых доменов (borisovai.ru, borisovai.tech)" \
                    2 "Один домен на сервис" \
                    3 "Показать текущие базовые домены" \
                    back "Назад" \
                    2> "$TMPFILE"
                dr=$?
                dchoice=$(cat "$TMPFILE" 2>/dev/null)
                rm -f "$TMPFILE"
                TMPFILE=""
                [ $dr -ne 0 ] && continue
                case "$dchoice" in
                    1)
                        base_def=$(get_config_value "base_domains")
                        TMPFILE=$(mktemp)
                        dialog --inputbox "Базовые домены через запятую" 8 60 "$base_def" 2> "$TMPFILE"
                        base_in=$(cat "$TMPFILE" 2>/dev/null | _sanitize_value)
                        rm -f "$TMPFILE"
                        TMPFILE=""
                        if [ -n "$base_in" ]; then
                            normalized=$(echo "$base_in" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | tr '\n' ',' | sed 's/,$//')
                            save_base_domains "$normalized"
                            dialog --msgbox "Базовые домены сохранены: $normalized" 6 50
                        fi
                        ;;
                    2)
                        save_config_value "base_domains" ""
                        dialog --msgbox "Режим: один домен на сервис (домены запросятся при установке)" 6 50
                        ;;
                    3)
                        base_list=$(get_base_domains 2>/dev/null | sed 's/^/  - /' || echo "  (не заданы)")
                        dialog --msgbox "Текущие базовые домены:\n\n$base_list" 12 45
                        ;;
                    back) ;;
                esac
                ;;
            all)
                INSTALL_TRAEFIK=y; INSTALL_GITLAB=y; INSTALL_N8N=y; INSTALL_MANAGEMENT_UI=y
                INSTALL_DNS_API=y; INSTALL_MAILU=y; INSTALL_CICD=y
                save_component_selection
                dialog --msgbox "Все компоненты включены." 5 40
                ;;
            show)
                sel=""
                [ "$INSTALL_TRAEFIK" = y ] && sel="${sel}[✓] Traefik\n" || sel="${sel}[ ] Traefik\n"
                [ "$INSTALL_GITLAB" = y ] && sel="${sel}[✓] GitLab\n" || sel="${sel}[ ] GitLab\n"
                [ "$INSTALL_N8N" = y ] && sel="${sel}[✓] n8n\n" || sel="${sel}[ ] n8n\n"
                [ "$INSTALL_MANAGEMENT_UI" = y ] && sel="${sel}[✓] Веб-интерфейс\n" || sel="${sel}[ ] Веб-интерфейс\n"
                [ "$INSTALL_DNS_API" = y ] && sel="${sel}[✓] DNS API\n" || sel="${sel}[ ] DNS API\n"
                [ "$INSTALL_MAILU" = y ] && sel="${sel}[✓] Mailu\n" || sel="${sel}[ ] Mailu\n"
                [ "$INSTALL_CICD" = y ] && sel="${sel}[✓] CI/CD\n" || sel="${sel}[ ] CI/CD\n"
                sel="${sel}\nДомены: $(domain_mode_summary)"
                dialog --msgbox "$(printf '%b' "$sel")" 14 45
                ;;
            done)
                if [ "$INSTALL_TRAEFIK" != "y" ]; then
                    dialog --msgbox "Ошибка: Traefik обязателен для работы других компонентов. Включите Traefik." 7 50
                    continue
                fi
                if [ "$INSTALL_GITLAB" != "y" ] && [ "$INSTALL_N8N" != "y" ] && [ "$INSTALL_MANAGEMENT_UI" != "y" ] && [ "$INSTALL_DNS_API" != "y" ] && [ "$INSTALL_MAILU" != "y" ] && [ "$INSTALL_CICD" != "y" ]; then
                    dialog --yesno "Выбран только Traefik. Продолжить?" 6 40 && break || continue
                fi
                break
                ;;
        esac
    done
    save_component_selection
else
# Текстовое меню (без dialog)
COMPONENT_MENU=true
while [ "$COMPONENT_MENU" = true ]; do
    show_component_menu
    show_selected_components
    
    read -p "Выберите действие (1-7, D, P, A, S, Q): " MENU_CHOICE
    MENU_CHOICE=$(echo "$MENU_CHOICE" | tr ',' ' ')
    for choice in $MENU_CHOICE; do
    case $choice in
        P|p)
            PARAMS_MENU=true
            while [ "$PARAMS_MENU" = true ]; do
                show_params_submenu
                read -p "Параметр (1-8 или Enter — назад): " PARAM_CHOICE
                case "$PARAM_CHOICE" in
                    1)
                        val=$(prompt_and_save "letsencrypt_email" "Email для Let's Encrypt")
                        [ -n "$val" ] && echo "  Сохранено."
                        ;;
                    2)
                        val=$(prompt_and_save "site_port" "Порт frontend (apex)" "4001")
                        [ -n "$val" ] && echo "  Сохранено."
                        ;;
                    3)
                        val=$(prompt_and_save "gitlab_domain" "Домен для GitLab (например, gitlab.example.com)")
                        [ -n "$val" ] && echo "  Сохранено."
                        ;;
                    4)
                        val=$(prompt_and_save "n8n_domain" "Домен для n8n (например, n8n.example.com)")
                        [ -n "$val" ] && echo "  Сохранено."
                        ;;
                    5)
                        val=$(prompt_and_save "ui_domain" "Домен веб-интерфейса (например, manage.example.com)")
                        [ -n "$val" ] && echo "  Сохранено."
                        ;;
                    6)
                        val=$(prompt_and_save "mail_domain" "Домен почты Mailu" "mail.example.com")
                        [ -n "$val" ] && echo "  Сохранено."
                        ;;
                    7)
                        echo "  1) Cloudflare  2) DigitalOcean  3) Локальный"
                        p7=$(prompt_and_save "dns_provider_choice" "Выбор (1-3)" "1")
                        case "$p7" in
                            1) save_config_value "dns_provider" "cloudflare"; save_config_value "dns_provider_choice" "1" ;;
                            2) save_config_value "dns_provider" "digitalocean"; save_config_value "dns_provider_choice" "2" ;;
                            3) save_config_value "dns_provider" "local"; save_config_value "dns_provider_choice" "3" ;;
                            *) [ -n "$p7" ] && echo "  Неизвестный выбор." ;;
                        esac
                        [ -n "$p7" ] && echo "  Сохранено."
                        ;;
                    8)
                        echo ""
                        params_summary | sed 's/^/  /'
                        echo ""
                        read -p "Нажмите Enter для продолжения..."
                        ;;
                    "")
                        PARAMS_MENU=false
                        ;;
                    *)
                        echo "  Неверный выбор."
                        ;;
                esac
            done
            ;;
        D|d)
            echo ""
            echo "=== Настройка доменов ==="
            echo "  1) Несколько базовых доменов (например borisovai.ru, borisovai.tech)"
            echo "  2) Один домен на каждый сервис (ввести домены позже)"
            echo "  3) Показать текущие базовые домены"
            echo "  Enter) Назад"
            read -p "Ваш выбор (1-3 или Enter): " DOMAIN_CHOICE
            case "$DOMAIN_CHOICE" in
                1)
                    current_base=$(get_config_value "base_domains")
                    read -p "Введите базовые домены через запятую [$current_base]: " BASE_INPUT
                    if [ -n "$BASE_INPUT" ]; then
                        normalized=$(echo "$BASE_INPUT" | tr ',' '\n' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//' | grep -v '^$' | tr '\n' ',' | sed 's/,$//')
                        save_base_domains "$normalized"
                        echo "  Базовые домены сохранены: $normalized"
                    else
                        [ -n "$current_base" ] && echo "  Без изменений: $current_base"
                    fi
                    ;;
                2)
                    save_config_value "base_domains" ""
                    echo "  Режим: один домен на сервис (домены запросятся при установке)"
                    ;;
                3)
                    if [ -n "$(get_config_value "base_domains")" ]; then
                        echo "  Текущие базовые домены:"
                        get_base_domains | while IFS= read -r d; do [ -n "$d" ] && echo "    - $d"; done
                    else
                        echo "  Сейчас: один домен на сервис"
                    fi
                    read -p "Нажмите Enter для продолжения..."
                    ;;
                *)
                    ;;
            esac
            ;;
        1)
            if [ "$INSTALL_TRAEFIK" = "y" ]; then
                INSTALL_TRAEFIK="n"
                echo "  Traefik: отключён"
            else
                INSTALL_TRAEFIK="y"
                echo "  Traefik: включён (обязательный компонент)"
            fi
            ;;
        2)
            if [ "$INSTALL_GITLAB" = "y" ]; then
                INSTALL_GITLAB="n"
                echo "  GitLab: отключён"
            else
                INSTALL_GITLAB="y"
                echo "  GitLab: включён"
            fi
            ;;
        3)
            if [ "$INSTALL_N8N" = "y" ]; then
                INSTALL_N8N="n"
                echo "  n8n: отключён"
            else
                INSTALL_N8N="y"
                echo "  n8n: включён"
            fi
            ;;
        4)
            if [ "$INSTALL_MANAGEMENT_UI" = "y" ]; then
                INSTALL_MANAGEMENT_UI="n"
                echo "  Веб-интерфейс управления: отключён"
            else
                INSTALL_MANAGEMENT_UI="y"
                echo "  Веб-интерфейс управления: включён"
            fi
            ;;
        5)
            if [ "$INSTALL_DNS_API" = "y" ]; then
                INSTALL_DNS_API="n"
                echo "  DNS API: отключён"
            else
                INSTALL_DNS_API="y"
                echo "  DNS API: включён"
            fi
            ;;
        6)
            if [ "$INSTALL_MAILU" = "y" ]; then
                INSTALL_MAILU="n"
                echo "  Mailu Mail Server: отключён"
            else
                INSTALL_MAILU="y"
                echo "  Mailu Mail Server: включён"
            fi
            ;;
        7)
            if [ "$INSTALL_CICD" = "y" ]; then
                INSTALL_CICD="n"
                echo "  CI/CD: отключён"
            else
                INSTALL_CICD="y"
                echo "  CI/CD: включён"
            fi
            ;;
        A|a)
            INSTALL_TRAEFIK="y"
            INSTALL_GITLAB="y"
            INSTALL_N8N="y"
            INSTALL_MANAGEMENT_UI="y"
            INSTALL_DNS_API="y"
            INSTALL_MAILU="y"
            INSTALL_CICD="y"
            echo "  Все компоненты: включены"
            ;;
        S|s)
            show_selected_components
            read -p "Нажмите Enter для продолжения..."
            ;;
        Q|q)
            # Traefik обязателен
            if [ "$INSTALL_TRAEFIK" != "y" ]; then
                echo ""
                echo "Ошибка: Traefik обязателен для работы других компонентов!"
                echo "Включите Traefik для продолжения."
                read -p "Нажмите Enter для продолжения..."
                continue
            fi
            
            # Проверка, что выбран хотя бы один компонент
            if [ "$INSTALL_GITLAB" != "y" ] && [ "$INSTALL_N8N" != "y" ] && [ "$INSTALL_MANAGEMENT_UI" != "y" ] && [ "$INSTALL_DNS_API" != "y" ] && [ "$INSTALL_MAILU" != "y" ] && [ "$INSTALL_CICD" != "y" ]; then
                echo ""
                echo "Предупреждение: Выбран только Traefik."
                read -p "Продолжить? (y/n): " CONTINUE_ONLY_TRAEFIK
                if [ "$CONTINUE_ONLY_TRAEFIK" != "y" ] && [ "$CONTINUE_ONLY_TRAEFIK" != "Y" ]; then
                    continue
                fi
            fi
            
            COMPONENT_MENU=false
            break
            ;;
        *)
            echo "  Неверный выбор. Попробуйте снова."
            sleep 1
            ;;
    esac
    done
    save_component_selection
done
fi

# Сохранение финального выбора
save_component_selection

# Вывод финального выбора
echo ""
echo "=== Финальный выбор компонентов ==="
show_selected_components
echo ""

# Функция для проверки и запроса переустановки отдельного сервиса
check_and_ask_reinstall() {
    local service_name="$1"
    local check_command="$2"
    local install_mode="${3:-auto}"  # По умолчанию auto
    
    if [ "$install_mode" = "force" ] || [ "$FORCE_MODE" = true ]; then
        return 0  # Переустановка принудительно включена
    fi
    
    if eval "$check_command" 2>/dev/null; then
        if [ "$install_mode" = "ask" ]; then
            echo ""
            read -p "  Сервис $service_name уже установлен. Переустановить? (y/n): " REINSTALL
            if [ "$REINSTALL" = "y" ] || [ "$REINSTALL" = "Y" ]; then
                return 0  # Переустановить
            else
                return 1  # Пропустить
            fi
        else
            # Режим auto: автоматически пропускаем
            return 1  # Пропустить
        fi
    fi
    return 0  # Не установлен, можно устанавливать
}

# Проверка системных требований
echo "[Проверка] Системные требования..."
TOTAL_RAM=$(free -g | awk '/^Mem:/{print $2}')
TOTAL_CPU=$(nproc)
TOTAL_DISK=$(df -h / | awk 'NR==2 {print $2}' | sed 's/G//' | sed 's/[^0-9]//g')

echo "  RAM: ${TOTAL_RAM}GB (требуется минимум 8GB)"
echo "  CPU: ${TOTAL_CPU} (требуется минимум 4)"
echo "  Диск: ${TOTAL_DISK}GB (требуется минимум 100GB)"

# Проверка доступности портов на конфликты
echo ""
echo "[Проверка] Проверка портов на конфликты..."
CONFLICTS_FOUND=0

check_port() {
    local port=$1
    local service=$2
    local in_use=0
    
    if command -v ss &> /dev/null; then
        in_use=$(ss -tuln 2>/dev/null | grep -c ":${port} " || echo "0")
    elif command -v netstat &> /dev/null; then
        in_use=$(netstat -tuln 2>/dev/null | grep -c ":${port} " || echo "0")
    else
        return 0
    fi
    
    if [ "$in_use" -gt 0 ]; then
        echo "  [КОНФЛИКТ] Порт $port используется другим процессом (для $service)"
        if command -v ss &> /dev/null; then
            ss -tulnp 2>/dev/null | grep ":${port} " | head -3 || true
        elif command -v netstat &> /dev/null; then
            netstat -tulnp 2>/dev/null | grep ":${port} " | head -3 || true
        fi
        CONFLICTS_FOUND=1
    else
        echo "  [OK] Порт $port свободен (для $service)"
    fi
}

if command -v ss &> /dev/null || command -v netstat &> /dev/null; then
    echo "Проверка портов сервисов:"
    check_port 80 "Traefik (HTTP)"
    check_port 443 "Traefik (HTTPS)"
    check_port 8080 "Traefik (Dashboard)"
    check_port 8888 "GitLab"
    check_port 5678 "n8n"
    check_port 3000 "Management UI"
    check_port 5353 "Local DNS API"
    check_port 53 "dnsmasq (DNS)"
    
    if [ "$CONFLICTS_FOUND" -eq 1 ]; then
        echo ""
        echo "  ВНИМАНИЕ: Обнаружены конфликты портов!"
        echo "  Рекомендуется освободить занятые порты перед установкой"
        read -p "  Продолжить установку? (y/n): " CONTINUE_PORT
        if [ "$CONTINUE_PORT" != "y" ] && [ "$CONTINUE_PORT" != "Y" ]; then
            exit 1
        fi
    else
        echo ""
        echo "  [OK] Конфликтов портов не обнаружено"
    fi
else
    echo "  [Пропуск] Утилиты ss или netstat не найдены, проверка портов пропущена"
fi

if [ "$TOTAL_RAM" -lt 8 ]; then
    echo ""
    echo "ПРЕДУПРЕЖДЕНИЕ: Рекомендуется минимум 8GB RAM"
    echo "Текущая конфигурация может работать медленно"
    read -p "Продолжить? (y/n): " CONTINUE
    if [ "$CONTINUE" != "y" ] && [ "$CONTINUE" != "Y" ]; then
        exit 1
    fi
fi

# Определение корневой директории установки (где находится management-ui)
# Ожидается структура: ~/install/scripts/single-machine/install-all.sh
#                     ~/install/management-ui/
INSTALL_ROOT="$(dirname "$SCRIPT_DIR")"

# Инициализация состояния установки
init_install_state

# Вывод информации о режиме
if [ "$CONTINUE_MODE" = true ]; then
    echo "Режим: Продолжение установки"
    echo "Пропущенные шаги будут выполнены"
    echo ""
elif [ "$FORCE_MODE" = true ]; then
    echo "Режим: Принудительная переустановка"
    echo "Все компоненты будут переустановлены"
    echo ""
elif [ "$INSTALL_MODE" = "ask" ]; then
    echo "Режим: Интерактивный"
    echo "Будут запрошены подтверждения для уже установленных компонентов"
    echo ""
else
    echo "Режим: Автоматический (только новые компоненты)"
    echo "Уже установленные компоненты будут пропущены"
    echo ""
fi

# Сбор конфигурации
echo ""
echo "=== Конфигурация ==="
echo ""

# Traefik всегда нужен для Let's Encrypt
LETSENCRYPT_EMAIL=$(prompt_and_save "letsencrypt_email" "Email для Let's Encrypt")
if [ -z "$LETSENCRYPT_EMAIL" ]; then
    echo "Ошибка: Email обязателен для Let's Encrypt"
    exit 1
fi

# Режим базовых доменов: домены строятся из base_domains
USE_BASE_DOMAINS=false
[ -n "$(get_config_value "base_domains")" ] && USE_BASE_DOMAINS=true

if [ "$USE_BASE_DOMAINS" = true ]; then
    save_config_value "gitlab_prefix" "gitlab"
    save_config_value "n8n_prefix" "n8n"
    save_config_value "ui_prefix" "ui"
    save_config_value "mail_prefix" "mail"
    GITLAB_DOMAIN=$(build_service_domains "gitlab" | head -1)
    N8N_DOMAIN=$(build_service_domains "n8n" | head -1)
    UI_DOMAIN=$(build_service_domains "ui" | head -1)
    echo "Используются базовые домены: $(domain_mode_summary)"
    echo "  GitLab: $GITLAB_DOMAIN"
    echo "  n8n: $N8N_DOMAIN"
    echo "  Веб-интерфейс: $UI_DOMAIN"
    read -p "Включить сайт Next.js (apex + api) на всех доменах? (y/n) [n]: " SITE_CHOICE
    if [ "$SITE_CHOICE" = "y" ] || [ "$SITE_CHOICE" = "Y" ]; then
        SITE_PORT=$(prompt_and_save "site_port" "Порт frontend (apex)" "4001")
        [ -z "$SITE_PORT" ] && save_config_value "site_port" "4001"
        SITE_API=$(prompt_and_save "site_api_port" "Порт API (api.*)" "4002")
        [ -z "$SITE_API" ] && save_config_value "site_api_port" "4002"
    fi
else
    GITLAB_DOMAIN=""
    N8N_DOMAIN=""
    UI_DOMAIN=""
fi

# Конфигурация для GitLab (если не базовые домены)
if [ "$INSTALL_GITLAB" = "y" ] && [ "$USE_BASE_DOMAINS" != true ]; then
    GITLAB_DOMAIN=$(prompt_and_save "gitlab_domain" "Домен для GitLab (например, gitlab.example.com)")
    if [ -z "$GITLAB_DOMAIN" ]; then
        echo "Ошибка: Домен GitLab обязателен"
        exit 1
    fi
fi

# Конфигурация для n8n (если не базовые домены)
if [ "$INSTALL_N8N" = "y" ] && [ "$USE_BASE_DOMAINS" != true ]; then
    N8N_DOMAIN=$(prompt_and_save "n8n_domain" "Домен для n8n (например, n8n.example.com)")
    if [ -z "$N8N_DOMAIN" ]; then
        echo "Ошибка: Домен n8n обязателен"
        exit 1
    fi
fi

# Конфигурация для веб-интерфейса управления (если не базовые домены)
if [ "$INSTALL_MANAGEMENT_UI" = "y" ] && [ "$USE_BASE_DOMAINS" != true ]; then
    UI_DOMAIN=$(prompt_and_save "ui_domain" "Домен для веб-интерфейса управления (например, manage.example.com)")
    if [ -z "$UI_DOMAIN" ]; then
        echo "Ошибка: Домен веб-интерфейса обязателен"
        exit 1
    fi
fi

# Конфигурация для DNS API
DNS_PROVIDER=""
if [ "$INSTALL_DNS_API" = "y" ]; then
    echo ""
    echo "Выберите DNS провайдера:"
    echo "1) Cloudflare"
    echo "2) DigitalOcean"
    echo "3) Локальный DNS API"
    DNS_CHOICE=$(prompt_choice_and_save "dns_provider_choice" "Ваш выбор (1-3)")
    case $DNS_CHOICE in
        1) DNS_PROVIDER="cloudflare" ;;
        2) DNS_PROVIDER="digitalocean" ;;
        3) DNS_PROVIDER="local" ;;
        *) DNS_PROVIDER="" ;;
    esac
    if [ -n "$DNS_PROVIDER" ]; then
        save_config_value "dns_provider" "$DNS_PROVIDER"
    fi
fi

# Конфигурация для Mailu
MAIL_DOMAIN=""
if [ "$INSTALL_MAILU" = "y" ]; then
    if [ "$USE_BASE_DOMAINS" = true ]; then
        MAIL_DOMAIN=$(build_service_domains "mail" | head -1)
        echo "  Mailu: $MAIL_DOMAIN"
    else
        MAIL_DOMAIN=$(prompt_and_save "mail_domain" "Домен для почты (например, mail.borisovai.ru)" "mail.borisovai.ru")
        if [ -z "$MAIL_DOMAIN" ]; then
            echo "Ошибка: Домен для почты обязателен"
            exit 1
        fi
    fi
fi

# Вывод конфигурации
echo ""
echo "=== Итоговая конфигурация ==="
echo "  Let's Encrypt email: $LETSENCRYPT_EMAIL"
if [ "$USE_BASE_DOMAINS" = true ]; then
    echo "  Режим доменов: несколько базовых ($(domain_mode_summary))"
fi
if [ "$INSTALL_GITLAB" = "y" ]; then
    echo "  GitLab домен: $GITLAB_DOMAIN"
fi
if [ "$INSTALL_N8N" = "y" ]; then
    echo "  n8n домен: $N8N_DOMAIN"
fi
if [ "$INSTALL_MANAGEMENT_UI" = "y" ]; then
    echo "  Веб-интерфейс домен: $UI_DOMAIN"
fi
if [ "$INSTALL_DNS_API" = "y" ] && [ -n "$DNS_PROVIDER" ]; then
    echo "  DNS API: будет настроен ($DNS_PROVIDER)"
fi
if [ "$INSTALL_MAILU" = "y" ] && [ -n "$MAIL_DOMAIN" ]; then
    echo "  Mailu Mail Server: будет установлен ($MAIL_DOMAIN)"
fi
if [ "$INSTALL_CICD" = "y" ]; then
    echo "  CI/CD: будет настроен"
fi
if [ "$USE_BASE_DOMAINS" = true ] && [ -n "$(get_config_value "site_port")" ]; then
    FP=$(get_config_value "site_port"); AP=$(get_config_value "site_api_port")
    [ -z "$AP" ] && AP="4002"
    echo "  Сайт: frontend порт ${FP:-4001}, API порт $AP (apex + api на всех доменах)"
fi
echo ""
read -p "Продолжить установку? (y/n): " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    exit 1
fi

# Сохранение конфигурации
CONFIG_FILE="/tmp/install-config.env"
cat > "$CONFIG_FILE" << EOF
GITLAB_DOMAIN=$GITLAB_DOMAIN
N8N_DOMAIN=$N8N_DOMAIN
UI_DOMAIN=$UI_DOMAIN
LETSENCRYPT_EMAIL=$LETSENCRYPT_EMAIL
DNS_PROVIDER=$DNS_PROVIDER
EOF

# Обновление системы
echo ""
echo "=== [1/10] Обновление системы ==="
STEP_NAME="system_update"
if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME"; then
    echo "  [Пропуск] Обновление системы уже выполнено"
else
    save_install_state "$STEP_NAME" "in_progress"
    export DEBIAN_FRONTEND=noninteractive
    if safe_execute "$STEP_NAME" "apt-get update && apt-get upgrade -y"; then
        echo "  [OK] Система обновлена"
    else
        echo "  [ОШИБКА] Не удалось обновить систему"
        if [ "$CONTINUE_MODE" != true ]; then
            echo "Используйте --continue для продолжения"
            exit 1
        fi
    fi
fi

# Установка базовых пакетов
echo ""
echo "=== [2/10] Установка базовых пакетов ==="
STEP_NAME="base_packages"
if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME"; then
    echo "  [Пропуск] Базовые пакеты уже установлены"
else
    save_install_state "$STEP_NAME" "in_progress"
    if safe_execute "$STEP_NAME" "apt-get install -y curl wget git unzip jq ufw"; then
        echo "  [OK] Базовые пакеты установлены"
    else
        echo "  [ОШИБКА] Не удалось установить базовые пакеты"
        if [ "$CONTINUE_MODE" != true ]; then
            echo "Используйте --continue для продолжения"
            exit 1
        fi
    fi
fi

# Настройка firewall
echo ""
echo "=== [3/10] Настройка firewall ==="
STEP_NAME="firewall"
if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME"; then
    echo "  [Пропуск] Firewall уже настроен"
else
    save_install_state "$STEP_NAME" "in_progress"
    if command -v ufw &> /dev/null; then
        if safe_execute "$STEP_NAME" "ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable"; then
            echo "  [OK] Firewall настроен: порты 22, 80, 443 открыты"
        else
            echo "  [ОШИБКА] Не удалось настроить firewall"
            if [ "$CONTINUE_MODE" != true ]; then
                echo "Используйте --continue для продолжения"
                exit 1
            fi
        fi
    else
        echo "  [Пропуск] UFW не установлен, настройте firewall вручную"
        save_install_state "$STEP_NAME" "completed"
    fi
fi

# Установка Traefik
if [ "$INSTALL_TRAEFIK" = "y" ]; then
    echo ""
    echo "=== [4/10] Установка Traefik ==="
    STEP_NAME="traefik"
    SERVICE_FORCE_MODE=false
    if check_and_ask_reinstall "Traefik" "is_service_installed traefik.service" "$INSTALL_MODE"; then
        SERVICE_FORCE_MODE=true
    fi

    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$SERVICE_FORCE_MODE" != true ]; then
        echo "  [Пропуск] Traefik уже установлен"
    else
        if [ "$SERVICE_FORCE_MODE" = true ]; then
            save_install_state "$STEP_NAME" "in_progress"
            if [ -f "$SCRIPT_DIR/install-traefik.sh" ]; then
                bash "$SCRIPT_DIR/install-traefik.sh" "$LETSENCRYPT_EMAIL" --force
                if [ $? -eq 0 ]; then
                    save_install_state "$STEP_NAME" "completed"
                    echo "  [OK] Traefik установлен"
                else
                    echo "  [ОШИБКА] Не удалось установить Traefik"
                    if [ "$CONTINUE_MODE" != true ]; then
                        echo "Используйте --continue для продолжения"
                        exit 1
                    fi
                fi
            else
                echo "  [ОШИБКА] Скрипт install-traefik.sh не найден"
                exit 1
            fi
        else
            if [ "$INSTALL_MODE" = "ask" ]; then
                echo "  [Пропуск] Traefik уже установлен (пользователь отказался от переустановки)"
            else
                echo "  [Пропуск] Traefik уже установлен"
            fi
        fi
    fi
else
    echo ""
    echo "=== [4/10] Установка Traefik ==="
    echo "  [Пропуск] Traefik не выбран для установки"
    save_install_state "traefik" "completed"
fi

# Настройка DNS API (если нужно)
echo ""
echo "=== [5/10] Настройка DNS API ==="
STEP_NAME="dns_api"
if [ "$INSTALL_DNS_API" = "y" ] && [ -n "$DNS_PROVIDER" ]; then
    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$FORCE_MODE" != true ]; then
        echo "  [Пропуск] DNS API уже настроен"
    else
        save_install_state "$STEP_NAME" "in_progress"
        if [ -f "$SCRIPT_DIR/setup-dns-api.sh" ]; then
            bash "$SCRIPT_DIR/setup-dns-api.sh" "$DNS_PROVIDER"
            if [ $? -eq 0 ]; then
                save_install_state "$STEP_NAME" "completed"
                echo "  [OK] DNS API настроен"
            else
                echo "  [ОШИБКА] Не удалось настроить DNS API"
                if [ "$CONTINUE_MODE" != true ]; then
                    echo "Используйте --continue для продолжения"
                    exit 1
                fi
            fi
        else
            echo "  [Предупреждение] Скрипт setup-dns-api.sh не найден, пропускаем"
            save_install_state "$STEP_NAME" "completed"
        fi
    fi
else
    echo "  [Пропуск] DNS API не выбран"
    save_install_state "$STEP_NAME" "completed"
fi

# Установка GitLab
if [ "$INSTALL_GITLAB" = "y" ]; then
    echo ""
    echo "=== [6/10] Установка GitLab ==="
    STEP_NAME="gitlab"
    SERVICE_FORCE_MODE=false
    if check_and_ask_reinstall "GitLab" "is_package_installed gitlab-ce || is_service_installed gitlab-runsvdir" "$INSTALL_MODE"; then
        SERVICE_FORCE_MODE=true
    fi

    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$SERVICE_FORCE_MODE" != true ]; then
        echo "  [Пропуск] GitLab уже установлен"
    else
        # Формирование аргументов для install-gitlab.sh
        # Передаем только непустые значения, чтобы избежать проблем с парсингом
        GITLAB_ARGS=()
        [ -n "$GITLAB_DOMAIN" ] && GITLAB_ARGS+=("$GITLAB_DOMAIN")
        [ -n "$LETSENCRYPT_EMAIL" ] && GITLAB_ARGS+=("$LETSENCRYPT_EMAIL")
        [ "$SERVICE_FORCE_MODE" = true ] && GITLAB_ARGS+=("--force")
        
        save_install_state "$STEP_NAME" "in_progress"
        if [ -f "$SCRIPT_DIR/install-gitlab.sh" ]; then
            bash "$SCRIPT_DIR/install-gitlab.sh" "${GITLAB_ARGS[@]}"
            if [ $? -eq 0 ]; then
                save_install_state "$STEP_NAME" "completed"
                echo "  [OK] GitLab установлен"
            else
                echo "  [ОШИБКА] Не удалось установить GitLab"
                if [ "$CONTINUE_MODE" != true ]; then
                    echo "Используйте --continue для продолжения"
                    exit 1
                fi
            fi
        else
            echo "  [ОШИБКА] Скрипт install-gitlab.sh не найден"
            exit 1
        fi
    fi
else
    echo ""
    echo "=== [6/10] Установка GitLab ==="
    echo "  [Пропуск] GitLab не выбран для установки"
    save_install_state "gitlab" "completed"
fi

# Настройка CI/CD (опционально)
if [ "$INSTALL_CICD" = "y" ]; then
    echo ""
    echo "=== [6.5/10] Настройка CI/CD ==="
    STEP_NAME="cicd_setup"
    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$FORCE_MODE" != true ]; then
        echo "  [Пропуск] CI/CD уже настроен"
    else
        save_install_state "$STEP_NAME" "in_progress"
        
        # Установка GitLab Runner
        if [ -f "$SCRIPT_DIR/install-gitlab-runner.sh" ]; then
            echo "  Установка GitLab Runner..."
            bash "$SCRIPT_DIR/install-gitlab-runner.sh"
            if [ $? -ne 0 ]; then
                echo "  [ОШИБКА] Не удалось установить GitLab Runner"
                if [ "$CONTINUE_MODE" != true ]; then
                    echo "Используйте --continue для продолжения"
                    exit 1
                fi
            fi
        fi
        
        # Настройка CI/CD
        if [ -f "$SCRIPT_DIR/setup-cicd.sh" ]; then
            echo "  Настройка CI/CD..."
            bash "$SCRIPT_DIR/setup-cicd.sh"
            if [ $? -eq 0 ]; then
                save_install_state "$STEP_NAME" "completed"
                echo "  [OK] CI/CD настроен"
            else
                echo "  [ОШИБКА] Не удалось настроить CI/CD"
                if [ "$CONTINUE_MODE" != true ]; then
                    echo "Используйте --continue для продолжения"
                    exit 1
                fi
            fi
        else
            echo "  [ОШИБКА] Скрипт setup-cicd.sh не найден"
        fi
    fi
else
    echo "  [Пропуск] CI/CD не выбран"
    save_install_state "$STEP_NAME" "completed"
fi

# Установка n8n
if [ "$INSTALL_N8N" = "y" ]; then
    echo ""
    echo "=== [7/10] Установка n8n ==="
    STEP_NAME="n8n"
    SERVICE_FORCE_MODE=false
    if check_and_ask_reinstall "n8n" "is_service_installed n8n.service" "$INSTALL_MODE"; then
        SERVICE_FORCE_MODE=true
    fi

    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$SERVICE_FORCE_MODE" != true ]; then
        echo "  [Пропуск] n8n уже установлен"
    else
        if [ "$SERVICE_FORCE_MODE" = true ]; then
            save_install_state "$STEP_NAME" "in_progress"
            if [ -f "$SCRIPT_DIR/install-n8n.sh" ]; then
                bash "$SCRIPT_DIR/install-n8n.sh" "$N8N_DOMAIN" --force
                if [ $? -eq 0 ]; then
                    save_install_state "$STEP_NAME" "completed"
                    echo "  [OK] n8n установлен"
                else
                    echo "  [ОШИБКА] Не удалось установить n8n"
                    if [ "$CONTINUE_MODE" != true ]; then
                        echo "Используйте --continue для продолжения"
                        exit 1
                    fi
                fi
            else
                echo "  [ОШИБКА] Скрипт install-n8n.sh не найден"
                exit 1
            fi
        else
            if [ "$INSTALL_MODE" = "ask" ]; then
                echo "  [Пропуск] n8n уже установлен (пользователь отказался от переустановки)"
            else
                echo "  [Пропуск] n8n уже установлен"
            fi
        fi
    fi
else
    echo ""
    echo "=== [7/10] Установка n8n ==="
    echo "  [Пропуск] n8n не выбран для установки"
    save_install_state "n8n" "completed"
fi

# Установка веб-интерфейса
if [ "$INSTALL_MANAGEMENT_UI" = "y" ]; then
    echo ""
    echo "=== [8/10] Установка веб-интерфейса управления ==="
    STEP_NAME="management_ui"
    SERVICE_FORCE_MODE=false
    if check_and_ask_reinstall "Management UI" "is_service_installed management-ui.service" "$INSTALL_MODE"; then
        SERVICE_FORCE_MODE=true
    fi

    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$SERVICE_FORCE_MODE" != true ]; then
        echo "  [Пропуск] Веб-интерфейс уже установлен"
    else
        if [ "$SERVICE_FORCE_MODE" = true ]; then
            save_install_state "$STEP_NAME" "in_progress"
            if [ -f "$SCRIPT_DIR/install-management-ui.sh" ]; then
                # Передаем путь к корневой директории установки для поиска management-ui
                bash "$SCRIPT_DIR/install-management-ui.sh" "$INSTALL_ROOT" --force
                if [ $? -eq 0 ]; then
                    save_install_state "$STEP_NAME" "completed"
                    echo "  [OK] Веб-интерфейс установлен"
                else
                    echo "  [ОШИБКА] Не удалось установить веб-интерфейс управления"
                    echo "Убедитесь, что директория management-ui загружена на сервер"
                    echo "Ожидаемое расположение: $INSTALL_ROOT/management-ui"
                    if [ "$CONTINUE_MODE" != true ]; then
                        echo "Используйте --continue для продолжения"
                        exit 1
                    fi
                fi
            else
                echo "  [ОШИБКА] Скрипт install-management-ui.sh не найден"
                exit 1
            fi
        else
            if [ "$INSTALL_MODE" = "ask" ]; then
                echo "  [Пропуск] Веб-интерфейс уже установлен (пользователь отказался от переустановки)"
            else
                echo "  [Пропуск] Веб-интерфейс уже установлен"
            fi
        fi
    fi
else
    echo ""
    echo "=== [8/10] Установка веб-интерфейса управления ==="
    echo "  [Пропуск] Веб-интерфейс не выбран для установки"
    save_install_state "management_ui" "completed"
fi

# Установка Mailu Mail Server (если выбрано)
if [ "$INSTALL_MAILU" = "y" ] && [ -n "$MAIL_DOMAIN" ]; then
    echo ""
    echo "=== [9/10] Установка Mailu Mail Server ==="
    STEP_NAME="mailu"
    if ! command -v docker &> /dev/null; then
        echo "  [ИНФОРМАЦИЯ] Docker будет установлен автоматически при установке Mailu"
    fi
    SERVICE_FORCE_MODE=false
    if check_and_ask_reinstall "Mailu Mail Server" "is_service_installed mailu.service" "$INSTALL_MODE"; then
        SERVICE_FORCE_MODE=true
    fi

    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$SERVICE_FORCE_MODE" != true ]; then
        echo "  [Пропуск] Mailu уже установлен"
    elif [ "$SERVICE_FORCE_MODE" = true ] || ! is_step_completed "$STEP_NAME" 2>/dev/null; then
        save_install_state "$STEP_NAME" "in_progress"
        if [ -f "$SCRIPT_DIR/install-mailu.sh" ]; then
            MAILU_ARGS=("$MAIL_DOMAIN" "$LETSENCRYPT_EMAIL")
            [ "$SERVICE_FORCE_MODE" = true ] && MAILU_ARGS+=("--force")
            bash "$SCRIPT_DIR/install-mailu.sh" "${MAILU_ARGS[@]}"
            if [ $? -eq 0 ]; then
                save_install_state "$STEP_NAME" "completed"
                echo "  [OK] Mailu установлен"
            else
                echo "  [ОШИБКА] Не удалось установить Mailu"
                if [ "$CONTINUE_MODE" != true ]; then
                    echo "Используйте --continue для продолжения"
                    exit 1
                fi
            fi
        else
            echo "  [ОШИБКА] Скрипт install-mailu.sh не найден"
            exit 1
        fi
    else
        if [ "$INSTALL_MODE" = "ask" ]; then
            echo "  [Пропуск] Mailu уже установлен (пользователь отказался от переустановки)"
        else
            echo "  [Пропуск] Mailu уже установлен"
        fi
    fi
else
    echo "  [Пропуск] Mailu Mail Server не выбран"
    save_install_state "$STEP_NAME" "completed"
fi

# Конфигурация Traefik для всех сервисов
echo ""
echo "=== [10/11] Конфигурация Traefik для всех сервисов ==="
STEP_NAME="configure_traefik"
# Настраиваем Traefik только если установлен хотя бы один сервис, который его использует
if [ "$INSTALL_GITLAB" = "y" ] || [ "$INSTALL_N8N" = "y" ] || [ "$INSTALL_MANAGEMENT_UI" = "y" ]; then
    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$FORCE_MODE" != true ]; then
        echo "  [Пропуск] Traefik уже настроен"
    else
        save_install_state "$STEP_NAME" "in_progress"
        if [ -f "$SCRIPT_DIR/configure-traefik.sh" ]; then
            TRAEFIK_EXIT=1
            TRAEFIK_RAN=false
            if [ -n "$(get_config_value "base_domains")" ]; then
                bash "$SCRIPT_DIR/configure-traefik.sh"
                TRAEFIK_EXIT=$?
                TRAEFIK_RAN=true
            else
                TRAEFIK_ARGS=()
                [ -n "$GITLAB_DOMAIN" ] && TRAEFIK_ARGS+=("$GITLAB_DOMAIN")
                [ -n "$N8N_DOMAIN" ] && TRAEFIK_ARGS+=("$N8N_DOMAIN")
                [ -n "$UI_DOMAIN" ] && TRAEFIK_ARGS+=("$UI_DOMAIN")
                if [ ${#TRAEFIK_ARGS[@]} -gt 0 ]; then
                    bash "$SCRIPT_DIR/configure-traefik.sh" "${TRAEFIK_ARGS[@]}"
                    TRAEFIK_EXIT=$?
                    TRAEFIK_RAN=true
                fi
            fi
            if [ "$TRAEFIK_RAN" = true ]; then
                if [ "$TRAEFIK_EXIT" -eq 0 ]; then
                    save_install_state "$STEP_NAME" "completed"
                    echo "  [OK] Traefik настроен"
                else
                    echo "  [ОШИБКА] Не удалось настроить Traefik"
                    if [ "$CONTINUE_MODE" != true ]; then
                        echo "Используйте --continue для продолжения"
                        exit 1
                    fi
                fi
            else
                echo "  [Пропуск] Нет сервисов для настройки Traefik"
                save_install_state "$STEP_NAME" "completed"
            fi
        else
            echo "  [ОШИБКА] Скрипт configure-traefik.sh не найден"
            exit 1
        fi
    fi
else
    echo "  [Пропуск] Нет сервисов для настройки Traefik"
    save_install_state "$STEP_NAME" "completed"
fi

# Конфигурация Traefik для деплоя (опционально)
if [ "$INSTALL_CICD" = "y" ]; then
    echo ""
    echo "=== [11/11] Конфигурация Traefik для деплоя ==="
    STEP_NAME="traefik_deploy_config"
    CONFIGURE_DEPLOY_CHOICE=$(prompt_choice_and_save "configure_deploy_traefik_choice" "Настроить Traefik для frontend/backend деплоя? (y/n)" "n")
    if [ "$CONFIGURE_DEPLOY_CHOICE" = "y" ] || [ "$CONFIGURE_DEPLOY_CHOICE" = "Y" ]; then
        if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$FORCE_MODE" != true ]; then
            echo "  [Пропуск] Traefik для деплоя уже настроен"
        else
            save_install_state "$STEP_NAME" "in_progress"
            if [ -f "$SCRIPT_DIR/configure-traefik-deploy.sh" ]; then
                bash "$SCRIPT_DIR/configure-traefik-deploy.sh"
                if [ $? -eq 0 ]; then
                    save_install_state "$STEP_NAME" "completed"
                    echo "  [OK] Traefik для деплоя настроен"
                else
                    echo "  [ОШИБКА] Не удалось настроить Traefik для деплоя"
                    if [ "$CONTINUE_MODE" != true ]; then
                        echo "Используйте --continue для продолжения"
                        exit 1
                    fi
                fi
            else
                echo "  [ОШИБКА] Скрипт configure-traefik-deploy.sh не найден"
            fi
        fi
    else
        echo "  [Пропуск] Настройка Traefik для деплоя не выбрана"
        save_install_state "$STEP_NAME" "completed"
    fi
else
    echo ""
    echo "=== [11/11] Конфигурация Traefik для деплоя ==="
    echo "  [Пропуск] CI/CD не выбран, пропуск настройки Traefik для деплоя"
    save_install_state "traefik_deploy_config" "completed"
fi

# Исправление Path MTU (GZIP compress + TCP MTU Probing) для Mailu и Traefik
echo ""
echo "=== [12/12] Исправление Path MTU (GZIP + sysctl) ==="
STEP_NAME="fix_mtu"
if [ "$INSTALL_TRAEFIK" = "y" ] && [ -f "$SCRIPT_DIR/fix-mtu-issue.sh" ]; then
    if [ "$CONTINUE_MODE" = true ] && is_step_completed "$STEP_NAME" && [ "$FORCE_MODE" != true ]; then
        echo "  [Пропуск] Фикс Path MTU уже применён"
    else
        save_install_state "$STEP_NAME" "in_progress"
        if bash "$SCRIPT_DIR/fix-mtu-issue.sh"; then
            save_install_state "$STEP_NAME" "completed"
            echo "  [OK] Path MTU исправлен (compress + tcp_mtu_probing + TCP MSS)"
        else
            echo "  [Предупреждение] fix-mtu-issue.sh завершился с ошибкой, проверьте вручную"
        fi
    fi
else
    echo "  [Пропуск] Traefik не выбран или fix-mtu-issue.sh не найден"
    save_install_state "$STEP_NAME" "completed"
fi

# Финальная проверка
echo ""
echo "=== Проверка установленных сервисов ==="
echo "Ожидание запуска всех сервисов..."
sleep 10

echo ""
echo "Статус сервисов:"
TRAEFIK_OK=false
GITLAB_OK=false
N8N_OK=false
UI_OK=false
MAILU_OK=false
CICD_OK=false

if [ "$INSTALL_TRAEFIK" = "y" ]; then
    if systemctl is-active --quiet traefik; then
        echo "  ✓ Traefik - запущен"
        TRAEFIK_OK=true
    else
        echo "  ✗ Traefik - не запущен (проверьте: systemctl status traefik)"
    fi
fi

if [ "$INSTALL_GITLAB" = "y" ]; then
    if systemctl is-active --quiet gitlab-runsvdir; then
        echo "  ✓ GitLab - запущен"
        GITLAB_OK=true
    else
        echo "  ✗ GitLab - не запущен (проверьте: gitlab-ctl status)"
    fi
fi

if [ "$INSTALL_N8N" = "y" ]; then
    if systemctl is-active --quiet n8n; then
        echo "  ✓ n8n - запущен"
        N8N_OK=true
    else
        echo "  ✗ n8n - не запущен (проверьте: systemctl status n8n)"
    fi
fi

if [ "$INSTALL_MANAGEMENT_UI" = "y" ]; then
    if systemctl is-active --quiet management-ui; then
        echo "  ✓ Веб-интерфейс - запущен"
        UI_OK=true
    else
        echo "  ✗ Веб-интерфейс - не запущен (проверьте: systemctl status management-ui)"
    fi
fi

if [ "$INSTALL_MAILU" = "y" ] && [ -n "$MAIL_DOMAIN" ]; then
    if systemctl is-active --quiet mailu; then
        echo "  ✓ Mailu Mail Server - запущен"
        MAILU_OK=true
    else
        echo "  ✗ Mailu Mail Server - не запущен (проверьте: systemctl status mailu)"
    fi
fi

if [ "$INSTALL_CICD" = "y" ]; then
    if systemctl is-active --quiet gitlab-runner; then
        echo "  ✓ GitLab Runner - запущен"
        CICD_OK=true
    else
        echo "  ✗ GitLab Runner - не запущен (проверьте: systemctl status gitlab-runner)"
    fi
fi

# Проверка наличия ошибок только для установленных компонентов
HAS_ERRORS=false
if [ "$INSTALL_TRAEFIK" = "y" ] && [ "$TRAEFIK_OK" = false ]; then
    HAS_ERRORS=true
fi
if [ "$INSTALL_GITLAB" = "y" ] && [ "$GITLAB_OK" = false ]; then
    HAS_ERRORS=true
fi
if [ "$INSTALL_N8N" = "y" ] && [ "$N8N_OK" = false ]; then
    HAS_ERRORS=true
fi
if [ "$INSTALL_MANAGEMENT_UI" = "y" ] && [ "$UI_OK" = false ]; then
    HAS_ERRORS=true
fi
if [ "$INSTALL_MAILU" = "y" ] && [ -n "$MAIL_DOMAIN" ] && [ "$MAILU_OK" = false ]; then
    HAS_ERRORS=true
fi
if [ "$INSTALL_CICD" = "y" ] && [ "$CICD_OK" = false ]; then
    HAS_ERRORS=true
fi

if [ "$HAS_ERRORS" = true ]; then
    echo ""
    echo "ВНИМАНИЕ: Некоторые сервисы не запущены!"
    echo "Проверьте логи и статус сервисов перед использованием."
fi

echo ""
echo "=========================================="
if [ "$ERROR_OCCURRED" = true ]; then
    echo "  Установка завершена с ошибками"
    echo "=========================================="
    echo ""
    echo "Используйте --continue для продолжения установки"
    echo ""
    exit 1
else
    echo "  Установка завершена!"
    echo "=========================================="
    echo ""
fi
echo "Доступ к сервисам:"
if [ "$INSTALL_TRAEFIK" = "y" ]; then
    echo "  - Traefik Dashboard: http://localhost:8080"
fi
if [ "$INSTALL_GITLAB" = "y" ] && [ -n "$GITLAB_DOMAIN" ]; then
    echo "  - GitLab: https://$GITLAB_DOMAIN"
fi
if [ "$INSTALL_N8N" = "y" ] && [ -n "$N8N_DOMAIN" ]; then
    echo "  - n8n: https://$N8N_DOMAIN"
fi
if [ "$INSTALL_MANAGEMENT_UI" = "y" ] && [ -n "$UI_DOMAIN" ]; then
    echo "  - Веб-интерфейс управления: https://$UI_DOMAIN"
fi
if [ "$INSTALL_MAILU" = "y" ] && [ -n "$MAIL_DOMAIN" ]; then
    echo "  - Mailu Mail Server: https://$MAIL_DOMAIN и https://$MAIL_DOMAIN/admin"
fi
if [ "$INSTALL_CICD" = "y" ]; then
    FRONTEND_DOMAIN=$(get_config_value "frontend_domain")
    BACKEND_DOMAIN=$(get_config_value "backend_domain")
    if [ -n "$FRONTEND_DOMAIN" ] && [ -n "$BACKEND_DOMAIN" ]; then
        echo "  - Frontend: https://$FRONTEND_DOMAIN"
        echo "  - Backend API: https://$BACKEND_DOMAIN"
    fi
fi
echo ""
echo "Порты сервисов (внутренние, только localhost):"
if [ "$INSTALL_TRAEFIK" = "y" ]; then
    echo "  - Traefik:"
    echo "    * HTTP: 80 (внешний)"
    echo "    * HTTPS: 443 (внешний)"
    echo "    * Dashboard: http://localhost:8080"
fi
if [ "$INSTALL_GITLAB" = "y" ]; then
    echo "  - GitLab: http://127.0.0.1:8888"
fi
if [ "$INSTALL_N8N" = "y" ]; then
    echo "  - n8n: http://127.0.0.1:5678"
fi
if [ "$INSTALL_MANAGEMENT_UI" = "y" ]; then
    echo "  - Management UI: http://127.0.0.1:3000"
fi
if [ "$INSTALL_DNS_API" = "y" ]; then
    echo "  - Local DNS API: http://127.0.0.1:5353"
    echo "  - dnsmasq: 53 (UDP, DNS)"
fi
if [ "$INSTALL_MAILU" = "y" ] && [ -n "$MAIL_DOMAIN" ]; then
    echo "  - Mailu Mail Server:"
    echo "    * Веб-админка / Webmail: http://127.0.0.1:6555"
    echo "    * SMTP: 25, 587, 465 (внешние)"
    echo "    * IMAP: 143, 993 (внешние)"
fi
echo ""
echo "Все порты уникальны и не конфликтуют между собой."
echo ""
echo "ВАЖНО:"
if [ "$INSTALL_GITLAB" = "y" ]; then
    echo "  1. Сохраните начальный пароль GitLab root (проверьте /etc/gitlab/initial_root_password)"
fi
if [ "$INSTALL_TRAEFIK" = "y" ]; then
    echo "  2. SSL сертификаты будут получены автоматически в течение нескольких минут"
fi
echo "  3. Проверьте DNS записи для всех доменов"
if [ "$INSTALL_MAILU" = "y" ] && [ -n "$MAIL_DOMAIN" ]; then
    echo "  4. Mailu Mail Server:"
    echo "     - Войдите в веб-админку (https://$MAIL_DOMAIN/admin) и создайте домен"
    echo "     - Добавьте DNS записи (MX, SPF, DKIM, DMARC) - см. веб-админку"
    echo "     - Сохраните admin credentials (если они были выведены при установке)"
fi
echo ""
echo "Полезные команды:"
if [ "$INSTALL_TRAEFIK" = "y" ]; then
    echo "  systemctl status traefik"
fi
if [ "$INSTALL_GITLAB" = "y" ]; then
    echo "  systemctl status gitlab-runsvdir"
fi
if [ "$INSTALL_N8N" = "y" ]; then
    echo "  systemctl status n8n"
fi
if [ "$INSTALL_MANAGEMENT_UI" = "y" ]; then
    echo "  systemctl status management-ui"
fi
if [ "$INSTALL_MAILU" = "y" ] && [ -n "$MAIL_DOMAIN" ]; then
    echo "  systemctl status mailu"
fi
if [ "$INSTALL_CICD" = "y" ]; then
    echo "  systemctl status gitlab-runner"
    echo "  gitlab-runner list"
    echo "  pm2 list"
fi
echo ""
if [ "$INSTALL_CICD" = "y" ]; then
    echo "CI/CD информация:"
    echo "  - Deploy path: /var/www/borisovai-site"
    echo "  - GitLab Runner: настроен и запущен"
    echo "  - PM2: установлен для управления процессами"
    echo "  - Документация: scripts/single-machine/README_CI_CD.md"
    echo ""
fi
