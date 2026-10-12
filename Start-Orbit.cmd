@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0Start-Orbit.ps1"
if errorlevel 1 pause
