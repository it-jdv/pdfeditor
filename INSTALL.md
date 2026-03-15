# EditorPDF ArtTocador — Instalación y Compilación

Aplicación de escritorio para identificar y sustituir textos en PDFs escaneados.
Funciona en **macOS** y **Windows** sin necesidad de instalar Python.

---

## Descargar la app (usuarios finales)

| Sistema | Archivo | Enlace |
|---|---|---|
| macOS (Apple Silicon / Intel) | `EditorPDF_ArtTocador_macOS.dmg` | [GitHub Releases](https://github.com/it-jdv/pdfeditor/releases/latest) |
| Windows | Compilar manualmente (ver abajo) | — |

---

## macOS — Instalación

### 1. Requisito previo: Tesseract OCR
```bash
# Requiere Homebrew (https://brew.sh)
brew install tesseract
```

### 2. Instalar la app
1. Descargar `EditorPDF_ArtTocador_macOS.dmg` desde [Releases](https://github.com/it-jdv/pdfeditor/releases/latest)
2. Abrir el DMG → arrastrar `EditorPDF_ArtTocador.app` a Aplicaciones
3. **Primera vez:** clic derecho sobre la app → **Abrir** (para superar Gatekeeper)
4. El navegador abrirá `http://localhost:5000` automáticamente

---

## Windows — Compilar el instalador

> El `.exe` debe generarse **en una máquina Windows** (PyInstaller produce binarios nativos).

### 1. Requisitos previos

#### Python 3.10+
1. Descargar desde https://www.python.org/downloads/windows/
2. Durante la instalación: **marcar "Add Python to PATH"**
3. Verificar en PowerShell:
   ```powershell
   python --version
   ```

#### Tesseract OCR
1. Descargar instalador desde https://github.com/UB-Mannheim/tesseract/wiki
   - Archivo: `tesseract-ocr-w64-setup-5.x.x.exe`
2. Durante la instalación:
   - **Marcar "Add to system PATH"**
   - En "Additional language data": seleccionar **Spanish** si se necesita OCR en español
3. Reiniciar el equipo
4. Verificar en PowerShell:
   ```powershell
   tesseract --version
   ```

### 2. Clonar el repositorio

```powershell
git clone https://github.com/it-jdv/pdfeditor.git
cd pdfeditor
```

O descargar el ZIP desde GitHub → **Code → Download ZIP** y descomprimir.

### 3. Crear entorno virtual e instalar dependencias

```powershell
python -m venv venv
venv\Scripts\activate

pip install -r requirements.txt
```

### 4. Probar en modo desarrollo (opcional)

```powershell
python app.py
```

Abrir http://localhost:5000 en el navegador.

### 5. Compilar el ejecutable `.exe`

```powershell
python build_app.py
```

El proceso tarda 2-5 minutos. Al terminar aparece:

```
dist/
└── EditorPDF_ArtTocador.exe   ← ejecutable único (~40 MB)
```

### 6. Distribuir

Basta con copiar `EditorPDF_ArtTocador.exe`. No requiere instalación en el equipo destino.

> **Nota sobre antivirus:** Windows Defender o antivirus pueden marcar el `.exe` como sospechoso
> (falso positivo frecuente con PyInstaller). En ese caso:
> - Windows SmartScreen → **Más información → Ejecutar de todas formas**
> - O firmar el ejecutable con un certificado de código (Code Signing Certificate)

---

## Para desarrolladores — Compilar desde el código fuente (macOS)

```bash
# 1. Clonar
git clone https://github.com/it-jdv/pdfeditor.git
cd pdfeditor

# 2. Entorno virtual
python3 -m venv venv
source venv/bin/activate

# 3. Dependencias
pip install -r requirements.txt

# 4. Modo desarrollo
python app.py   # → http://localhost:5000

# 5. Compilar .app + .dmg
python build_app.py
# Genera: dist/EditorPDF_ArtTocador.app
#         dist/EditorPDF_ArtTocador.dmg
```

---

## Estructura del proyecto

```
app.py              — Backend Flask (OCR, redacción, reemplazo de texto)
build_app.py        — Script de compilación con PyInstaller
requirements.txt    — Dependencias Python
INSTALL.md          — Esta guía
templates/          — HTML de la interfaz
static/css/         — Estilos
static/js/          — Lógica del visor PDF (PDF.js)
uploads/            — PDFs temporales (no versionado)
```

## Tecnologías

| Componente | Tecnología |
|---|---|
| Backend | Python · Flask · PyMuPDF |
| OCR | Tesseract · pytesseract · Pillow |
| Visor PDF | PDF.js |
| Empaquetado | PyInstaller |
