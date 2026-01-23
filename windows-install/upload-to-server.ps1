# PowerShell script for uploading files to server via SCP
# Usage: .\upload-to-server.ps1
#
# Примечание: Скрипт можно запускать из любой директории.
# Он автоматически определит свое расположение и найдет все необходимые файлы.

param(
    [string]$ServerIP = "",
    [string]$Username = "",
    [string]$RemotePath = "~/windows-install",
    [switch]$UseKey = $false,
    [string]$KeyPath = ""
)

# Определение директории скрипта (абсолютный путь)
# Это позволяет запускать скрипт из любой директории
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ConfigFile = "$env:USERPROFILE\.upload-config.json"

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

Write-Host "=== Uploading scripts to server via SCP ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Script directory: $ScriptDir" -ForegroundColor Gray
Write-Host ""

# Check if SCP command exists
$scpCheck = Get-Command scp -ErrorAction SilentlyContinue
if (-not $scpCheck) {
    Write-Host "Error: 'scp' command not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install OpenSSH client:" -ForegroundColor Yellow
    Write-Host "  1. Open 'Settings' -> 'Apps' -> 'Optional features'" -ForegroundColor White
    Write-Host "  2. Find 'OpenSSH Client' and install" -ForegroundColor White
    Write-Host ""
    Write-Host "Or use alternative:" -ForegroundColor Yellow
    Write-Host "  - WinSCP (https://winscp.net)" -ForegroundColor White
    Write-Host "  - FileZilla (https://filezilla-project.org)" -ForegroundColor White
    Write-Host "  - PuTTY (https://www.putty.org)" -ForegroundColor White
    exit 1
}
$scpCommand = "scp"

# Request connection data with saved defaults
if ([string]::IsNullOrEmpty($ServerIP)) {
    $ServerIP = Get-PromptWithDefault -Prompt "Enter server IP address" -Key "server_ip"
}

if ([string]::IsNullOrEmpty($Username)) {
    $Username = Get-PromptWithDefault -Prompt "Enter username (usually root)" -Key "username" -DefaultValue "root"
}

if ([string]::IsNullOrEmpty($RemotePath)) {
    $savedPath = Get-ConfigValue -Key "remote_path"
    $defaultPath = if ($savedPath) { $savedPath } else { "~/windows-install" }
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

# List of files to upload (абсолютные пути относительно скрипта)
$filesToUpload = @(
    "$ScriptDir\install-windows.sh",
    "$ScriptDir\setup-grub.sh",
    "$ScriptDir\download-windows-iso.sh"
)

# Check if files exist
Write-Host "Checking files for upload..." -ForegroundColor Yellow
$missingFiles = @()
foreach ($file in $filesToUpload) {
    if (-not (Test-Path $file)) {
        $missingFiles += $file
        Write-Host "  [X] $file - not found" -ForegroundColor Red
    } else {
        Write-Host "  [OK] $file - found" -ForegroundColor Green
    }
}

if ($missingFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "Error: Some files not found!" -ForegroundColor Red
    Write-Host "Make sure all scripts are in the current directory." -ForegroundColor Yellow
    exit 1
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
$remoteTarget = "${Username}@${ServerIP}:${RemotePath}"
$scpArgs += $remoteTarget

# Display command for verification
Write-Host ""
Write-Host "Command to execute:" -ForegroundColor Cyan
Write-Host "$scpCommand $($scpArgs -join ' ')" -ForegroundColor Gray
Write-Host ""

# Execute command
try {
    Write-Host "Uploading files to server..." -ForegroundColor Yellow
    Write-Host "This may take some time..." -ForegroundColor Gray
    if (-not $UseKey) {
        Write-Host "Enter password when prompted:" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # Execute SCP command directly (to support interactive password input)
    & $scpCommand $scpArgs
    
    if ($LASTEXITCODE -eq 0 -or $?) {
        Write-Host ""
        Write-Host "Files uploaded successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps on server:" -ForegroundColor Cyan
        Write-Host "1. Connect via SSH: ssh ${Username}@${ServerIP}" -ForegroundColor White
        Write-Host "2. Go to directory: cd ${RemotePath}" -ForegroundColor White
        Write-Host "3. Make scripts executable: chmod +x *.sh" -ForegroundColor White
        Write-Host "4. Start installation: sudo su" -ForegroundColor White
        Write-Host "5. Run: ./install-windows.sh" -ForegroundColor White
    } else {
        Write-Host ""
        $exitCode = if ($LASTEXITCODE) { $LASTEXITCODE } else { "unknown" }
        Write-Host "Error uploading files! (Exit code: $exitCode)" -ForegroundColor Red
        Write-Host ""
        Write-Host "Check:" -ForegroundColor Yellow
        Write-Host "  - Correctness of IP address and username" -ForegroundColor White
        Write-Host "  - Server availability (ping $ServerIP)" -ForegroundColor White
        Write-Host "  - SSH access (ssh ${Username}@${ServerIP})" -ForegroundColor White
        if ($UseKey) {
            Write-Host "  - Correctness of SSH key path: $KeyPath" -ForegroundColor White
            Write-Host "  - Key permissions (should be 600)" -ForegroundColor White
        } else {
            Write-Host "  - Correctness of password" -ForegroundColor White
        }
        Write-Host ""
        Write-Host "For diagnostics, try connecting manually:" -ForegroundColor Yellow
        if ($UseKey) {
            Write-Host "  ssh -i `"$KeyPath`" ${Username}@${ServerIP}" -ForegroundColor Gray
        } else {
            Write-Host "  ssh ${Username}@${ServerIP}" -ForegroundColor Gray
        }
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "Error: $_" -ForegroundColor Red
    Write-Host ""
    Write-Host "Make sure:" -ForegroundColor Yellow
    Write-Host "  - OpenSSH client is installed (usually built-in Windows 10/11)" -ForegroundColor White
    Write-Host "  - Or use alternative: WinSCP, FileZilla, PuTTY" -ForegroundColor White
    exit 1
}
