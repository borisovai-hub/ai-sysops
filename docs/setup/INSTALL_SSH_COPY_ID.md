# Установка ssh-copy-id для Git Bash на Windows

## Автоматическая установка (рекомендуется)

1. Откройте Git Bash в директории с файлами проекта

2. Запустите скрипт установки:
```bash
chmod +x install-ssh-copy-id.sh
./install-ssh-copy-id.sh
```

Скрипт автоматически найдет Git Bash и установит `ssh-copy-id`.

## Ручная установка

### Шаг 1: Найдите директорию Git Bash

Обычно Git Bash находится в одной из директорий:
- `C:\Program Files\Git`
- `C:\Program Files (x86)\Git`

### Шаг 2: Скопируйте файл ssh-copy-id

Скопируйте файл `ssh-copy-id` в директорию:
```
C:\Program Files\Git\usr\bin\ssh-copy-id
```

Или в Git Bash:
```bash
cp ssh-copy-id "/c/Program Files/Git/usr/bin/ssh-copy-id"
chmod +x "/c/Program Files/Git/usr/bin/ssh-copy-id"
```

### Шаг 3: Проверка установки

Откройте новый терминал Git Bash и выполните:
```bash
ssh-copy-id --help
```

Если команда работает, установка прошла успешно!

## Использование

### Базовое использование

```bash
# Копирование ключа по умолчанию (~/.ssh/id_rsa.pub)
ssh-copy-id user@hostname

# С указанием конкретного ключа
ssh-copy-id -i ~/.ssh/my_key.pub user@hostname

# С указанием порта
ssh-copy-id -p 2222 user@hostname
```

### Примеры

```bash
# Копирование ключа на сервер Contabo
ssh-copy-id root@123.45.67.89

# С использованием другого ключа
ssh-copy-id -i ~/.ssh/contabo_key.pub root@123.45.67.89

# С нестандартным портом
ssh-copy-id -p 2222 root@123.45.67.89
```

## Создание SSH ключа (если еще нет)

Если у вас еще нет SSH ключа, создайте его:

```bash
# Генерация RSA ключа (4096 бит)
ssh-keygen -t rsa -b 4096 -C "your_email@example.com"

# Или более современный Ed25519 ключ
ssh-keygen -t ed25519 -C "your_email@example.com"
```

При создании ключа:
- Нажмите Enter для использования пути по умолчанию (`~/.ssh/id_rsa`)
- Введите парольную фразу (или оставьте пустым для автоматического входа)
- Публичный ключ будет сохранен в `~/.ssh/id_rsa.pub`

## Решение проблем

### Ошибка: "ssh-copy-id: command not found"

1. Убедитесь, что файл скопирован в правильную директорию
2. Проверьте права доступа: `chmod +x /c/Program\ Files/Git/usr/bin/ssh-copy-id`
3. Перезапустите Git Bash

### Ошибка: "Permission denied"

1. Проверьте правильность пароля
2. Убедитесь, что пользователь имеет права на запись в `~/.ssh/`
3. Проверьте настройки SSH на сервере

### Ошибка: "Could not resolve hostname"

1. Проверьте правильность имени хоста или IP адреса
2. Убедитесь, что сервер доступен: `ping hostname`

### Альтернативный способ (без ssh-copy-id)

Если установка не работает, можно скопировать ключ вручную:

```bash
# Показать публичный ключ
cat ~/.ssh/id_rsa.pub

# Скопировать вывод и выполнить на сервере:
# mkdir -p ~/.ssh
# echo "ВАШ_ПУБЛИЧНЫЙ_КЛЮЧ" >> ~/.ssh/authorized_keys
# chmod 700 ~/.ssh
# chmod 600 ~/.ssh/authorized_keys
```

Или одной командой:
```bash
cat ~/.ssh/id_rsa.pub | ssh user@hostname "mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"
```

## Проверка работы

После установки ключа проверьте подключение:

```bash
# Подключение без пароля
ssh user@hostname

# Если запрашивается пароль, проверьте:
# 1. Правильность пути к ключу
# 2. Права доступа на ключ (должен быть 600)
# 3. Настройки SSH на сервере
```

## Полезные ссылки

- [Документация OpenSSH](https://www.openssh.com/)
- [Git для Windows](https://git-scm.com/download/win)
- [Руководство по SSH ключам](https://www.ssh.com/ssh/key/)
