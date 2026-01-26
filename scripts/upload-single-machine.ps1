# PowerShell script for uploading single-machine installation files
# Usage: .\upload-single-machine.ps1
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение и найдет все необходимые файлы.

param(
    [string]$ServerIP = "",
    [string]$Username = "",
    [string]$RemotePath = "~/install",
    [switch]$UseKey = $false,
    [string]$KeyPath = "",
    [switch]$Check = $false
)

# Определение директории скрипта (абсолютный путь)
# Это позволяет запускать скрипт из любой директории
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$ConfigFile = "$env:USERPROFILE\.upload-single-machine-config.json"

# Функции для работы с конфигурацией
function Get-ConfigValue {
    param([string]$Key)
    if (Test-Path $ConfigFile) {
        $config = Get-Content $ConfigFile | ConvertFrom-Json
        return $config.$Key
    }
    return $null
}

function Set-ConfigValue {
    param([string]$Key, [string]$Value)
    $config = @{}
    if (Test-Path $ConfigFile) {
        $jsonContent = Get-Content $ConfigFile | ConvertFrom-Json
        $jsonContent.PSObject.Properties | ForEach-Object {
            $config[$_.Name] = $_.Value
        }
    }
    $config[$Key] = $Value
    $config | ConvertTo-Json | Set-Content $ConfigFile
}

function Get-PromptWithDefault {
    param([string]$Prompt, [string]$Key, [string]$DefaultValue = "")
    $savedValue = Get-ConfigValue -Key $Key
    $default = if ($savedValue) { $savedValue } else { $DefaultValue }
    
    if ($default) {
        $value = Read-Host "$Prompt [$default]"
        if ([string]::IsNullOrEmpty($value)) {
            $value = $default
        }
    } else {
        $value = Read-Host $Prompt
    }
    
    if ($value) {
        Set-ConfigValue -Key $Key -Value $value
    }
    return $value
}

Write-Host "=== Uploading single-machine installation files ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Script directory: $ScriptDir" -ForegroundColor Gray
Write-Host "Project root: $ProjectRoot" -ForegroundColor Gray
Write-Host ""

# Check if SCP command exists (skip when -Check)
if (-not $Check) {
    $scpCheck = Get-Command scp -ErrorAction SilentlyContinue
    if (-not $scpCheck) {
        Write-Host "Error: 'scp' command not found!" -ForegroundColor Red
        exit 1
    }
}

# List of files to upload (абсолютные пути относительно скрипта)
$filesToUpload = @(
    "$ScriptDir\single-machine\common.sh",
    "$ScriptDir\single-machine\install-all.sh",
    "$ScriptDir\single-machine\install-traefik.sh",
    "$ScriptDir\single-machine\install-gitlab.sh",
    "$ScriptDir\single-machine\install-n8n.sh",
    "$ScriptDir\single-machine\install-management-ui.sh",
    "$ScriptDir\single-machine\install-mailu.sh",
    "$ScriptDir\single-machine\mailu-setup-render.py",
    "$ScriptDir\single-machine\setup-dns-api.sh",
    "$ScriptDir\single-machine\configure-traefik.sh"
)
$managementUiPath = "$ProjectRoot\management-ui"
$dnsApiPath = "$ScriptDir\dns-api"

# Check if files exist
Write-Host "Checking files for upload..." -ForegroundColor Yellow
$missingFiles = @()
foreach ($file in $filesToUpload) {
    if (-not (Test-Path $file)) {
        $missingFiles += $file
        Write-Host "  [X] $file - not found" -ForegroundColor Red
    } else {
        Write-Host "  [OK] $(Split-Path -Leaf $file) - found" -ForegroundColor Green
    }
}
if (-not (Test-Path $managementUiPath)) {
    $missingFiles += "management-ui/"
    Write-Host "  [X] management-ui/ - not found" -ForegroundColor Red
} else {
    Write-Host "  [OK] management-ui/ - found" -ForegroundColor Green
}
if (-not (Test-Path $dnsApiPath)) {
    $missingFiles += "dns-api/"
    Write-Host "  [X] dns-api/ - not found" -ForegroundColor Red
} else {
    Write-Host "  [OK] dns-api/ - found" -ForegroundColor Green
}

if ($missingFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "Error: Some files not found!" -ForegroundColor Red
    exit 1
}

if ($Check) {
    Write-Host ""
    Write-Host "Check passed (-Check). Upload skipped." -ForegroundColor Green
    exit 0
}

# Request connection data with saved defaults
if ([string]::IsNullOrEmpty($ServerIP)) {
    $ServerIP = Get-PromptWithDefault -Prompt "Enter server IP address" -Key "server_ip"
}

if ([string]::IsNullOrEmpty($Username)) {
    $Username = Get-PromptWithDefault -Prompt "Enter username (usually root)" -Key "username" -DefaultValue "root"
}

if ([string]::IsNullOrEmpty($RemotePath)) {
    $savedPath = Get-ConfigValue -Key "remote_path"
    $defaultPath = if ($savedPath) { $savedPath } else { "~/install" }
    $RemotePath = Get-PromptWithDefault -Prompt "Enter remote path" -Key "remote_path" -DefaultValue $defaultPath
} else {
    Set-ConfigValue -Key "remote_path" -Value $RemotePath
}

# Determine authentication method
if (-not $UseKey) {
    $savedUseKey = Get-ConfigValue -Key "use_key"
    if ($savedUseKey -eq "true") {
        $UseKey = $true
        $savedKeyPath = Get-ConfigValue -Key "key_path"
        if ($savedKeyPath) {
            $KeyPath = $savedKeyPath
        }
    } else {
        $authMethod = Read-Host "Use SSH key? (y/n)"
        if ($authMethod -eq "y" -or $authMethod -eq "Y") {
            $UseKey = $true
            Set-ConfigValue -Key "use_key" -Value "true"
        } else {
            Set-ConfigValue -Key "use_key" -Value "false"
        }
    }
    
    if ($UseKey -and [string]::IsNullOrEmpty($KeyPath)) {
        $savedKeyPath = Get-ConfigValue -Key "key_path"
        $defaultKeyPath = if ($savedKeyPath) { $savedKeyPath } else { "$env:USERPROFILE\.ssh\id_rsa" }
        $KeyPath = Get-PromptWithDefault -Prompt "Enter path to SSH key" -Key "key_path" -DefaultValue $defaultKeyPath
    }
} else {
    Set-ConfigValue -Key "use_key" -Value "true"
    if ($KeyPath) {
        Set-ConfigValue -Key "key_path" -Value $KeyPath
    }
}

# Build SCP command
$scpArgs = @()

# Add key if used
if ($UseKey) {
    if (Test-Path $KeyPath) {
        $scpArgs += "-i"
        $scpArgs += $KeyPath
    } else {
        Write-Host "Error: SSH key not found: $KeyPath" -ForegroundColor Red
        exit 1
    }
}

# Add files
foreach ($file in $filesToUpload) {
    $scpArgs += $file
}

# Add remote path
$remoteTarget = "${Username}@${ServerIP}:${RemotePath}/scripts/single-machine"
$scpArgs += $remoteTarget

# Display command
Write-Host ""
Write-Host "Command to execute:" -ForegroundColor Cyan
Write-Host "scp $($scpArgs -join ' ')" -ForegroundColor Gray
Write-Host ""

# Normalize line endings (CRLF -> LF) before upload
$utf8NoBom = New-Object System.Text.UTF8Encoding $false
function ConvertTo-Lf {
    param([string]$Path)
    if (-not (Test-Path $Path)) { return }
    $text = [System.IO.File]::ReadAllText($Path)
    if ($text -match "`r`n") {
        [System.IO.File]::WriteAllText($Path, ($text -replace "`r`n", "`n"), $utf8NoBom)
    }
}
Write-Host "Normalizing line endings (CRLF -> LF)..." -ForegroundColor Gray
foreach ($f in $filesToUpload) { ConvertTo-Lf -Path $f }
if (Test-Path $dnsApiPath) {
    Get-ChildItem -Path $dnsApiPath -Filter "*.sh" -ErrorAction SilentlyContinue | ForEach-Object { ConvertTo-Lf -Path $_.FullName }
}
$smPath = "$ScriptDir\single-machine"
if (Test-Path $smPath) {
    Get-ChildItem -Path $smPath -Filter "*.py" -ErrorAction SilentlyContinue | ForEach-Object { ConvertTo-Lf -Path $_.FullName }
}
Write-Host "  [OK] Ready to upload" -ForegroundColor Green
Write-Host ""

# Execute upload with check after each step
function Invoke-Ssh {
    param([string]$Command)
    $a = @()
    if ($UseKey) { $a += "-i"; $a += $KeyPath }
    $a += "${Username}@${ServerIP}"
    $a += $Command
    & ssh @a
    return $LASTEXITCODE -eq 0
}

Write-Host "Uploading files to server..." -ForegroundColor Yellow
if (-not $UseKey) { Write-Host "Enter password when prompted:" -ForegroundColor Yellow }
Write-Host ""

$uploadOk = $true

# 1. Create directory on server
Write-Host "  1/4 Creating directories..." -ForegroundColor Gray
try {
    if (-not (Invoke-Ssh "mkdir -p ${RemotePath}/scripts/single-machine")) {
        Write-Host "  [ERROR] SSH or mkdir failed" -ForegroundColor Red
        $uploadOk = $false
    }
} catch {
    Write-Host "  [ERROR] $_" -ForegroundColor Red
    $uploadOk = $false
}

# 2. Upload scripts
if ($uploadOk) {
    Write-Host "  2/4 Uploading single-machine scripts..." -ForegroundColor Gray
    try {
        & scp @scpArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [ERROR] Scripts upload failed" -ForegroundColor Red
            $uploadOk = $false
        }
    } catch {
        Write-Host "  [ERROR] $_" -ForegroundColor Red
        $uploadOk = $false
    }
}

# 3. Upload management-ui
if ($uploadOk) {
    Write-Host "  3/4 Uploading management-ui..." -ForegroundColor Gray
    $uiArgs = @()
    if ($UseKey) { $uiArgs += "-i"; $uiArgs += $KeyPath }
    $uiArgs += "-r"; $uiArgs += $managementUiPath; $uiArgs += "${Username}@${ServerIP}:${RemotePath}/"
    try {
        & scp @uiArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [ERROR] management-ui upload failed" -ForegroundColor Red
            $uploadOk = $false
        }
    } catch {
        Write-Host "  [ERROR] $_" -ForegroundColor Red
        $uploadOk = $false
    }
}

# 4. Upload dns-api
if ($uploadOk) {
    Write-Host "  4/4 Uploading dns-api..." -ForegroundColor Gray
    $dnsApiArgs = @()
    if ($UseKey) { $dnsApiArgs += "-i"; $dnsApiArgs += $KeyPath }
    $dnsApiArgs += "-r"; $dnsApiArgs += $dnsApiPath; $dnsApiArgs += "${Username}@${ServerIP}:${RemotePath}/scripts/"
    try {
        & scp @dnsApiArgs
        if ($LASTEXITCODE -ne 0) {
            Write-Host "  [ERROR] dns-api upload failed" -ForegroundColor Red
            $uploadOk = $false
        }
    } catch {
        Write-Host "  [ERROR] $_" -ForegroundColor Red
        $uploadOk = $false
    }
}

if ($uploadOk) {
    Write-Host ""
    Write-Host "Files uploaded successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Next steps on server:" -ForegroundColor Cyan
    Write-Host "  1. ssh ${Username}@${ServerIP}" -ForegroundColor White
    Write-Host "  2. cd ${RemotePath}/scripts/single-machine" -ForegroundColor White
    Write-Host "  3. chmod +x *.sh" -ForegroundColor White
    Write-Host "  4. sudo ./install-all.sh" -ForegroundColor White
} else {
    Write-Host ""
    Write-Host "Upload failed. Check: IP, user, SSH access" -ForegroundColor Red
    if ($UseKey) { Write-Host "  and key path: $KeyPath" -ForegroundColor Gray }
    exit 1
}
