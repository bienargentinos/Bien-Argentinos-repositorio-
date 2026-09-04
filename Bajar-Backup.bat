@echo off
title Respaldo Marcos IA - Descarga de Backup
chcp 65001 >nul
color 0b
echo ========================================================
echo   INICIANDO DESCARGA DE RESPALDO DESDE EL SERVIDOR
echo ========================================================
echo.
cd /d "C:\Users\Daniel\Downloads\marcos-panel-code"
node bajar-backup.js
if %ERRORLEVEL% EQU 0 (
    color 0a
    echo.
    echo ========================================================
    echo   EL RESPALDO QUEDO GUARDADO A SALVO EN TU COMPUTADORA
    echo ========================================================
) else (
    color 0c
    echo.
    echo ========================================================
    echo   HUBO UN PROBLEMA AL DESCARGAR EL RESPALDO
    echo ========================================================
)
echo.
echo Presiona cualquier tecla para cerrar esta ventana...
pause >nul