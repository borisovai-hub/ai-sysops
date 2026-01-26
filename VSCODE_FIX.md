# Исправление ошибки ICU в Visual Studio Code

## Проблема

При запуске Visual Studio Code появляется ошибка:
```
[ERROR:base\i18n\icu_util.cc:223] Invalid file descriptor to ICU data received.
```

Эта ошибка связана с проблемами доступа к данным ICU (International Components for Unicode), которые используются для интернационализации.

## Решение

### Вариант 1: Автоматическое исправление (рекомендуется)

Запустите скрипт исправления:

```powershell
.\fix-vscode.ps1
```

Скрипт выполнит:
- Очистку кэша VS Code
- Проверку переменных окружения
- Проверку прав доступа
- Создание скрипта для запуска VS Code с исправлением

### Вариант 2: Использование скрипта запуска

После выполнения `fix-vscode.ps1` используйте созданный скрипт для запуска VS Code:

```powershell
.\vscode-launch.ps1
```

Или с указанием папки для открытия:

```powershell
.\vscode-launch.ps1 "C:\projects\my-project"
```

### Вариант 3: Ручная очистка кэша

1. Закройте все окна VS Code
2. Удалите следующие папки:
   - `%APPDATA%\Code\Cache`
   - `%APPDATA%\Code\CachedData`
   - `%APPDATA%\Code\GPUCache`
   - `%LOCALAPPDATA%\Programs\Microsoft VS Code\resources\app\out\vs\workbench\Cache`

3. Запустите VS Code снова

### Вариант 4: Запуск с обходом проверки

Запустите VS Code с переменной окружения:

```powershell
$env:VSCODE_SKIP_NODE_VERSION_CHECK='1'
& "C:\Users\user\AppData\Local\Programs\Microsoft VS Code\Code.exe"
```

### Вариант 5: Переустановка VS Code

Если ничего не помогает:

1. Удалите VS Code через "Параметры" → "Приложения"
2. Удалите оставшиеся папки:
   - `%APPDATA%\Code`
   - `%LOCALAPPDATA%\Programs\Microsoft VS Code`
3. Скачайте и установите VS Code заново с [официального сайта](https://code.visualstudio.com/)

## Дополнительные проверки

### Проверка антивируса

Антивирус может блокировать доступ к файлам VS Code. Попробуйте:
- Временно отключить антивирус
- Добавить папку VS Code в исключения антивируса

### Проверка прав доступа

Убедитесь, что у вашего пользователя есть права на чтение и запись в:
- `%LOCALAPPDATA%\Programs\Microsoft VS Code`
- `%APPDATA%\Code`

### Проверка переменных окружения

Проверьте, нет ли конфликтующих переменных:

```powershell
Get-ChildItem Env: | Where-Object { $_.Name -like "*VSCODE*" -or $_.Name -like "*ELECTRON*" }
```

Если найдены проблемные переменные, удалите их:

```powershell
Remove-Item Env:VSCODE_IPC_HOOK_CLI -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue
```

## Примечания

- Ошибка ICU обычно не критична и VS Code может работать несмотря на неё
- Если VS Code работает нормально, можно игнорировать эту ошибку
- Проблема часто возникает после обновления Windows или VS Code
