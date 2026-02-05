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
    [switch]$Check = $false,
    [switch]$Auto = $false,
    [switch]$Force = $false
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
    "$ScriptDir\single-machine\add-mailu-calendar.sh",
    "$ScriptDir\single-machine\setup-mailu-calendar-roundcube.sh",
    "$ScriptDir\single-machine\install-mailu-infcloud.sh",
    "$ScriptDir\single-machine\install-gitlab-runner.sh",
    "$ScriptDir\single-machine\setup-cicd.sh",
    "$ScriptDir\single-machine\configure-traefik-deploy.sh",
    "$ScriptDir\single-machine\mailu-setup-render.py",
    "$ScriptDir\single-machine\setup-dns-api.sh",
    "$ScriptDir\single-machine\configure-traefik.sh",
    "$ScriptDir\single-machine\configure-gitlab-smtp.sh",
    "$ScriptDir\single-machine\configure-gitlab-smtp-quick.sh",
    "$ScriptDir\single-machine\add-ssl-domains.sh",
    "$ScriptDir\single-machine\manage-base-domains.sh",
    "$ScriptDir\single-machine\fix-mtu-issue.sh",
    "$ScriptDir\single-machine\disable-http2-traefik.sh"
)
$managementUiPath = "$ProjectRoot\management-ui"
$dnsApiPath = "$ScriptDir\dns-api"
$roundcubeCalendarLinkPath = "$ScriptDir\single-machine\roundcube-calendar-link"
$configCicdPath = "$ProjectRoot\config\single-machine\cicd"
$configTraefikDynamicPath = "$ProjectRoot\config\single-machine\traefik\dynamic"

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
if (-not (Test-Path $configCicdPath)) {
    Write-Host "  [!] config/single-machine/cicd/ - not found (optional)" -ForegroundColor Yellow
} else {
    Write-Host "  [OK] config/single-machine/cicd/ - found" -ForegroundColor Green
}
if (-not (Test-Path $roundcubeCalendarLinkPath)) {
    Write-Host "  [!] single-machine/roundcube-calendar-link/ - not found (optional, for Roundcube calendar button)" -ForegroundColor Yellow
} else {
    Write-Host "  [OK] single-machine/roundcube-calendar-link/ - found" -ForegroundColor Green
}
if (-not (Test-Path $configTraefikDynamicPath)) {
    Write-Host "  [!] config/single-machine/traefik/dynamic/ - not found (optional)" -ForegroundColor Yellow
} else {
    Write-Host "  [OK] config/single-machine/traefik/dynamic/ - found" -ForegroundColor Green
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
if ($Auto) {
    # Автоматический режим - используем сохранённые данные
    $ServerIP = Get-ConfigValue -Key "server_ip"
    $Username = Get-ConfigValue -Key "username"
    $RemotePath = Get-ConfigValue -Key "remote_path"
    $savedUseKey = Get-ConfigValue -Key "use_key"
    $KeyPath = Get-ConfigValue -Key "key_path"
    
    if ([string]::IsNullOrEmpty($ServerIP) -or [string]::IsNullOrEmpty($Username)) {
        Write-Host "Error: In auto mode, saved data is required" -ForegroundColor Red
        Write-Host "First run script without -Auto to save configuration" -ForegroundColor Yellow
        exit 1
    }
    
    if ([string]::IsNullOrEmpty($RemotePath)) {
        $RemotePath = "~/install"
    }
    
    if ($savedUseKey -eq "true") {
        $UseKey = $true
        if ([string]::IsNullOrEmpty($KeyPath)) {
            $KeyPath = "$env:USERPROFILE\.ssh\id_rsa"
        }
    }
    
    Write-Host "Auto mode: using saved configuration" -ForegroundColor Cyan
    Write-Host "  Server: ${Username}@${ServerIP}" -ForegroundColor Gray
    Write-Host "  Path: ${RemotePath}" -ForegroundColor Gray
} else {
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
Write-Host "  1/7 Creating directories..." -ForegroundColor Gray
try {
    if (-not (Invoke-Ssh "mkdir -p ${RemotePath}/scripts/single-machine ${RemotePath}/scripts/dns-api ${RemotePath}/config/single-machine/cicd ${RemotePath}/config/single-machine/traefik/dynamic")) {
        Write-Host "  [ERROR] SSH or mkdir failed" -ForegroundColor Red
        $uploadOk = $false
    }
} catch {
    Write-Host "  [ERROR] $_" -ForegroundColor Red
    $uploadOk = $false
}

# Функция для получения времени модификации файла (Unix timestamp, секунды с 1970-01-01 UTC)
# Сервер возвращает stat -c %Y (тоже Unix), иначе сравнение неверно — все файлы считаются изменёнными
function Get-FileMtime {
    param([string]$FilePath)
    if (Test-Path $FilePath) {
        $lastWrite = (Get-Item $FilePath).LastWriteTime
        return [long][DateTimeOffset]::new($lastWrite).ToUnixTimeSeconds()
    }
    return 0
}

# Локальный кэш mtime: сохраняем время после загрузки, сравниваем по нему (без SSH)
# Файл: $env:USERPROFILE\.upload-single-machine-mtimes-<target>.cache, строки "path|mtime"
$script:UploadCacheFile = ""
function Initialize-UploadCache {
    $key = "${Username}@${ServerIP}:${RemotePath}" -replace '[^a-zA-Z0-9._-]', '_'
    $script:UploadCacheFile = "$env:USERPROFILE\.upload-single-machine-mtimes-${key}.cache"
}
function Get-SavedMtime {
    param([string]$Path)
    if (-not $script:UploadCacheFile -or -not (Test-Path $script:UploadCacheFile)) { return $null }
    $raw = Get-Content -LiteralPath $script:UploadCacheFile -Raw -ErrorAction SilentlyContinue
    if (-not $raw) { return $null }
    $lines = $raw -split "`r?`n"
    $line = $lines | Where-Object { $_.Trim().StartsWith("${Path}|") } | Select-Object -First 1
    if (-not $line) { return $null }
    $afterPipe = ($line.ToString().Trim() -split '\|', 2)[1]
    if (-not $afterPipe) { return $null }
    $mtimeStr = ($afterPipe.Trim() -replace '[^0-9]', '')
    if ([string]::IsNullOrEmpty($mtimeStr)) { return $null }
    $m = 0L
    if ([long]::TryParse($mtimeStr, [ref]$m)) { return $m }
    return $null
}
function Save-SavedMtime {
    param([string]$Path, [long]$Mtime)
    if (-not $Path) { return }
    $content = @()
    if (Test-Path $script:UploadCacheFile) {
        $raw = Get-Content -LiteralPath $script:UploadCacheFile -Raw -ErrorAction SilentlyContinue
        if ($raw) {
            $lines = $raw -split "`r?`n"
            $content = @($lines | Where-Object { $_.Trim() -ne '' -and ($_.Trim() -split '\|', 2)[0].Trim() -ne $Path })
        }
    }
    $content += "${Path}|${Mtime}"
    $content | Set-Content -LiteralPath $script:UploadCacheFile -Encoding UTF8
}
# Нужно ли отправлять: сравниваем локальный mtime с сохранённым (без SSH)
function Should-UploadFile {
    param([string]$LocalFile, [string]$CachePath)
    if ($Force) { return $true }
    if (-not (Test-Path $LocalFile)) { return $false }
    $localMtime = Get-FileMtime -FilePath $LocalFile
    if ($localMtime -le 0) { return $false }
    $saved = Get-SavedMtime -Path $CachePath
    if ($null -eq $saved) { return $true }
    return $localMtime -gt $saved
}

# Сохранить mtime для всех файлов в директории (после успешной загрузки)
function Save-DirMtimesToCache {
    param([string]$LocalDir, [string]$CachePrefix)
    if (-not (Test-Path $LocalDir)) { return }
    Get-ChildItem -Path $LocalDir -Recurse -File | ForEach-Object {
        $relPath = $_.FullName.Substring($LocalDir.Length + 1).Replace("\", "/")
        $mtime = Get-FileMtime -FilePath $_.FullName
        Save-SavedMtime -Path "${CachePrefix}/${relPath}" -Mtime $mtime
    }
}

# Функция для проверки и отправки директории (сравнение по локальному кэшу mtime)
function Test-DirectoryChanged {
    param(
        [string]$LocalDir,
        [string]$RemoteDir,
        [string]$DirName
    )
    
    if (-not (Test-Path $LocalDir)) { return $false }
    if ($Force) {
        Write-Host "    [Force] Uploading entire directory $DirName" -ForegroundColor Yellow
        return $true
    }
    
    $hasChanges = $false
    $filesToCheck = 0
    $changedFiles = 0
    
    Get-ChildItem -Path $LocalDir -Recurse -File | ForEach-Object {
        $filesToCheck++
        $relPath = $_.FullName.Substring($LocalDir.Length + 1).Replace("\", "/")
        $cachePath = "${DirName}/${relPath}"
        
        if (Should-UploadFile -LocalFile $_.FullName -CachePath $cachePath) {
            $hasChanges = $true
            $changedFiles++
            if (-not $Check) { Write-Host "      [Changed] $relPath" -ForegroundColor Yellow }
        }
    }
    
    if ($filesToCheck -eq 0) {
        Write-Host "    [Skip] $DirName - directory is empty" -ForegroundColor Gray
        return $false
    }
    
    if ($hasChanges) {
        if (-not $Check) {
            Write-Host "    [Changed] $DirName : $changedFiles of $filesToCheck files" -ForegroundColor Yellow
        }
        return $true
    } else {
        if (-not $Check) {
            Write-Host "    [Skip] $DirName - no changes ($filesToCheck files)" -ForegroundColor Gray
        }
        return $false
    }
}

Initialize-UploadCache

# 2. Upload scripts
if ($uploadOk) {
    Write-Host "  2/7 Uploading single-machine scripts..." -ForegroundColor Gray
    
    if ($Force) {
        # Принудительная отправка всех файлов
        try {
            & scp @scpArgs
            if ($LASTEXITCODE -ne 0) {
                Write-Host "  [ERROR] Scripts upload failed" -ForegroundColor Red
                $uploadOk = $false
            } else {
                Write-Host "  [OK] All scripts uploaded (force mode)" -ForegroundColor Green
            }
        } catch {
            Write-Host "  [ERROR] $_" -ForegroundColor Red
            $uploadOk = $false
        }
    } else {
        $filesToUploadFiltered = @()
        foreach ($file in $filesToUpload) {
            if (Test-Path $file) {
                $filename = Split-Path -Leaf $file
                $cachePath = "single-machine/$filename"
                if (Should-UploadFile -LocalFile $file -CachePath $cachePath) {
                    $filesToUploadFiltered += $file
                    Write-Host "    [Changed] $filename" -ForegroundColor Yellow
                } else {
                    Write-Host "    [Skip] $filename - no changes" -ForegroundColor Gray
                }
            }
        }
        
        if ($filesToUploadFiltered.Count -gt 0) {
            $filteredScpArgs = @()
            if ($UseKey) {
                $filteredScpArgs += "-i"
                $filteredScpArgs += $KeyPath
            }
            $filteredScpArgs += $filesToUploadFiltered
            $filteredScpArgs += "${Username}@${ServerIP}:${RemotePath}/scripts/single-machine/"
            
            try {
                & scp @filteredScpArgs
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "  [ERROR] Scripts upload failed" -ForegroundColor Red
                    $uploadOk = $false
                } else {
                    foreach ($file in $filesToUploadFiltered) {
                        $filename = Split-Path -Leaf $file
                        $mtime = Get-FileMtime -FilePath $file
                        Save-SavedMtime -Path "single-machine/$filename" -Mtime $mtime
                    }
                    Write-Host "  [OK] Uploaded $($filesToUploadFiltered.Count) changed file(s)" -ForegroundColor Green
                }
            } catch {
                Write-Host "  [ERROR] $_" -ForegroundColor Red
                $uploadOk = $false
            }
        } else {
            Write-Host "  [Skip] No changed files to upload" -ForegroundColor Gray
        }
    }
}

# 3. Upload management-ui
if ($uploadOk) {
    Write-Host "  3/7 Uploading management-ui..." -ForegroundColor Gray
    if (Test-DirectoryChanged -LocalDir $managementUiPath -RemoteDir "${RemotePath}/management-ui" -DirName "management-ui") {
        if (-not $Check) {
            $uiArgs = @()
            if ($UseKey) { $uiArgs += "-i"; $uiArgs += $KeyPath }
            $uiArgs += "-r"; $uiArgs += $managementUiPath; $uiArgs += "${Username}@${ServerIP}:${RemotePath}/"
            try {
                & scp @uiArgs
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "  [ERROR] management-ui upload failed" -ForegroundColor Red
                    $uploadOk = $false
                } else {
                    Save-DirMtimesToCache -LocalDir $managementUiPath -CachePrefix "management-ui"
                    Write-Host "  [OK] management-ui uploaded" -ForegroundColor Green
                }
            } catch {
                Write-Host "  [ERROR] $_" -ForegroundColor Red
                $uploadOk = $false
            }
        }
    }
}

# 4. Upload dns-api
if ($uploadOk) {
    Write-Host "  4/7 Uploading dns-api..." -ForegroundColor Gray
    if (Test-DirectoryChanged -LocalDir $dnsApiPath -RemoteDir "${RemotePath}/scripts/dns-api" -DirName "dns-api") {
        if (-not $Check) {
            $dnsApiArgs = @()
            if ($UseKey) { $dnsApiArgs += "-i"; $dnsApiArgs += $KeyPath }
            $dnsApiArgs += "-r"; $dnsApiArgs += $dnsApiPath; $dnsApiArgs += "${Username}@${ServerIP}:${RemotePath}/scripts/"
            try {
                & scp @dnsApiArgs
                if ($LASTEXITCODE -ne 0) {
                    Write-Host "  [ERROR] dns-api upload failed" -ForegroundColor Red
                    $uploadOk = $false
                } else {
                    Save-DirMtimesToCache -LocalDir $dnsApiPath -CachePrefix "dns-api"
                    Write-Host "  [OK] dns-api uploaded" -ForegroundColor Green
                }
            } catch {
                Write-Host "  [ERROR] $_" -ForegroundColor Red
                $uploadOk = $false
            }
        }
    }
}

# 5. Upload roundcube-calendar-link (calendar plugin for Mailu)
if ($uploadOk) {
    if (Test-Path $roundcubeCalendarLinkPath) {
        Write-Host "  5/7 Uploading roundcube-calendar-link (calendar plugin)..." -ForegroundColor Gray
        if (Test-DirectoryChanged -LocalDir $roundcubeCalendarLinkPath -RemoteDir "${RemotePath}/scripts/single-machine/roundcube-calendar-link" -DirName "roundcube-calendar-link") {
            if (-not $Check) {
                $rcArgs = @()
                if ($UseKey) { $rcArgs += "-i"; $rcArgs += $KeyPath }
                $rcArgs += "-r"; $rcArgs += $roundcubeCalendarLinkPath; $rcArgs += "${Username}@${ServerIP}:${RemotePath}/scripts/single-machine/"
                try {
                    & scp @rcArgs
                    if ($LASTEXITCODE -ne 0) {
                        Write-Host "  [ERROR] roundcube-calendar-link upload failed" -ForegroundColor Red
                        $uploadOk = $false
                    } else {
                        Save-DirMtimesToCache -LocalDir $roundcubeCalendarLinkPath -CachePrefix "roundcube-calendar-link"
                        Write-Host "  [OK] roundcube-calendar-link uploaded" -ForegroundColor Green
                    }
                } catch {
                    Write-Host "  [ERROR] $_" -ForegroundColor Red
                    $uploadOk = $false
                }
            }
        }
    } else {
        Write-Host "  5/7 [SKIP] roundcube-calendar-link not found (optional)" -ForegroundColor Yellow
    }
}

# 6. Upload config/cicd
if ($uploadOk) {
    if (Test-Path $configCicdPath) {
        Write-Host "  6/7 Uploading config/cicd..." -ForegroundColor Gray
        if (Test-DirectoryChanged -LocalDir $configCicdPath -RemoteDir "${RemotePath}/config/single-machine/cicd" -DirName "config/cicd") {
            if (-not $Check) {
                $configArgs = @()
                if ($UseKey) { $configArgs += "-i"; $configArgs += $KeyPath }
                $configArgs += "-r"; $configArgs += $configCicdPath; $configArgs += "${Username}@${ServerIP}:${RemotePath}/config/single-machine/"
                try {
                    & scp @configArgs
                    if ($LASTEXITCODE -ne 0) {
                        Write-Host "  [ERROR] config/cicd upload failed" -ForegroundColor Red
                        $uploadOk = $false
                    } else {
                        Save-DirMtimesToCache -LocalDir $configCicdPath -CachePrefix "config/cicd"
                        Write-Host "  [OK] config/cicd uploaded" -ForegroundColor Green
                    }
                } catch {
                    Write-Host "  [ERROR] $_" -ForegroundColor Red
                    $uploadOk = $false
                }
            }
        }
    } else {
        Write-Host "  6/7 [SKIP] config/cicd not found (optional)" -ForegroundColor Yellow
    }
}

# 7. Upload config/traefik/dynamic
if ($uploadOk) {
    if (Test-Path $configTraefikDynamicPath) {
        Write-Host "  7/7 Uploading config/traefik/dynamic..." -ForegroundColor Gray
        if (Test-DirectoryChanged -LocalDir $configTraefikDynamicPath -RemoteDir "${RemotePath}/config/single-machine/traefik/dynamic" -DirName "config/traefik/dynamic") {
            if (-not $Check) {
                $traefikArgs = @()
                if ($UseKey) { $traefikArgs += "-i"; $traefikArgs += $KeyPath }
                $traefikArgs += "-r"; $traefikArgs += $configTraefikDynamicPath; $traefikArgs += "${Username}@${ServerIP}:${RemotePath}/config/single-machine/traefik/"
                try {
                    & scp @traefikArgs
                    if ($LASTEXITCODE -ne 0) {
                        Write-Host "  [ERROR] config/traefik/dynamic upload failed" -ForegroundColor Red
                        $uploadOk = $false
                    } else {
                        Save-DirMtimesToCache -LocalDir $configTraefikDynamicPath -CachePrefix "config/traefik/dynamic"
                        Write-Host "  [OK] config/traefik/dynamic uploaded" -ForegroundColor Green
                    }
                } catch {
                    Write-Host "  [ERROR] $_" -ForegroundColor Red
                    $uploadOk = $false
                }
            }
        }
    } else {
        Write-Host "  7/7 [SKIP] config/traefik/dynamic not found (optional)" -ForegroundColor Yellow
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
