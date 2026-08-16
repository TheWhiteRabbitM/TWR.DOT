@echo off
REM Dev-server entry point. The Node MSI adds itself to the machine PATH, but
REM any process started before the install still carries the old environment —
REM so prepend it explicitly rather than relying on inheritance.
set "PATH=C:\Program Files\nodejs;%PATH%"
cd /d "%~dp0"
npm run dev
