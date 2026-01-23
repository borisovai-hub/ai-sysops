@echo off
REM Batch файл для запуска PowerShell скрипта загрузки файлов на сервер
REM Этот файл автоматически обходит политику выполнения PowerShell

echo === Загрузка скриптов на сервер ===
echo.

REM Запуск PowerShell скрипта с обходом политики выполнения
powershell -ExecutionPolicy Bypass -File "%~dp0upload-to-server.ps1"

REM Пауза для просмотра результата
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Ошибка при выполнении скрипта.
    pause
)
