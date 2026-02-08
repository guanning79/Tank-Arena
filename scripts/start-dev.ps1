$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$backendDir = Join-Path $root "DeepRL\backend"

Write-Host "Starting DeepRL backend..." -ForegroundColor Cyan
Start-Process -FilePath "python" -ArgumentList "server.py" -WorkingDirectory $backendDir

Write-Host "Starting game server..." -ForegroundColor Cyan
Start-Process -FilePath "node" -ArgumentList "scripts\game-server.js" -WorkingDirectory $root

Write-Host "Backend: http://127.0.0.1:5050" -ForegroundColor Green
Write-Host "Game: http://127.0.0.1:5173" -ForegroundColor Green
