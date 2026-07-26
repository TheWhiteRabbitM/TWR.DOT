@echo off
REM Windows Task Scheduler entry point: runs the WSL refresh script and logs it.
wsl.exe -e bash "/mnt/c/Users/miche/Downloads/DOT APP/italiarovente/refresh.sh" >> "%~dp0refresh.log" 2>&1
