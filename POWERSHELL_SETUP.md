# Настройка PowerShell для запуска скриптов

## Проблема: "Невозможно загрузить скрипт, так как выполнение скриптов отключено"

Эта ошибка возникает из-за политики выполнения PowerShell, которая по умолчанию блокирует запуск локальных скриптов.

## Решение

### Вариант 1: Автоматическая настройка (рекомендуется)

Запустите скрипт настройки:

```powershell
.\setup-powershell.ps1
```

Скрипт проверит текущую политику и предложит изменить её при необходимости.

### Вариант 2: Ручная настройка для текущего пользователя

Откройте PowerShell и выполните:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

**Что делает эта команда:**
- `RemoteSigned` - разрешает запуск локальных скриптов, но требует подписи для скриптов из интернета
- `CurrentUser` - применяется только к текущему пользователю (не требует прав администратора)

### Вариант 3: Только для текущей сессии

Если не хотите менять политику глобально:

```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
```

Эта настройка действует только до закрытия окна PowerShell.

### Вариант 4: Запуск с обходом политики

Можно запускать скрипты без изменения политики:

```powershell
# Для Windows-скриптов (в папке windows-install)
cd windows-install
powershell -ExecutionPolicy Bypass -File .\upload-to-server.ps1

# Для скриптов установки на одну машину
cd scripts
powershell -ExecutionPolicy Bypass -File .\upload-single-machine.ps1
```

Или для текущей сессии:

```powershell
Set-ExecutionPolicy -ExecutionPolicy Bypass -Scope Process
.\upload-to-server.ps1
```

## Проверка текущей политики

Чтобы узнать текущую политику выполнения:

```powershell
Get-ExecutionPolicy -List
```

Или для конкретной области:

```powershell
Get-ExecutionPolicy -Scope CurrentUser
Get-ExecutionPolicy -Scope Process
Get-ExecutionPolicy -Scope LocalMachine
```

## Уровни политики выполнения

- **Restricted** - выполнение скриптов запрещено (по умолчанию)
- **RemoteSigned** - локальные скрипты разрешены, удаленные должны быть подписаны (рекомендуется)
- **Unrestricted** - все скрипты разрешены (менее безопасно)
- **Bypass** - политика не применяется (только для тестирования)

## Области применения политики

- **Process** - только для текущей сессии PowerShell
- **CurrentUser** - только для текущего пользователя (не требует прав администратора)
- **LocalMachine** - для всех пользователей (требует прав администратора)

## Рекомендации

1. **Используйте `RemoteSigned` для `CurrentUser`** - это безопасно и не требует прав администратора
2. **Не используйте `Bypass` или `Unrestricted` глобально** - это снижает безопасность
3. **Для одноразового запуска** используйте `-ExecutionPolicy Bypass` в команде

## Решение проблем

### Ошибка: "Set-ExecutionPolicy: Access to the registry key 'HKEY_LOCAL_MACHINE' is denied"

Эта ошибка возникает при попытке изменить политику для всех пользователей без прав администратора.

**Решение:** Используйте `-Scope CurrentUser` вместо `-Scope LocalMachine`

### Ошибка: "Execution of scripts is disabled on this system"

Политика выполнения все еще блокирует скрипты.

**Решение:**
1. Проверьте политику: `Get-ExecutionPolicy -List`
2. Убедитесь, что для `CurrentUser` или `Process` установлено `RemoteSigned` или выше
3. Если нужно, запустите с обходом: `powershell -ExecutionPolicy Bypass -File .\script.ps1`

### Скрипт все еще не запускается после изменения политики

1. Закройте и откройте PowerShell заново
2. Проверьте политику: `Get-ExecutionPolicy -List`
3. Убедитесь, что изменили правильную область (CurrentUser или Process)

## Безопасность

- **RemoteSigned** - безопасный выбор, разрешает локальные скрипты, но проверяет подпись удаленных
- **Не скачивайте и не запускайте скрипты из ненадежных источников**
- **Проверяйте содержимое скриптов перед запуском**

## Быстрая справка

```powershell
# Установить политику для текущего пользователя
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

# Проверить текущую политику
Get-ExecutionPolicy -List

# Запустить скрипт с обходом политики
powershell -ExecutionPolicy Bypass -File .\script.ps1

# Временно изменить политику для текущей сессии
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process
```
