# Примеры использования скриптов загрузки на сервер

**Примечание:** Скрипты `upload-to-server.*` для загрузки Windows-скриптов находятся в папке `windows-install/`. Для загрузки скриптов установки на одну машину используйте `scripts/upload-single-machine.*`.

## Windows (PowerShell) - Загрузка Windows-скриптов

### Базовое использование

```powershell
# Перейдите в папку windows-install
cd windows-install

# Интерактивный режим (запросит все данные)
.\upload-to-server.ps1
```

### С параметрами командной строки

```powershell
# С указанием IP и пользователя
.\upload-to-server.ps1 -ServerIP "192.168.1.100" -Username "root"

# С использованием SSH ключа
.\upload-to-server.ps1 -ServerIP "192.168.1.100" -Username "root" -UseKey -KeyPath "C:\Users\YourName\.ssh\id_rsa"

# С указанием удаленного пути
.\upload-to-server.ps1 -ServerIP "192.168.1.100" -Username "root" -RemotePath "/root/windows-setup"
```

### Полный пример с параметрами

```powershell
.\upload-to-server.ps1 `
    -ServerIP "123.45.67.89" `
    -Username "root" `
    -RemotePath "~/windows-install" `
    -UseKey `
    -KeyPath "$env:USERPROFILE\.ssh\id_rsa"
```

## Linux/Mac (Bash) - Загрузка Windows-скриптов

### Базовое использование

```bash
# Перейдите в папку windows-install
cd windows-install

# Сделайте скрипт исполняемым (один раз)
chmod +x upload-to-server.sh

# Запустите (интерактивный режим)
./upload-to-server.sh
```

### Использование с переменными окружения

```bash
# Установите переменные
export SERVER_IP="192.168.1.100"
export SERVER_USER="root"

# Или используйте напрямую в команде
SERVER_IP="192.168.1.100" SERVER_USER="root" ./upload-to-server.sh
```

### Прямое использование SCP (альтернатива)

```bash
# Перейдите в папку windows-install
cd windows-install

# С паролем
scp install-windows.sh setup-grub.sh download-windows-iso.sh root@192.168.1.100:~/windows-install/

# С SSH ключом
scp -i ~/.ssh/id_rsa install-windows.sh setup-grub.sh download-windows-iso.sh root@192.168.1.100:~/windows-install/
```

## Настройка SSH ключа (если еще не настроен)

### Windows (Git Bash)

```bash
# 1. Установите ssh-copy-id (если еще не установлен)
chmod +x install-ssh-copy-id.sh
./install-ssh-copy-id.sh

# 2. Генерация SSH ключа
ssh-keygen -t rsa -b 4096

# 3. Копирование ключа на сервер
ssh-copy-id root@192.168.1.100
```

### Windows (PowerShell)

```powershell
# Генерация SSH ключа
ssh-keygen -t rsa -b 4096

# Копирование ключа на сервер (вручную)
type $env:USERPROFILE\.ssh\id_rsa.pub | ssh root@192.168.1.100 "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

### Linux/Mac

```bash
# Генерация SSH ключа
ssh-keygen -t rsa -b 4096

# Копирование ключа на сервер
ssh-copy-id root@192.168.1.100
```

**Примечание:** На Windows встроенного `ssh-copy-id` нет, но можно использовать скрипт из этого проекта или выполнить команду вручную (см. выше).

## Проверка подключения перед загрузкой

### Windows

```powershell
# Тест SSH подключения
ssh root@192.168.1.100 "echo 'Connection successful'"

# Тест SCP
scp test.txt root@192.168.1.100:/tmp/
```

### Linux/Mac

```bash
# Тест SSH подключения
ssh root@192.168.1.100 "echo 'Connection successful'"

# Тест SCP
scp test.txt root@192.168.1.100:/tmp/
```

## Решение проблем

### Ошибка: "scp: command not found"

**Windows:**
- Установите OpenSSH клиент через "Параметры" → "Приложения" → "Дополнительные компоненты"
- Или используйте альтернативу: WinSCP, FileZilla, PuTTY

**Linux:**
```bash
# Ubuntu/Debian
sudo apt install openssh-client

# CentOS/RHEL
sudo yum install openssh-clients
```

### Ошибка: "Permission denied (publickey)"

1. Проверьте правильность пути к SSH ключу
2. Убедитесь, что ключ имеет правильные права доступа:
   ```bash
   chmod 600 ~/.ssh/id_rsa
   ```
3. Проверьте, что публичный ключ добавлен на сервер:
   ```bash
   ssh-copy-id root@SERVER_IP
   ```

### Ошибка: "Connection refused"

1. Проверьте, что сервер доступен:
   ```bash
   ping SERVER_IP
   ```
2. Убедитесь, что SSH сервис запущен на сервере
3. Проверьте файрвол и порт (обычно 22)

### Альтернативные методы загрузки

Если SCP не работает, используйте:

1. **WinSCP** (Windows) - графический SFTP клиент
2. **FileZilla** - кроссплатформенный FTP/SFTP клиент
3. **VS Code с расширением Remote-SSH** - редактирование файлов напрямую на сервере
4. **Ручное создание файлов** - скопируйте содержимое скриптов и создайте файлы на сервере через `nano` или `vi`

## Автоматизация для нескольких серверов

### Windows (PowerShell)

```powershell
$servers = @(
    @{IP="192.168.1.100"; User="root"},
    @{IP="192.168.1.101"; User="root"}
)

foreach ($server in $servers) {
    Write-Host "Загрузка на $($server.IP)..." -ForegroundColor Cyan
    cd windows-install
    .\upload-to-server.ps1 -ServerIP $server.IP -Username $server.User
    cd ..
}
```

### Linux/Mac (Bash)

```bash
#!/bin/bash
servers=("root@192.168.1.100" "root@192.168.1.101")

for server in "${servers[@]}"; do
    echo "Загрузка на $server..."
    cd windows-install
    SERVER_IP=$(echo $server | cut -d@ -f2)
    SERVER_USER=$(echo $server | cut -d@ -f1)
    ./upload-to-server.sh
    cd ..
done
```
