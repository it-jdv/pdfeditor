# EditorPDF ArtTocador — Guía de Instalación y Compilación

Aplicación de escritorio para identificar y sustituir textos en PDFs escaneados.
Funciona en **macOS** y **Windows** sin necesidad de instalar Python.

---

## Para el usuario final

### Requisito previo: Tesseract OCR

#### macOS
```bash
# Requiere Homebrew (https://brew.sh)
brew install tesseract
brew install tesseract-lang   # idiomas adicionales (opcional)
```

#### Windows
1. Descargar instalador desde: https://github.com/UB-Mannheim/tesseract/wiki
2. Durante la instalación, **marcar "Add to PATH"**
3. Reiniciar el equipo

---

### Ejecutar la app

#### macOS
1. Abrir `EditorPDF_ArtTocador.dmg`
2. Arrastrar `EditorPDF_ArtTocador.app` a Aplicaciones
3. Primera vez: clic derecho → **Abrir** (para superar Gatekeeper)
4. El navegador se abre en `http://localhost:5000`

#### Windows
1. Ejecutar `EditorPDF_ArtTocador.exe`
2. Si el antivirus bloquea: **Más información → Ejecutar de todas formas**
3. El navegador se abre en `http://localhost:5000`

---

## Para desarrolladores: compilar desde el código fuente

### Requisitos
- Python 3.10+
- Tesseract OCR instalado (ver arriba)

### Pasos (macOS y Windows)

```bash
# 1. Clonar el repositorio
git clone https://github.com/it-jdv/pdfeditor.git
cd pdfeditor

# 2. Crear y activar entorno virtual
python -m venv venv

# macOS/Linux:
source venv/bin/activate
# Windows:
venv\Scripts\activate

# 3. Instalar dependencias
pip install -r requirements.txt

# 4. Ejecutar en modo desarrollo
python app.py
# → abre http://localhost:5000
```

### Compilar instalador

```bash
python build_app.py
```

- **macOS** → `dist/EditorPDF_ArtTocador.app` + `dist/EditorPDF_ArtTocador.dmg`
- **Windows** → `dist/EditorPDF_ArtTocador.exe`

> El instalador debe compilarse **en el sistema operativo de destino**.
> Para el `.exe` de Windows es necesario ejecutar `build_app.py` en una máquina Windows.

---

## Estructura del proyecto

```
app.py              — Backend Flask (OCR, redacción, reemplazo de texto)
build_app.py        — Script de compilación con PyInstaller
requirements.txt    — Dependencias Python
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
