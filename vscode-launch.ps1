# Launch VS Code with ICU error fix
# Usage: .\vscode-launch.ps1 [folder_path]

$ErrorActionPreference = "SilentlyContinue"

# Clear problematic environment variables
Remove-Item Env:VSCODE_IPC_HOOK_CLI -ErrorAction SilentlyContinue
Remove-Item Env:ELECTRON_RUN_AS_NODE -ErrorAction SilentlyContinue

# Launch VS Code
& "C:\Users\user\AppData\Local\Programs\Microsoft VS Code\Code.exe" $args
