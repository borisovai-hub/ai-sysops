#!/bin/bash
# Быстрая настройка SMTP для GitLab с предустановленными данными
# Использование: sudo ./configure-gitlab-smtp-quick.sh
#
# Примечание: Скрипт использует предустановленные данные для gitlab@borisovai.ru

# Определение директории скрипта (абсолютный путь)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Запуск основного скрипта с параметрами
# Используем правильные настройки: mail.dev.borisovai.ru, порт 465 (TLS)
exec "$SCRIPT_DIR/configure-gitlab-smtp.sh" --mailu --email "gitlab@borisovai.ru" --password "38^Fu!5I1&Di3"
