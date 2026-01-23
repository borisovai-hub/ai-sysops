# Решение проблем с кодировкой в PowerShell скриптах

## Проблема

Если при запуске PowerShell скрипта вы видите ошибки типа:
- `Отсутствует закрывающий знак "}"`
- `В операторе Try отсутствует блок Catch`
- Кракозябры вместо русских букв

Это означает, что файл сохранен в неправильной кодировке.

## Решение

### Вариант 1: Использовать английский текст (рекомендуется)

Файл `windows-install/upload-to-server.ps1` уже переписан на английский язык, чтобы избежать проблем с кодировкой.

### Вариант 2: Сохранить файл в правильной кодировке

Если вы хотите использовать русский текст, файл должен быть сохранен в **UTF-8 с BOM** (Byte Order Mark).

#### В Visual Studio Code:

1. Откройте файл
2. Нажмите на кодировку в правом нижнем углу (обычно показывается как "UTF-8")
3. Выберите "Save with Encoding"
4. Выберите "UTF-8 with BOM"

Или добавьте в настройки VS Code (`.vscode/settings.json`):
```json
{
    "files.encoding": "utf8bom",
    "files.autoGuessEncoding": true
}
```

#### В PowerShell ISE:

1. Откройте файл
2. File -> Save As
3. В диалоге сохранения нажмите стрелку рядом с "Save"
4. Выберите "Save with Encoding"
5. Выберите "UTF-8 with BOM"

#### Через PowerShell команду:

```powershell
# Прочитать файл и сохранить с правильной кодировкой
cd windows-install
$content = Get-Content -Path "upload-to-server.ps1" -Raw -Encoding UTF8
$utf8WithBom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText("$PWD\upload-to-server.ps1", $content, $utf8WithBom)
```

### Вариант 3: Изменить кодировку консоли PowerShell

```powershell
# Установить кодировку консоли на UTF-8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001
```

Но это не решит проблему парсинга скрипта, только отображение.

## Проверка кодировки файла

```powershell
# Проверить кодировку файла
cd windows-install
$bytes = [System.IO.File]::ReadAllBytes("upload-to-server.ps1")
if ($bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    Write-Host "UTF-8 with BOM" -ForegroundColor Green
} else {
    Write-Host "Not UTF-8 with BOM" -ForegroundColor Red
}
```

## Рекомендации

1. **Используйте английский текст** в PowerShell скриптах для максимальной совместимости
2. **Если нужен русский текст**, сохраняйте файлы в UTF-8 with BOM
3. **Проверяйте скрипты** перед коммитом в репозиторий
4. **Используйте BAT файл** (`upload-to-server.bat`) - он не имеет проблем с кодировкой

## Альтернатива: Использовать BAT файл

Самый простой способ избежать проблем - использовать `windows-install/upload-to-server.bat`, который автоматически запускает PowerShell скрипт с правильными параметрами:

```cmd
cd windows-install
upload-to-server.bat
```

Этот файл не имеет проблем с кодировкой и работает на любой системе Windows.
