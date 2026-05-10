#!/bin/bash
# Скрипт для оффлайн-бэкапа step-ca root key.
# Создаёт зашифрованный архив и проводит через процедуру переноса на флешку
# и в облачный backup. См. docs/runbooks/PKI_STEP_CA.md → "Оффлайн-бэкап root key".
#
# Использование: sudo ./backup-step-ca-offline.sh

set -e

if [ "$EUID" -ne 0 ]; then
    echo "Ошибка: запустите с правами root (sudo)"
    exit 1
fi

STEPPATH=/etc/step-ca
EXPORT_DIR=$STEPPATH/root-export

if [ ! -d "$EXPORT_DIR" ] || [ ! -f "$EXPORT_DIR/root_ca_key.encrypted" ]; then
    echo "Ошибка: $EXPORT_DIR/root_ca_key.encrypted не найден"
    echo "step-ca не установлен или экспорт уже удалён"
    exit 1
fi

if ! command -v gpg &>/dev/null; then
    echo "Установка gnupg..."
    apt-get install -y gnupg 2>&1 | tail -2
fi

TS=$(date +%Y%m%d_%H%M%S)
WORK_DIR=$(mktemp -d)
ARCHIVE="$WORK_DIR/step-ca-root-${TS}.tar.gz"

echo ""
echo "=== Оффлайн-бэкап root key step-ca ==="
echo ""

# 1. Создать архив
echo "[1/4] Сборка архива..."
tar czf "$ARCHIVE" \
    -C "$STEPPATH" \
    secrets/password \
    root-export/root_ca.crt \
    root-export/root_ca_key.encrypted
SIZE=$(du -h "$ARCHIVE" | cut -f1)
echo "  [OK] Архив: $ARCHIVE ($SIZE)"

# 2. GPG шифрование. Читаем passphrase сами (gpg-agent не работает в non-TTY SSH).
echo ""
echo "[2/4] GPG-шифрование..."
echo "  ВАЖНО: passphrase храните в password manager (Bitwarden/1Password) ОТДЕЛЬНО"
echo "  от файла бэкапа. Если passphrase утерян — ключ не восстановить."
echo "  Минимум 16 символов, micszhno буквы/цифры/спецсимволы."
echo ""

# Читаем passphrase дважды и сравниваем
PASS=""
PASS_CONFIRM=""
while true; do
    read -r -s -p "  Passphrase: " PASS
    echo
    if [ ${#PASS} -lt 12 ]; then
        echo "  Слишком короткая (нужно ≥12 символов). Повторите."
        continue
    fi
    read -r -s -p "  Повторите: " PASS_CONFIRM
    echo
    if [ "$PASS" != "$PASS_CONFIRM" ]; then
        echo "  Не совпадают. Повторите."
        continue
    fi
    break
done
unset PASS_CONFIRM

# Шифрование с явным passphrase через stdin (loopback pinentry)
printf '%s' "$PASS" | gpg --batch --yes --pinentry-mode loopback \
    --passphrase-fd 0 \
    --symmetric --cipher-algo AES256 \
    --output "${ARCHIVE}.gpg" "$ARCHIVE"
RC=$?
unset PASS
if [ $RC -ne 0 ] || [ ! -f "${ARCHIVE}.gpg" ]; then
    echo "  [ОШИБКА] GPG шифрование не удалось"
    rm -f "$ARCHIVE" "${ARCHIVE}.gpg"
    exit 1
fi
echo "  [OK] Зашифрованный архив: ${ARCHIVE}.gpg"

# 3. Шреддить незашифрованный
shred -u "$ARCHIVE"

# 4. Финальный артефакт
FINAL="/root/step-ca-root-${TS}.tar.gz.gpg"
mv "${ARCHIVE}.gpg" "$FINAL"
chmod 400 "$FINAL"
SHA=$(sha256sum "$FINAL" | awk '{print $1}')

# Cleanup tmpdir
rm -rf "$WORK_DIR"

# 5. Инструкции
echo ""
echo "=== Архив готов ==="
echo ""
echo "  Файл:    $FINAL"
echo "  Размер:  $(du -h "$FINAL" | cut -f1)"
echo "  SHA256:  $SHA"
echo ""
echo "ДАЛЕЕ — РУЧНЫЕ ШАГИ:"
echo ""
echo "1) Скопируйте на физическую флешку (LUKS/VeraCrypt encrypted):"
echo "   scp root@\$(hostname):$FINAL /path/to/usb/"
echo ""
echo "   ИЛИ через локальный download (curl/scp) с вашей машины:"
echo "   scp root@<this-server>:$FINAL ./"
echo ""
echo "2) Скопируйте на облачный backup (S3/Backblaze/Yandex Cloud):"
echo "   aws s3 cp $FINAL s3://your-secure-bucket/step-ca-backups/"
echo "   ИЛИ другой your storage CLI"
echo ""
echo "3) ПРОВЕРКА восстановления (на отдельной машине):"
echo "   gpg --decrypt $(basename $FINAL) | tar tz | head"
echo "   # Должно показать: secrets/password, root-export/root_ca.crt, ..."
echo ""
echo "4) После проверки УДАЛИТЕ файл с сервера:"
echo "   shred -u $FINAL"
echo "   shred -u $EXPORT_DIR/root_ca_key.encrypted"
echo "   rm -rf $EXPORT_DIR"
echo ""
echo "   ВАЖНО: $STEPPATH/secrets/{root_ca_key,password} остаются на сервере"
echo "   — они нужны step-ca для работы. Удаляется только КОПИЯ из root-export/."
echo ""
echo "5) Запишите в календарь напоминание на 6 месяцев — тест восстановления."
echo "   Процедура: docs/runbooks/PKI_STEP_CA.md → 'Тест восстановления'"
echo ""
