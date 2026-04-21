# setup-frpc-ollama-tier.ps1 -- Install frpc with tier config (2 proxies in one process)
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File setup-frpc-ollama-tier.ps1
# Requires: Administrator privileges
#
# Service: frpc-ollama-tier
# Config:  C:\tools\frp\frpc-ollama-tier.toml (contains ollama-11435 + ollama-11436 proxies)
#
# This script removes any OTHER frpc-ollama* services first to avoid
# multiple frpc processes fighting for the same proxy names on the server.

param(
    [string]$InstallDir = 'C:\tools\frp',
    # IP вместо hostname: при переподключении DNS-резолв периодически
    # падает (no such host / i/o timeout), туннель лежит минутами.
    [string]$ServerAddr = '144.91.108.139',
    [int]$ServerPort = 17420,
    [string]$AuthToken = '6LBjqYzczHmQ6U2Q8XCqVCtxstfudzs',
    [int]$LocalPort = 11434,
    [int[]]$RemotePorts = @(11435, 11436),
    [string]$FrpVersion = '0.61.1',
    [string]$ConfigSource = ''
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) { $InstallDir = 'C:\tools\frp' }

$svcId = 'frpc-ollama-tier'
$configPath = Join-Path $InstallDir 'frpc-ollama-tier.toml'

Write-Host "=== frpc Ollama tier tunnel setup ===" -ForegroundColor Cyan
Write-Host "  Service:     $svcId"
Write-Host "  Config:      $configPath"
Write-Host "  Server:      $ServerAddr`:$ServerPort"
Write-Host "  Local port:  $LocalPort (Ollama main, used as fallback localPort)"
Write-Host "  Remote ports: $($RemotePorts -join ', ')"
Write-Host ""

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Run this script as Administrator" -ForegroundColor Red
    exit 1
}

# [0/6] Remove ALL existing frpc-ollama* services
Write-Host "[0/6] Cleaning up existing frpc-ollama* services..." -ForegroundColor Yellow
$oldSvcs = Get-Service -Name 'frpc-ollama*' -ErrorAction SilentlyContinue
if ($oldSvcs) {
    foreach ($svc in $oldSvcs) {
        Write-Host "  Removing $($svc.Name) (status: $($svc.Status))..." -ForegroundColor Yellow
        if ($svc.Status -eq 'Running') {
            Stop-Service $svc.Name -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        }
        $wrapper = Join-Path $InstallDir "$($svc.Name)-svc.exe"
        if (-not (Test-Path $wrapper)) {
            $wrapper = Join-Path $InstallDir "$($svc.Name).exe"
        }
        if (Test-Path $wrapper) {
            & $wrapper uninstall 2>&1 | Out-Null
        } else {
            & sc.exe delete $svc.Name | Out-Null
        }
    }
    Start-Sleep -Seconds 2
    Write-Host "  OK: removed $($oldSvcs.Count) old services" -ForegroundColor Green
} else {
    Write-Host "  OK: no existing frpc-ollama* services" -ForegroundColor Green
}

# Kill any stray frpc.exe processes (not wrapped by WinSW)
$strayFrpc = Get-Process -Name 'frpc' -ErrorAction SilentlyContinue
if ($strayFrpc) {
    foreach ($p in $strayFrpc) {
        Write-Host "  Killing stray frpc PID=$($p.Id)" -ForegroundColor Yellow
        Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue
    }
    Start-Sleep -Seconds 2
}

# [1/6] Check Ollama
Write-Host "[1/6] Checking main Ollama on :$LocalPort..." -ForegroundColor Yellow
try {
    Invoke-RestMethod -Uri "http://localhost:$LocalPort/api/tags" -TimeoutSec 3 | Out-Null
    Write-Host "  OK: Ollama on :$LocalPort responds" -ForegroundColor Green
} catch {
    Write-Host "  WARN: Ollama on :$LocalPort not responding (tunnel can still start)" -ForegroundColor Yellow
}

# [2/6] Install dir and Defender exclusion
Write-Host "[2/6] Directory and Defender exclusion..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
Add-MpPreference -ExclusionPath $InstallDir -ErrorAction SilentlyContinue
Write-Host "  OK: $InstallDir ready" -ForegroundColor Green

# [3/6] Download frpc
$frpcPath = Join-Path $InstallDir 'frpc.exe'
if (Test-Path $frpcPath) {
    Write-Host "[3/6] frpc.exe already exists, skipping download" -ForegroundColor Yellow
} else {
    Write-Host "[3/6] Downloading frpc v$FrpVersion..." -ForegroundColor Yellow
    $zipUrl = "https://github.com/fatedier/frp/releases/download/v$FrpVersion/frp_${FrpVersion}_windows_amd64.zip"
    $zipPath = Join-Path $InstallDir 'frp.zip'
    Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
    Expand-Archive -Path $zipPath -DestinationPath $InstallDir -Force
    $extractedDir = Join-Path $InstallDir "frp_${FrpVersion}_windows_amd64"
    Copy-Item (Join-Path $extractedDir 'frpc.exe') $frpcPath
    Remove-Item $extractedDir -Recurse -Force
    Remove-Item $zipPath -Force
    Write-Host "  OK: frpc.exe installed" -ForegroundColor Green
}

# [4/6] Generate or copy config
Write-Host "[4/6] Writing tier config..." -ForegroundColor Yellow
if ($ConfigSource -and (Test-Path $ConfigSource)) {
    Copy-Item $ConfigSource $configPath -Force
    Write-Host "  OK: copied from $ConfigSource" -ForegroundColor Green
} else {
    # Generate from parameters -- both proxies point to local Ollama ports (same machine has multiple Ollama instances on those ports)
    $proxiesBlock = ''
    foreach ($p in $RemotePorts) {
        $proxiesBlock += @"

[[proxies]]
name = "ollama-$p"
type = "tcp"
localIP = "127.0.0.1"
localPort = $p
remotePort = $p
"@
    }
    $config = @"
# frpc-ollama-tier.toml -- Ollama multi-port tunnel (auto-generated)
# Single frpc process, multiple proxies on one control channel

serverAddr = "$ServerAddr"
serverPort = $ServerPort
auth.token = "$AuthToken"

# Do not exit on login failure -- keep retrying
loginFailExit = false

# Resolve external lookups via public DNS (no local resolver dependency)
dnsServer = "1.1.1.1"

# Use default heartbeat settings (interval=30s, timeout=90s)
# Aggressive values caused reconnects every 30-90s on noisy networks
$proxiesBlock
"@
    [System.IO.File]::WriteAllText($configPath, $config)
    Write-Host "  OK: generated $configPath with $($RemotePorts.Count) proxies" -ForegroundColor Green
}

# [5/6] Test connection
Write-Host "[5/6] Testing connection..." -ForegroundColor Yellow
$testLog = Join-Path $InstallDir 'test.log'
$proc = Start-Process -FilePath $frpcPath -ArgumentList '-c', $configPath -PassThru -NoNewWindow -RedirectStandardError $testLog
Start-Sleep -Seconds 5
if (-not $proc.HasExited) {
    Write-Host "  OK: frpc connected to server" -ForegroundColor Green
    Stop-Process -Id $proc.Id -Force
    Start-Sleep -Seconds 2
} else {
    $log = Get-Content $testLog -Raw
    Write-Host "  ERROR: frpc failed to connect" -ForegroundColor Red
    Write-Host $log -ForegroundColor Red
    exit 1
}
Remove-Item $testLog -Force -ErrorAction SilentlyContinue

# [6/6] Install service via WinSW
Write-Host "[6/6] Installing Windows service..." -ForegroundColor Yellow
$svcExe = Join-Path $InstallDir "$svcId-svc.exe"
$svcXml = Join-Path $InstallDir "$svcId-svc.xml"

if (-not (Test-Path $svcExe)) {
    $winswUrl = 'https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe'
    Invoke-WebRequest -Uri $winswUrl -OutFile $svcExe
}

$svcConfig = @"
<service>
  <id>$svcId</id>
  <name>frpc Ollama Tier Tunnel</name>
  <description>TCP tunnels for Ollama tier instances (ports $($RemotePorts -join ', ')) via frp</description>
  <executable>$frpcPath</executable>
  <arguments>-c $configPath</arguments>
  <log mode="roll-by-size">
    <sizeThreshold>10240</sizeThreshold>
    <keepFiles>3</keepFiles>
  </log>
  <onfailure action="restart" delay="10 sec"/>
  <onfailure action="restart" delay="30 sec"/>
  <onfailure action="restart" delay="60 sec"/>
  <resetfailure>1 hour</resetfailure>
  <startmode>Automatic</startmode>
  <delayedAutoStart>true</delayedAutoStart>
</service>
"@
[System.IO.File]::WriteAllText($svcXml, $svcConfig)

& $svcExe install
& $svcExe start
Start-Sleep -Seconds 3

$svc = Get-Service -Name $svcId
if ($svc.Status -eq 'Running') {
    Write-Host "  OK: $svcId running (autostart)" -ForegroundColor Green
} else {
    Write-Host "  ERROR: Service failed to start (status: $($svc.Status))" -ForegroundColor Red
    Write-Host "  Check: Get-Content $InstallDir\$svcId-svc.err.log -Tail 30" -ForegroundColor Red
    exit 1
}

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
$proxyNames = ($RemotePorts | ForEach-Object { "ollama-$_" }) -join ', '
Write-Host "  Service:  $svcId (autostart on Windows boot)"
Write-Host "  Config:   $configPath"
Write-Host "  Proxies:  $proxyNames"
Write-Host "  Verify on server:"
foreach ($p in $RemotePorts) {
    Write-Host "    curl http://localhost:$p/api/tags"
}
Write-Host "  Manage:   Start-Service / Stop-Service $svcId"
Write-Host "  Logs:     $InstallDir\$svcId-svc.*.log"
