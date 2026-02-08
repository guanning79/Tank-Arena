@echo off
setlocal

set ROOT_DIR=%~dp0

echo Starting DeepRL backend...
start "DeepRL Backend" /D "%ROOT_DIR%DeepRL\backend" python server.py

echo Starting game server...
start "Tank Arena Game" /D "%ROOT_DIR%" python -m http.server 5173

echo Backend: http://127.0.0.1:5050
echo Game: http://127.0.0.1:5173
endlocal
