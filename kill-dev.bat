@echo off
setlocal

for %%P in (5050 5051 5173 8000) do (
    for /f "tokens=5" %%A in ('netstat -ano ^| findstr /R /C:":%%P .*LISTENING"') do (
        echo Stopping process %%A on port %%P
        taskkill /F /PID %%A >nul 2>&1
    )
)

rem Kill AI Backend window/process (no listening port).
taskkill /F /FI "WINDOWTITLE eq AI Backend" >nul 2>&1
powershell -NoProfile -Command "Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*ai-backend\\server.py*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }" >nul 2>&1

echo Done.
endlocal
