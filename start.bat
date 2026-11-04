@echo off
rem Starts the local server and opens the viewer (images must be served over http for WebGL/canvas).
start "" http://localhost:8765/
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0serve.ps1"
