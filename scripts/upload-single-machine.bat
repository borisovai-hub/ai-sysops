@echo off
REM Batch file for uploading single-machine installation files
REM Usage: upload-single-machine.bat [options]
REM   -Check  verify files only, no upload

powershell -ExecutionPolicy Bypass -File "%~dp0upload-single-machine.ps1" %*

if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Error during upload.
    pause
)
