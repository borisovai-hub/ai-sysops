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
    [string]$KeyPath = ""
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

# Check if SCP command exists
$scpCheck = Get-Command scp -ErrorAction SilentlyContinue
if (-not $scpCheck) {
    Write-Host "Error: 'scp' command not found!" -ForegroundColor Red
    Write-Host ""
    Write-Host "Install OpenSSH client or use alternative: WinSCP, FileZilla" -ForegroundColor Yellow
    exit 1
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

# List of files to upload (абсолютные пути относительно скрипта)
$filesToUpload = @(
    "$ScriptDir\single-machine\common.sh",
    "$ScriptDir\single-machine\install-all.sh",
    "$ScriptDir\single-machine\install-traefik.sh",
    "$ScriptDir\single-machine\install-gitlab.sh",
    "$ScriptDir\single-machine\install-n8n.sh",
    "$ScriptDir\single-machine\install-management-ui.sh",
    "$ScriptDir\single-machine\setup-dns-api.sh",
    "$ScriptDir\single-machine\configure-traefik.sh"
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

# Check management-ui directory (абсолютный путь)
$managementUiPath = "$ProjectRoot\management-ui"
if (-not (Test-Path $managementUiPath)) {
    $missingFiles += "management-ui/"
    Write-Host "  [X] management-ui/ - not found at $managementUiPath" -ForegroundColor Red
} else {
    Write-Host "  [OK] management-ui/ - found at $managementUiPath" -ForegroundColor Green
}

# Check dns-api directory (абсолютный путь)
$dnsApiPath = "$ScriptDir\dns-api"
if (-not (Test-Path $dnsApiPath)) {
    $missingFiles += "dns-api/"
    Write-Host "  [X] dns-api/ - not found at $dnsApiPath" -ForegroundColor Red
} else {
    Write-Host "  [OK] dns-api/ - found at $dnsApiPath" -ForegroundColor Green
}

if ($missingFiles.Count -gt 0) {
    Write-Host ""
    Write-Host "Error: Some files not found!" -ForegroundColor Red
    Write-Host "Make sure all scripts are in the correct directories." -ForegroundColor Yellow
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
$remoteTarget = "${Username}@${ServerIP}:${RemotePath}/scripts/single-machine"
$scpArgs += $remoteTarget

# Display command
Write-Host ""
Write-Host "Command to execute:" -ForegroundColor Cyan
Write-Host "scp $($scpArgs -join ' ')" -ForegroundColor Gray
Write-Host ""

# Execute command
try {
    Write-Host "Uploading files to server..." -ForegroundColor Yellow
    Write-Host "This may take some time..." -ForegroundColor Gray
    if (-not $UseKey) {
        Write-Host "Enter password when prompted:" -ForegroundColor Yellow
    }
    Write-Host ""
    
    # Create directory on server
    $sshArgs = @()
    if ($UseKey) {
        $sshArgs += "-i"
        $sshArgs += $KeyPath
    }
    $sshArgs += "${Username}@${ServerIP}"
    $sshArgs += "mkdir -p ${RemotePath}/scripts/single-machine"
    
    & ssh $sshArgs
    
    # Upload scripts
    & scp $scpArgs
    
    # Upload management-ui (используем абсолютный путь)
    $uiArgs = @()
    if ($UseKey) {
        $uiArgs += "-i"
        $uiArgs += $KeyPath
    }
    $uiArgs += "-r"
    $uiArgs += $managementUiPath
    $uiArgs += "${Username}@${ServerIP}:${RemotePath}/"
    
    & scp $uiArgs
    
    # Upload dns-api (используем абсолютный путь)
    $dnsApiArgs = @()
    if ($UseKey) {
        $dnsApiArgs += "-i"
        $dnsApiArgs += $KeyPath
    }
    $dnsApiArgs += "-r"
    $dnsApiArgs += $dnsApiPath
    $dnsApiArgs += "${Username}@${ServerIP}:${RemotePath}/scripts/"
    
    & scp $dnsApiArgs
    
    if ($LASTEXITCODE -eq 0 -or $?) {
        Write-Host ""
        Write-Host "Files uploaded successfully!" -ForegroundColor Green
        Write-Host ""
        Write-Host "Next steps on server:" -ForegroundColor Cyan
        Write-Host "1. Connect via SSH: ssh ${Username}@${ServerIP}" -ForegroundColor White
        Write-Host "2. Go to directory: cd ${RemotePath}/scripts/single-machine" -ForegroundColor White
        Write-Host "3. Make scripts executable: chmod +x *.sh" -ForegroundColor White
        Write-Host "4. Run installation: sudo ./install-all.sh" -ForegroundColor White
    } else {
        Write-Host ""
        Write-Host "Error uploading files!" -ForegroundColor Red
        exit 1
    }
} catch {
    Write-Host ""
    Write-Host "Error: $_" -ForegroundColor Red
    exit 1
}
