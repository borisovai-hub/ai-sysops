@echo off
REM Batch file for uploading single-machine installation files
REM This file automatically bypasses PowerShell execution policy

echo === Uploading single-machine installation files ===
echo.

REM Run PowerShell script with bypass execution policy
powershell -ExecutionPolicy Bypass -File "%~dp0upload-single-machine.ps1"

REM Pause to view result
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo Error during upload.
    pause
)
