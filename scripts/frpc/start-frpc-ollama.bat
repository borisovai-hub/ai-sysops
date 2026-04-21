@echo off
:: start-frpc-ollama.bat -- Autostart frpc Ollama tunnel
:: Copy to shell:startup for autostart on Windows login
:: Or use setup-frpc-ollama.ps1 to install as Windows service

set FRPC=C:\tools\frp\frpc.exe
set CONFIG=C:\tools\frp\frpc-ollama.toml

if not exist "%FRPC%" (
    echo ERROR: %FRPC% not found
    echo Run setup-frpc-ollama.ps1 first
    pause
    exit /b 1
)

if not exist "%CONFIG%" (
    echo ERROR: %CONFIG% not found
    pause
    exit /b 1
)

echo Starting frpc Ollama tunnel...
start /min "" "%FRPC%" -c "%CONFIG%"
