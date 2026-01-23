# Скрипт настройки PowerShell для запуска локальных скриптов
# Запустите от имени администратора: Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser

Write-Host "=== Настройка PowerShell для запуска скриптов ===" -ForegroundColor Cyan
Write-Host ""

# Проверка прав администратора
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)

if (-not $isAdmin) {
    Write-Host "ВНИМАНИЕ: Для изменения политики выполнения требуются права администратора." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Текущая политика выполнения:" -ForegroundColor Cyan
    $currentPolicy = Get-ExecutionPolicy -Scope CurrentUser
    Write-Host "  CurrentUser: $currentPolicy" -ForegroundColor White
    
    $processPolicy = Get-ExecutionPolicy -Scope Process
    Write-Host "  Process: $processPolicy" -ForegroundColor White
    Write-Host ""
    
    if ($currentPolicy -eq "RemoteSigned" -or $currentPolicy -eq "Unrestricted" -or $currentPolicy -eq "Bypass") {
        Write-Host "Политика выполнения уже позволяет запускать локальные скрипты." -ForegroundColor Green
        Write-Host ""
        Write-Host "Если скрипты все еще не запускаются, попробуйте:" -ForegroundColor Yellow
        Write-Host "  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process" -ForegroundColor White
    } else {
        Write-Host "Для изменения политики выполните одну из команд:" -ForegroundColor Yellow
        Write-Host ""
        Write-Host "Вариант 1 (рекомендуется, только для текущего пользователя):" -ForegroundColor Cyan
        Write-Host "  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser" -ForegroundColor White
        Write-Host ""
        Write-Host "Вариант 2 (только для текущей сессии):" -ForegroundColor Cyan
        Write-Host "  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope Process" -ForegroundColor White
        Write-Host ""
        Write-Host "Вариант 3 (требует прав администратора, для всех пользователей):" -ForegroundColor Cyan
        Write-Host "  Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope LocalMachine" -ForegroundColor White
        Write-Host ""
        Write-Host "После выполнения команды попробуйте запустить скрипт снова." -ForegroundColor Yellow
    }
} else {
    Write-Host "Обнаружены права администратора." -ForegroundColor Green
    Write-Host ""
    Write-Host "Текущая политика выполнения:" -ForegroundColor Cyan
    Get-ExecutionPolicy -List | Format-Table -AutoSize
    Write-Host ""
    
    $choice = Read-Host "Изменить политику для CurrentUser на RemoteSigned? (y/n)"
    if ($choice -eq "y" -or $choice -eq "Y") {
        try {
            Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser -Force
            Write-Host ""
            Write-Host "Политика выполнения успешно изменена!" -ForegroundColor Green
            Write-Host "Теперь вы можете запускать локальные скрипты." -ForegroundColor Green
        } catch {
            Write-Host ""
            Write-Host "Ошибка при изменении политики: $_" -ForegroundColor Red
        }
    } else {
        Write-Host "Изменение политики отменено." -ForegroundColor Yellow
    }
}

Write-Host ""
Write-Host "Альтернативный способ запуска (без изменения политики):" -ForegroundColor Cyan
Write-Host "  cd windows-install" -ForegroundColor White
Write-Host "  powershell -ExecutionPolicy Bypass -File .\upload-to-server.ps1" -ForegroundColor White
Write-Host ""
