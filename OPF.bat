@echo off
title OPF
cd /d "%~dp0"
node scripts\launch.cjs %*
if errorlevel 1 (
  echo.
  echo OPF could not start. Copy the text above and send it to Claude.
  pause
)
