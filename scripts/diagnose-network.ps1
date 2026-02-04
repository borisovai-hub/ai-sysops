# Диагностика сети: DNS, задержка, MTU, HTTP (GZIP vs без)
# Использование: .\diagnose-network.ps1 [-Domain "borisovai.tech"] [-Url "https://..."]
# Запуск: PowerShell (не обязательно от администратора)

param(
    [string]$Domain = "borisovai.tech",
    [string]$Url = "https://borisovai.tech/ru/blog/feat-add-global-ckeditor-compatible-content-styles-across-all-sections-9weupr",
    [string]$DnsServer = "8.8.8.8"
)

$ErrorActionPreference = "SilentlyContinue"

Write-Host ""
Write-Host "=== Network diagnosis ===" -ForegroundColor Cyan
Write-Host "  Domain: $Domain"
Write-Host "  URL:    $Url"
Write-Host "  DNS:    $DnsServer"
Write-Host ""

# 1. DNS
Write-Host "[1/4] DNS..." -ForegroundColor Yellow
$dnsElapsed = (Measure-Command {
    $script:DnsResult = Resolve-DnsName $Domain -Server $DnsServer -ErrorAction SilentlyContinue
}).TotalSeconds
$dnsIp = ($DnsResult | Where-Object { $_.Type -eq "A" } | Select-Object -First 1).IPAddress
if ($dnsIp) {
    Write-Host "  IP: $dnsIp" -ForegroundColor Green
    Write-Host "  Time: $([math]::Round($dnsElapsed, 2))s"
    if ($dnsElapsed -gt 2) { Write-Host "  Warning: DNS slow (> 2s)" -ForegroundColor Yellow }
} else {
    Write-Host "  Error: could not resolve name" -ForegroundColor Red
}
Write-Host ""

# 2. Ping
Write-Host "[2/4] Ping (10 packets)..." -ForegroundColor Yellow
$pingOut = ping -n 10 $Domain 2>&1 | Out-String
$pingLoss = if ($pingOut -match "\((\d+)%.*loss\)") { $matches[1] } elseif ($pingOut -match "(\d+)%.*\d+") { $matches[1] } else { "0" }
$pingRtt = if ($pingOut -match "Average\s*=\s*(\d+)\s*ms") { $matches[1] } elseif ($pingOut -match "=\s*(\d+)\s*ms") { $matches[1] } else { "?" }
Write-Host $pingOut
if ($pingLoss -ne "0" -and $pingLoss -ne "?") { Write-Host "  Warning: packet loss" -ForegroundColor Yellow }
if ($pingRtt -ne "?" -and [int]$pingRtt -gt 200) { Write-Host "  Warning: high RTT (> 200 ms)" -ForegroundColor Yellow }
Write-Host ""

# 3. MTU
Write-Host "[3/4] MTU (ping 1472 vs 500 bytes)..." -ForegroundColor Yellow
$bigOk = $false
$smallOk = $false
$jobBig = Start-Job -ArgumentList $Domain { param($d) ping -n 2 -l 1472 $d 2>&1 }; $jobBig | Wait-Job -Timeout 5 | Out-Null
$outBig = Receive-Job $jobBig; Remove-Job $jobBig -Force -ErrorAction SilentlyContinue
if ($outBig -match "Reply from|TTL=|from\s+\d|Ответ|^\d") { $bigOk = $true }
$jobSmall = Start-Job -ArgumentList $Domain { param($d) ping -n 2 -l 500 $d 2>&1 }; $jobSmall | Wait-Job -Timeout 5 | Out-Null
$outSmall = Receive-Job $jobSmall; Remove-Job $jobSmall -Force -ErrorAction SilentlyContinue
if ($outSmall -match "Reply from|TTL=|from\s+\d|Ответ|^\d") { $smallOk = $true }

Write-Host "  Packet 1472 B: $(if ($bigOk) { 'OK' } else { 'timeout/fail' })"
Write-Host "  Packet 500 B:  $(if ($smallOk) { 'OK' } else { 'timeout' })"
if (-not $bigOk -and $smallOk) { Write-Host "  -> Path MTU reduced; on server run: fix-mtu-issue.sh" -ForegroundColor Yellow }
Write-Host ""

# 4. HTTP
Write-Host "[4/4] HTTP (GZIP vs no GZIP)..." -ForegroundColor Yellow
$curlGzip = curl.exe -s -o NUL -w "%{time_total}|%{size_download}|%{http_code}" -H "Accept-Encoding: gzip" --connect-timeout 5 --max-time 12 "$Url" 2>&1
$curlPlain = curl.exe -s -o NUL -w "%{time_total}|%{size_download}|%{http_code}" --connect-timeout 5 --max-time 8 "$Url" 2>&1

$gzipParts = $curlGzip -split "\|"
$plainParts = $curlPlain -split "\|"
$gzipTime = if ($gzipParts[0] -match "^\d+\.?\d*$") { [double]$gzipParts[0] } else { 0 }
$gzipSize = if ($gzipParts[1] -match "^\d+$") { [int]$gzipParts[1] } else { 0 }
$plainTime = if ($plainParts[0] -match "^\d+\.?\d*$") { [double]$plainParts[0] } else { 0 }

Write-Host "  With GZIP:    $([math]::Round($gzipTime, 2))s, size $gzipSize bytes"
Write-Host "  Without GZIP: $([math]::Round($plainTime, 2))s (max 8s)"
if ($gzipTime -lt 3 -and $plainTime -gt 5) {
    Write-Host "  -> GZIP helps; if browser slow, check Accept-Encoding or fonts/JS" -ForegroundColor Yellow
} elseif ($gzipTime -gt 5) {
    Write-Host "  -> Slow even with GZIP; high RTT or packet loss on path" -ForegroundColor Yellow
} else {
    Write-Host "  -> Load time OK" -ForegroundColor Green
}
Write-Host ""

Write-Host "=== Summary ===" -ForegroundColor Cyan
Write-Host "  DNS:  $(if ($dnsIp) { "OK ($dnsIp, $([math]::Round($dnsElapsed,1))s)" } else { 'Fail' })"
Write-Host "  Ping: loss $pingLoss%, RTT ~$pingRtt ms"
Write-Host "  MTU:  big $(if ($bigOk) { 'OK' } else { 'fail' }), small $(if ($smallOk) { 'OK' } else { '?' })"
Write-Host "  HTTP: GZIP $([math]::Round($gzipTime,1))s, no-GZIP $([math]::Round($plainTime,1))s"
Write-Host ""
