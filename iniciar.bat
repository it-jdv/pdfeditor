@echo off
title EditorPDF ArtTocador
echo Iniciando EditorPDF ArtTocador...
echo.

:: --- Detectar ruta de Tesseract automaticamente ---
SET TESS_DIR=
IF EXIST "C:\Program Files\Tesseract-OCR\tesseract.exe" (
    SET TESS_DIR=C:\Program Files\Tesseract-OCR
    GOTO tess_found
)
IF EXIST "C:\Program Files (x86)\Tesseract-OCR\tesseract.exe" (
    SET TESS_DIR=C:\Program Files (x86)\Tesseract-OCR
    GOTO tess_found
)
IF EXIST "%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe" (
    SET TESS_DIR=%LOCALAPPDATA%\Programs\Tesseract-OCR
    GOTO tess_found
)
IF EXIST "%LOCALAPPDATA%\Tesseract-OCR\tesseract.exe" (
    SET TESS_DIR=%LOCALAPPDATA%\Tesseract-OCR
    GOTO tess_found
)

echo [ERROR] Tesseract no encontrado. Por favor instálalo desde:
echo   https://github.com/UB-Mannheim/tesseract/wiki
echo.
pause
EXIT /B 1

:tess_found
echo [OK] Tesseract encontrado en: %TESS_DIR%
SET TESSDATA_PREFIX=%TESS_DIR%
SET PATH=%PATH%;%TESS_DIR%

:: --- Activar entorno virtual si existe ---
IF EXIST "venv\Scripts\activate.bat" (
    echo [OK] Activando entorno virtual...
    CALL venv\Scripts\activate.bat
)

:: --- Lanzar la app ---
echo [OK] Lanzando servidor...
echo.
python app.py

pause
