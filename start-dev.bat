@echo off
setlocal

set ROOT_DIR=%~dp0

echo Setting deploy profile to local...
python "%ROOT_DIR%scripts\set_deploy_profile.py" local
if errorlevel 1 (
    echo Failed to set deploy profile.
    exit /b 1
)

echo Generating runtime config...
python "%ROOT_DIR%scripts\generate_runtime_config.py"
if errorlevel 1 (
    echo Failed to generate runtime config.
    exit /b 1
)

echo Starting DeepRL backend...
start "DeepRL Backend" /D "%ROOT_DIR%DeepRL\backend" python server.py

echo Starting game backend...
start "Tank Arena Backend" /D "%ROOT_DIR%" python scripts\game-backend.py

echo Starting AI backend...
start "AI Backend" /D "%ROOT_DIR%DeepRL\ai-backend" python server.py

echo Starting game server...
start "Tank Arena Game" /D "%ROOT_DIR%" python -m http.server 5173

echo Backend: http://127.0.0.1:5050
echo Game Backend: http://127.0.0.1:5051
echo AI Backend: (polling) http://127.0.0.1:5051
echo Game: http://127.0.0.1:5173
endlocal
