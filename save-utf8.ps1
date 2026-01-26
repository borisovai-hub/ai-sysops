$content = Get-Content 'fix-vscode.ps1' -Raw
$utf8WithBom = New-Object System.Text.UTF8Encoding $true
[System.IO.File]::WriteAllText('fix-vscode.ps1', $content, $utf8WithBom)
