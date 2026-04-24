# setup-ollama-tiers.ps1 -- Launch additional Ollama instances as Windows services
# Run: powershell -NoProfile -ExecutionPolicy Bypass -File setup-ollama-tiers.ps1
# Requires: Administrator privileges
#
# Creates Windows services for extra Ollama instances on custom ports,
# sharing the model store with the main Ollama (default port 11434).
#
# Each tier has its own service: ollama-tier-<port>
# Models persist in VRAM (OLLAMA_KEEP_ALIVE=-1).

param(
    [string]$InstallDir = 'C:\tools\ollama-instances',
    [int[]]$Ports = @(11435, 11436),
    [string[]]$Names = @('tier1', 'tier23'),
    [string]$OllamaExe = '',
    [string]$OllamaModels = 'N:\ollama',
    [string]$KeepAlive = '-1',
    [string]$BindAddress = '0.0.0.0',
    [switch]$KillTrayApp,
    [switch]$SeparateModels
)

$ErrorActionPreference = 'Stop'

if (-not $InstallDir) { $InstallDir = 'C:\tools\ollama-instances' }
if ($Ports.Count -ne $Names.Count) {
    Write-Host "ERROR: Ports and Names arrays must have equal length" -ForegroundColor Red
    exit 1
}

# Check admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host "ERROR: Run this script as Administrator" -ForegroundColor Red
    exit 1
}

# Locate ollama.exe
if (-not $OllamaExe) {
    $candidates = @(
        "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe",
        "$env:ProgramFiles\Ollama\ollama.exe",
        "${env:ProgramFiles(x86)}\Ollama\ollama.exe"
    )
    foreach ($c in $candidates) {
        if (Test-Path $c) { $OllamaExe = $c; break }
    }
    if (-not $OllamaExe) {
        $cmd = Get-Command ollama -ErrorAction SilentlyContinue
        if ($cmd) { $OllamaExe = $cmd.Source }
    }
}
if (-not $OllamaExe -or -not (Test-Path $OllamaExe)) {
    Write-Host "ERROR: ollama.exe not found. Pass -OllamaExe <path>" -ForegroundColor Red
    exit 1
}

Write-Host "=== Ollama tiers setup ===" -ForegroundColor Cyan
Write-Host "  Ollama:      $OllamaExe"
Write-Host "  InstallDir:  $InstallDir"
Write-Host "  KeepAlive:   $KeepAlive"
Write-Host "  Bind:        $BindAddress  (OLLAMA_HOST=${BindAddress}:<port>)"
Write-Host "  Tiers:"
for ($i = 0; $i -lt $Ports.Count; $i++) {
    Write-Host "    $($Names[$i]) -> port $($Ports[$i])"
}
Write-Host ""

# Cleanup ALL existing ollama-tier* services (fresh install)
Write-Host "[0/4] Cleaning up existing ollama-tier* services..." -ForegroundColor Yellow
$oldSvcs = Get-Service -Name 'ollama-tier*' -ErrorAction SilentlyContinue
if ($oldSvcs) {
    foreach ($svc in $oldSvcs) {
        Write-Host "  Removing $($svc.Name) (status: $($svc.Status))..." -ForegroundColor Yellow
        if ($svc.Status -eq 'Running') {
            Stop-Service $svc.Name -Force -ErrorAction SilentlyContinue
            Start-Sleep -Seconds 1
        }
        # Find wrapper exe for this service (prefer matching <svcId>.exe in InstallDir)
        $wrapper = Join-Path $InstallDir "$($svc.Name).exe"
        if (Test-Path $wrapper) {
            & $wrapper uninstall 2>&1 | Out-Null
        } else {
            # Fallback: sc.exe delete
            & sc.exe delete $svc.Name | Out-Null
        }
    }
    Start-Sleep -Seconds 2
    Write-Host "  OK: removed $($oldSvcs.Count) old services" -ForegroundColor Green
} else {
    Write-Host "  OK: no existing tier services" -ForegroundColor Green
}

# Also clean stale wrapper exe/xml files not matching new service names
$newSvcIds = @($Ports | ForEach-Object { "ollama-tier-$_" })
Get-ChildItem -Path $InstallDir -Filter 'ollama-tier*.exe' -ErrorAction SilentlyContinue |
    Where-Object { $newSvcIds -notcontains $_.BaseName } |
    ForEach-Object {
        Write-Host "  Removing stale wrapper: $($_.Name)" -ForegroundColor Yellow
        Remove-Item $_.FullName -Force -ErrorAction SilentlyContinue
        $xml = [System.IO.Path]::ChangeExtension($_.FullName, '.xml')
        if (Test-Path $xml) { Remove-Item $xml -Force -ErrorAction SilentlyContinue }
    }
Write-Host ""

# Check for conflicting Ollama processes
Write-Host "[1/4] Checking for existing Ollama processes..." -ForegroundColor Yellow
$ollamaProcs = Get-Process -Name 'ollama','ollama app' -ErrorAction SilentlyContinue
if ($ollamaProcs) {
    Write-Host "  Found running Ollama processes:" -ForegroundColor Yellow
    $ollamaProcs | ForEach-Object { Write-Host "    PID=$($_.Id) $($_.ProcessName)" }
    if ($KillTrayApp) {
        Write-Host "  Stopping tray app and orphan serves (keeping main service if any)..." -ForegroundColor Yellow
        Stop-Process -Name 'ollama app' -Force -ErrorAction SilentlyContinue
        Get-Process -Name 'ollama' -ErrorAction SilentlyContinue | ForEach-Object {
            $cmdLine = (Get-CimInstance Win32_Process -Filter "ProcessId=$($_.Id)").CommandLine
            if ($cmdLine -notmatch 'WinSW|ollama-tier') {
                Write-Host "    killing PID=$($_.Id)" -ForegroundColor Yellow
                Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue
            }
        }
        Start-Sleep 2
    } else {
        Write-Host "  WARN: existing Ollama may conflict. Use -KillTrayApp to auto-kill." -ForegroundColor Yellow
    }
}
$mainListens = Get-NetTCPConnection -LocalPort 11434 -State Listen -ErrorAction SilentlyContinue
if ($mainListens) {
    Write-Host "  Port 11434 listener PID: $($mainListens[0].OwningProcess)" -ForegroundColor Cyan
}

# Prepare InstallDir and download WinSW
Write-Host "[2/4] Preparing service wrapper..." -ForegroundColor Yellow
New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
$winswBase = Join-Path $InstallDir 'WinSW.exe'
if (-not (Test-Path $winswBase)) {
    $winswUrl = 'https://github.com/winsw/winsw/releases/download/v3.0.0-alpha.11/WinSW-x64.exe'
    Invoke-WebRequest -Uri $winswUrl -OutFile $winswBase
}
Write-Host "  OK: WinSW ready" -ForegroundColor Green

# Resolve OLLAMA_MODELS
$ollamaModels = $OllamaModels
if (-not (Test-Path $ollamaModels)) {
    Write-Host "  WARN: $ollamaModels does not exist, creating..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $ollamaModels -Force | Out-Null
}
Write-Host "  OLLAMA_MODELS: $ollamaModels"

# Install services
Write-Host "[3/4] Installing services..." -ForegroundColor Yellow
for ($i = 0; $i -lt $Ports.Count; $i++) {
    $port = $Ports[$i]
    $tier = $Names[$i]
    $svcId = "ollama-tier-$port"
    $svcExe = Join-Path $InstallDir "$svcId.exe"
    $svcXml = Join-Path $InstallDir "$svcId.xml"

    Copy-Item $winswBase $svcExe -Force

    # Per-service models dir (symlink to shared blob store to avoid duplication)
    $instanceModels = $ollamaModels
    if ($SeparateModels) {
        $instanceModels = Join-Path $ollamaModels "_$tier"
        New-Item -ItemType Directory -Path $instanceModels -Force | Out-Null
        # Symlink blobs dir so model files are shared on disk
        $sharedBlobs = Join-Path $ollamaModels 'blobs'
        $instanceBlobs = Join-Path $instanceModels 'blobs'
        if ((Test-Path $sharedBlobs) -and -not (Test-Path $instanceBlobs)) {
            New-Item -ItemType SymbolicLink -Path $instanceBlobs -Target $sharedBlobs | Out-Null
        }
    }

    $svcConfig = @"
<service>
  <id>$svcId</id>
  <name>Ollama $tier (port $port)</name>
  <description>Additional Ollama instance on port $port (tier: $tier)</description>
  <executable>$OllamaExe</executable>
  <arguments>serve</arguments>
  <env name="OLLAMA_HOST" value="${BindAddress}:$port"/>
  <env name="OLLAMA_MODELS" value="$instanceModels"/>
  <env name="OLLAMA_KEEP_ALIVE" value="$KeepAlive"/>
  <env name="OLLAMA_SCHED_SPREAD" value="0"/>
  <env name="OLLAMA_NUM_PARALLEL" value="1"/>
  <env name="OLLAMA_MAX_LOADED_MODELS" value="1"/>
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

    # Reinstall if exists
    $existing = Get-Service -Name $svcId -ErrorAction SilentlyContinue
    if ($existing) {
        if ($existing.Status -eq 'Running') { Stop-Service $svcId -Force -ErrorAction SilentlyContinue }
        & $svcExe uninstall
        Start-Sleep -Seconds 2
    }

    & $svcExe install
    & $svcExe start
    Start-Sleep -Seconds 2

    $svc = Get-Service -Name $svcId
    if ($svc.Status -eq 'Running') {
        Write-Host "  OK: $svcId running (port $port, tier $tier)" -ForegroundColor Green
    } else {
        Write-Host "  ERROR: $svcId failed to start (status: $($svc.Status))" -ForegroundColor Red
    }
}

# Open Windows Firewall for each tier port (LAN access)
Write-Host "[4/5] Configuring Windows Firewall..." -ForegroundColor Yellow
foreach ($port in $Ports) {
    $ruleName = "Ollama Tier $port"
    Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $ruleName `
        -Direction Inbound `
        -Action Allow `
        -Protocol TCP `
        -LocalPort $port `
        -Profile Any `
        -ErrorAction SilentlyContinue | Out-Null
    Write-Host "  OK: firewall rule added for port $port" -ForegroundColor Green
}

# Verify
Write-Host "[5/5] Verifying..." -ForegroundColor Yellow
Start-Sleep -Seconds 3
for ($i = 0; $i -lt $Ports.Count; $i++) {
    $port = $Ports[$i]
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/tags" -TimeoutSec 5
        Write-Host "  OK: port $port responds on 127.0.0.1 -- $($r.models.Count) models" -ForegroundColor Green
    } catch {
        Write-Host "  WARN: port $port not responding on 127.0.0.1 yet" -ForegroundColor Yellow
    }
    # Also probe on listening bind address (LAN)
    try {
        $null = Invoke-RestMethod -Uri "http://$BindAddress`:$port/api/tags" -TimeoutSec 3
        Write-Host "  OK: port $port responds on $BindAddress" -ForegroundColor Green
    } catch {
        if ($BindAddress -ne '127.0.0.1' -and $BindAddress -ne '0.0.0.0') {
            Write-Host "  WARN: port $port not responding on $BindAddress" -ForegroundColor Yellow
        }
    }
}

# Show what is actually listening
Write-Host ""
Write-Host "Listening processes:" -ForegroundColor Cyan
Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue |
    Where-Object { $Ports -contains $_.LocalPort } |
    Select-Object LocalAddress,LocalPort,OwningProcess |
    Format-Table -AutoSize

Write-Host ""
Write-Host "=== Done ===" -ForegroundColor Cyan
Write-Host "  Services installed: ollama-tier-$($Ports -join ', ollama-tier-')"
Write-Host "  Check:    Get-Service ollama-tier-*"
Write-Host "  Logs:     $InstallDir\ollama-tier-*.out.log"
Write-Host ""
Write-Host "Pull models (one-time):"
for ($i = 0; $i -lt $Ports.Count; $i++) {
    Write-Host "  `$env:OLLAMA_HOST='localhost:$($Ports[$i])'; ollama pull <model>"
}
