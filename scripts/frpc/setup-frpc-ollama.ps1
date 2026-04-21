# setup-frpc-ollama.ps1 -- frpc tunnel setup for local Ollama
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File setup-frpc-ollama.ps1
# Requires: Administrator privileges (Defender exclusion + service install)
#
# Config/service names are derived from RemotePort:
#   Config:  frpc-ollama-<RemotePort>.toml
#   Service: frpc-ollama-<RemotePort>
#   Proxy:   ollama-<RemotePort>

param(
    [string]$InstallDir = 'C:\tools\frp',
    # IP вместо hostname: при переподключении DNS-резолв периодически
    # падает (no such host / i/o timeout), туннель лежит минутами.
    [string]$ServerAddr = '144.91.108.139',
    [int]$ServerPort = 17420,
    [string]$AuthToken = '6LBjqYzczHmQ6U2Q8XCqVCtxstfudzs',
    [int]$LocalPort = 11434,
    [int]$RemotePort = 11435,
    [string]$FrpVersion = '0.61.1'
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) { $InstallDir = 'C:\tools\frp' }

# Derive names from port
$ProxyName = "ollama-$RemotePort"
$configName = "frpc-ollama-$RemotePort"
$svcId = "frpc-ollama-$RemotePort"

Write-Host "=== frpc Ollama tunnel setup ===" -ForegroundColor Cyan
Write-Host "  Server:      $ServerAddr`:$ServerPort"
Write-Host "  Local:       localhost:$LocalPort (Ollama)"
Write-Host "  Remote:      localhost:$RemotePort (on server)"
Write-Host "  Proxy name:  $ProxyName"
Write-Host "  Config:      $configName.toml"
Write-Host "  Service:     $svcId"
Write-Host ""

# 1. Check admin privileges
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Run this script as Administrator" -ForegroundColor Red
    exit 1
}

# 2. Check Ollama
Write-Host "[1/6] Checking Ollama..." -ForegroundColor Yellow
try {
    $resp = Invoke-RestMethod -Uri "http://localhost:$LocalPort/api/tags" -TimeoutSec 3
    $count = $resp.models.Count
    Write-Host "  OK: Ollama available, $count models" -ForegroundColor Green
} catch {
    Write-Host "  ERROR: Ollama not responding on localhost:$LocalPort" -ForegroundColor Red
    Write-Host "  Start Ollama and try again" -ForegroundColor Red
    exit 1
}

# 3. Create directory and add Defender exclusion
Write-Host "[2/6] Setting up directory and Windows Defender..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Add-MpPreference -ExclusionPath $InstallDir
Write-Host "  OK: $InstallDir added to Defender exclusions" -ForegroundColor Green

# 4. Download frpc
$frpcPath = Join-Path $InstallDir "frpc.exe"
if (Test-Path $frpcPath) {
    Write-Host "[3/6] frpc.exe already exists, skipping download" -ForegroundColor Yellow
} else {
    Write-Host "[3/6] Downloading frpc v$FrpVersion..." -ForegroundColor Yellow
    $zipUrl = "https://github.com/fatedier/frp/releases/download/v$FrpVersion/frp_${FrpVersion}_windows_amd64.zip"
    $zipPath = Join-Path $InstallDir "frp.zip"
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
    $extractedDir = Join-Path $InstallDir "frp_${FrpVersion}_windows_amd64"
    Copy-Item (Join-Path $extractedDir "frpc.exe") $frpcPath
    Remove-Item $extractedDir -Recurse -Force
    Remove-Item $zipPath -Force
    Write-Host "  OK: frpc.exe installed" -ForegroundColor Green
}

# 5. Generate config (named by port)
Write-Host "[4/6] Generating config..." -ForegroundColor Yellow
$configPath = Join-Path $InstallDir "$configName.toml"
$config = @"
# $configName.toml -- Ollama tunnel to server
# Services on server access Ollama at localhost:$RemotePort

serverAddr = "$ServerAddr"
serverPort = $ServerPort
auth.token = "$AuthToken"

# Keep retrying, use public DNS for any lookups
loginFailExit = false
dnsServer = "1.1.1.1"

[[proxies]]
name = "$ProxyName"
type = "tcp"
localIP = "127.0.0.1"
localPort = $LocalPort
remotePort = $RemotePort
"@
[System.IO.File]::WriteAllText($configPath, $config)
Write-Host "  OK: $configPath" -ForegroundColor Green

# 6. Test connection
Write-Host "[5/6] Testing connection..." -ForegroundColor Yellow
$testLog = Join-Path $InstallDir "test.log"
$proc = Start-Process -FilePath $frpcPath -ArgumentList "-c", $configPath -PassThru -NoNewWindow -RedirectStandardError $testLog
Start-Sleep -Seconds 5
if (-not $proc.HasExited) {
    Write-Host "  OK: frpc connected to server" -ForegroundColor Green
    Stop-Process -Id $proc.Id -Force
} else {
    $log = Get-Content $testLog -Raw
    Write-Host "  ERROR: frpc failed to connect" -ForegroundColor Red
    Write-Host $log -ForegroundColor Red
    exit 1
}
Remove-Item $testLog -Force -ErrorAction SilentlyContinue

# 7. Install Windows service via WinSW (named by port)
Write-Host "[6/6] Installing Windows service..." -ForegroundColor Yellow
$svcExe = Join-Path $InstallDir "$svcId-svc.exe"
$svcXml = Join-Path $InstallDir "$svcId-svc.xml"

if (-not (Test-Path $svcExe)) {
    $winswUrl = "https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe"
    Invoke-WebRequest -Uri $winswUrl -OutFile $svcExe
}

$svcConfig = @"
<service>
  <id>$svcId</id>
  <name>frpc Ollama Tunnel ($ProxyName, port $RemotePort)</name>
  <description>TCP tunnel: server localhost:$RemotePort to local Ollama localhost:$LocalPort via frp</description>
  <executable>$frpcPath</executable>
  <arguments>-c $configPath</arguments>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>3</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <startmode>Automatic</startmode>
</service>
"@
[System.IO.File]::WriteAllText($svcXml, $svcConfig)

# Remove old service if exists
$existing = Get-Service -Name $svcId -ErrorAction SilentlyContinue
if ($existing) {
    if ($existing.Status -eq 'Running') { Stop-Service $svcId -Force }
    & $svcExe uninstall
    Start-Sleep -Seconds 2
}

& $svcExe install
& $svcExe start
Start-Sleep -Seconds 2

$svc = Get-Service -Name $svcId
if ($svc.Status -eq 'Running') {
    Write-Host "  OK: Service installed and running (autostart)" -ForegroundColor Green
} else {
    Write-Host "  ERROR: Service failed to start (status: $($svc.Status))" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
Write-Host "  Service:  $svcId (autostart on Windows boot)"
Write-Host "  Verify:   curl http://localhost:$RemotePort/api/tags"
Write-Host "  Manage:   Start-Service / Stop-Service $svcId"
Write-Host "  Logs:     $InstallDir\$svcId-svc.*.log"
