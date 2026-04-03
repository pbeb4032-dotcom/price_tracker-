@echo off
REM One-click dev start (Windows)
REM Keep the window open so you can see any errors.
PowerShell -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0scripts\run-dev.ps1"
