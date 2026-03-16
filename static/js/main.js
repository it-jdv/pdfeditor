const UPLOAD_PANEL = document.getElementById('uploadPanel');
const SETTINGS_PANEL = document.getElementById('settingsPanel');
const DROPZONE = document.getElementById('dropzone');
const FILE_INPUT = document.getElementById('fileInput');
const FILE_NAME_DISPLAY = document.getElementById('fileNameDisplay');
const ANALYZE_BTN = document.getElementById('analyzeBtn');
const DRAW_BTN = document.getElementById('drawBtn');
const PREVIEW_BTN = document.getElementById('previewBtn');
const APPLY_BTN = document.getElementById('applyBtn');
const RESET_BTN = document.getElementById('resetBtn');
const LOADING_OVERLAY = document.getElementById('loadingOverlay');
const LOADING_MSG = document.getElementById('loadingMsg');
const PROGRESS_BAR = document.getElementById('progressBar');
const ROTATION_INPUT = document.getElementById('rotationInput');
const DRAW_BTN_TOP = document.getElementById('drawBtnTop');

const TOOLBAR = document.getElementById('toolbar');
const PDF_WRAPPER = document.getElementById('pdfWrapper');
const PDF_PLACEHOLDER = document.getElementById('pdfPlaceholder');
const CANVAS = document.getElementById('pdfCanvas');
const OVERLAY_LAYER = document.getElementById('overlayLayer');
let CTX = null;

let currentFile = null;
let currentPdfDoc = null;
let originalPdfDoc = null; // Stored for undoing preview
let isPreviewMode = false;
let currentPageNum = 1;
let currentZoom = 1.0;
let backendFileId = null;

let matchesData = {}; // page -> matches array
let manualMatches = {}; // page -> manual arrays

let isDrawing = false;
let startX, startY;
let selectionBox = null;

// Initialization
function init() {
    if (CANVAS) CTX = CANVAS.getContext('2d');
    setupDragAndDrop();
    setupButtons();
    setupDrawing();

    ROTATION_INPUT.addEventListener('change', () => {
        if (currentPdfDoc) {
            renderPage(currentPageNum);
        }
    });
}

function showLoading(msg) {
    LOADING_MSG.textContent = msg;
    PROGRESS_BAR.style.width = '0%';
    LOADING_OVERLAY.style.display = 'flex';
}

function hideLoading() {
    LOADING_OVERLAY.style.display = 'none';
}

function setupDragAndDrop() {
    DROPZONE.addEventListener('click', () => FILE_INPUT.click());

    DROPZONE.addEventListener('dragover', (e) => {
        e.preventDefault();
        DROPZONE.classList.add('dragover');
    });

    DROPZONE.addEventListener('dragleave', () => {
        DROPZONE.classList.remove('dragover');
    });

    DROPZONE.addEventListener('drop', (e) => {
        e.preventDefault();
        DROPZONE.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0]);
        }
    });

    FILE_INPUT.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFile(e.target.files[0]);
        }
    });
}

async function handleFile(file) {
    if (file.type !== 'application/pdf') {
        alert('Por favor, selecciona un archivo PDF válido.');
        return;
    }
    currentFile = file;
    FILE_NAME_DISPLAY.textContent = file.name;

    // Switch panels
    SETTINGS_PANEL.style.display = 'block';

    // Load to PDF.js for preview
    const arrayBuffer = await file.arrayBuffer();
    pdfjsLib.getDocument({ data: arrayBuffer }).promise.then(pdf => {
        originalPdfDoc = pdf;
        currentPdfDoc = pdf;
        document.getElementById('pageCount').textContent = pdf.numPages;
        currentPageNum = 1;

        PDF_PLACEHOLDER.style.display = 'none';
        PDF_WRAPPER.style.display = 'block';
        TOOLBAR.style.display = 'flex';

        renderPage(currentPageNum);
    }).catch(err => {
        console.error(err);
        alert('Error leyendo el PDF');
    });
}

function renderPage(pageNum) {
    if (!currentPdfDoc) return;

    currentPdfDoc.getPage(pageNum).then(page => {
        let rotationVal = ROTATION_INPUT.value;
        let viewportParams = { scale: currentZoom };
        if (rotationVal !== 'auto') {
            viewportParams.rotation = parseInt(rotationVal);
        }

        const viewport = page.getViewport(viewportParams);
        CANVAS.height = viewport.height;
        CANVAS.width = viewport.width;

        PDF_WRAPPER.style.width = viewport.width + 'px';
        PDF_WRAPPER.style.height = viewport.height + 'px';

        const renderContext = {
            canvasContext: CTX,
            viewport: viewport
        };

        page.render(renderContext).promise.then(() => {
            document.getElementById('pageNum').textContent = pageNum;
            if (isPreviewMode) {
                OVERLAY_LAYER.innerHTML = '';
                OVERLAY_LAYER.style.cursor = 'default';
                renderEditableOverlays(pageNum);
            } else {
                OVERLAY_LAYER.style.cursor = 'crosshair';
                drawOverlays(pageNum);
            }
        });
    });
}

function setupButtons() {
    document.getElementById('prevPage').addEventListener('click', () => {
        if (currentPageNum <= 1) return;
        currentPageNum--;
        renderPage(currentPageNum);
    });

    document.getElementById('nextPage').addEventListener('click', () => {
        if (currentPageNum >= currentPdfDoc.numPages) return;
        currentPageNum++;
        renderPage(currentPageNum);
    });

    document.getElementById('zoomIn').addEventListener('click', () => {
        currentZoom += 0.25;
        document.getElementById('zoomValue').textContent = Math.round(currentZoom * 100) + '%';
        renderPage(currentPageNum);
    });

    document.getElementById('zoomOut').addEventListener('click', () => {
        if (currentZoom <= 0.5) return;
        currentZoom -= 0.25;
        document.getElementById('zoomValue').textContent = Math.round(currentZoom * 100) + '%';
        renderPage(currentPageNum);
    });

    ANALYZE_BTN.addEventListener('click', analyzePdf);
    if (PREVIEW_BTN) PREVIEW_BTN.addEventListener('click', togglePreview);
    // Bug 2+3 fix: en modo preview, el botón Guardar usa los replacements editados
    APPLY_BTN.addEventListener('click', () => {
        if (isPreviewMode) confirmAndDownload();
        else applyChanges(false);
    });
    RESET_BTN.addEventListener('click', () => location.reload());
}

async function analyzePdf() {
    if (!currentFile) return;

    showLoading('Evaluando textos en PDF...');

    const formData = new FormData();
    formData.append('file', currentFile);
    formData.append('words', document.getElementById('wordsInput').value);
    formData.append('rotation', document.getElementById('rotationInput').value);

    // Cleaned up API key reference

    try {
        let fakeProgress = 0;
        let progressInterval = setInterval(() => {
            if (fakeProgress < 90) {
                fakeProgress += 5;
                PROGRESS_BAR.style.width = fakeProgress + '%';
                LOADING_MSG.textContent = `Evaluando documento... (${fakeProgress}%)`;
            }
        }, 300);

        const res = await fetch('/api/analyze', {
            method: 'POST',
            body: formData
        });

        clearInterval(progressInterval);
        PROGRESS_BAR.style.width = '100%';
        LOADING_MSG.textContent = `¡Análisis completado! (100%)`;

        const data = await res.json();

        if (data.status === 'success') {
            backendFileId = data.filename;

            matchesData = {};
            data.pages.forEach(p => {
                matchesData[p.page] = p.matches || [];
            });

            // Auto-populate default font from detected values (first page)
            if (data.pages.length > 0) {
                const firstPage = data.pages[0];
                if (firstPage.default_font_size) {
                    document.getElementById('defaultFontSizeInput').value = firstPage.default_font_size;
                }
                if (firstPage.default_font_name) {
                    const fontMap = { 'Helvetica': 'helv', 'Times': 'tiro', 'Courier': 'cour' };
                    const mapped = fontMap[firstPage.default_font_name.split('-')[0]] || 'helv';
                    document.getElementById('defaultFontInput').value = mapped;
                }
            }

            updateSummary();
            renderPage(currentPageNum);
        } else {
            alert('Error al analizar: ' + data.message);
        }
    } catch (err) {
        alert('Fallo de conexión crítico. Verifica que la consola esté corriendo.');
    } finally {
        setTimeout(() => { hideLoading(); }, 800);
    }
}

// Bounding box drawing setup
let manualModeActive = false;

function toggleDrawingMode() {
    manualModeActive = !manualModeActive;
    if (manualModeActive) {
        DRAW_BTN.style.background = 'var(--accent)';
        DRAW_BTN.style.color = 'white';
        DRAW_BTN.textContent = '❌ Cancelar Dibujo';
        if (DRAW_BTN_TOP) {
            DRAW_BTN_TOP.style.background = 'var(--accent)';
            DRAW_BTN_TOP.style.color = 'white';
            DRAW_BTN_TOP.textContent = '❌ Cancelar Dibujo';
        }
        OVERLAY_LAYER.style.cursor = 'crosshair';
    } else {
        DRAW_BTN.style.background = 'transparent';
        DRAW_BTN.style.color = 'var(--accent)';
        DRAW_BTN.textContent = '🖌️ Agregar Marcador Manual (Selección libre)';
        if (DRAW_BTN_TOP) {
            DRAW_BTN_TOP.style.background = 'transparent';
            DRAW_BTN_TOP.style.color = 'var(--ok)';
            DRAW_BTN_TOP.textContent = '🖌️ Dibujar Zona Manual';
        }
        OVERLAY_LAYER.style.cursor = 'default';
    }
}

function setupDrawing() {
    DRAW_BTN.addEventListener('click', toggleDrawingMode);
    if (DRAW_BTN_TOP) DRAW_BTN_TOP.addEventListener('click', toggleDrawingMode);

    OVERLAY_LAYER.addEventListener('mousedown', (e) => {
        if (!manualModeActive) return; // Only allow if manual mode is active (analysis no longer required)
        if (e.target.classList.contains('manual-match-box')) return; // let click delete

        isDrawing = true;
        const rect = OVERLAY_LAYER.getBoundingClientRect();
        startX = e.clientX - rect.left;
        startY = e.clientY - rect.top;

        selectionBox = document.createElement('div');
        selectionBox.className = 'selection-box';
        selectionBox.style.left = startX + 'px';
        selectionBox.style.top = startY + 'px';
        selectionBox.style.width = '0px';
        selectionBox.style.height = '0px';
        OVERLAY_LAYER.appendChild(selectionBox);
    });

    OVERLAY_LAYER.addEventListener('mousemove', (e) => {
        if (!isDrawing || !selectionBox) return;

        const rect = OVERLAY_LAYER.getBoundingClientRect();
        const currentX = e.clientX - rect.left;
        const currentY = e.clientY - rect.top;

        const width = Math.abs(currentX - startX);
        const height = Math.abs(currentY - startY);
        const left = Math.min(currentX, startX);
        const top = Math.min(currentY, startY);

        selectionBox.style.width = width + 'px';
        selectionBox.style.height = height + 'px';
        selectionBox.style.left = left + 'px';
        selectionBox.style.top = top + 'px';
    });

    OVERLAY_LAYER.addEventListener('mouseup', async (e) => {
        if (!isDrawing) return;
        isDrawing = false;

        if (selectionBox) {
            const width = parseInt(selectionBox.style.width);
            const height = parseInt(selectionBox.style.height);
            const left = parseInt(selectionBox.style.left);
            const top = parseInt(selectionBox.style.top);

            selectionBox.remove();
            selectionBox = null;

            if (width < 5 || height < 5) return;

            currentPdfDoc.getPage(currentPageNum).then(page => {
                let rotationVal = ROTATION_INPUT.value;
                let viewRot = (rotationVal === 'auto') ? page.rotate : parseInt(rotationVal);

                // Pure pixel coords: divide by zoom only. No convertToPdfPoint.
                // PyMuPDF with set_rotation(viewRot) uses same top-left y-down space as the canvas.
                const pdfX = left / currentZoom;
                const pdfY = top / currentZoom;
                const pdfW = width / currentZoom;
                const pdfH = height / currentZoom;

                if (!manualMatches[currentPageNum]) manualMatches[currentPageNum] = [];

                manualMatches[currentPageNum].push({
                    id: Date.now(),
                    x: pdfX,
                    y: pdfY,
                    width: pdfW,
                    height: pdfH,
                    viewport_rotation: viewRot
                });

                toggleDrawingMode();
                updateSummary();
                drawOverlays(currentPageNum);
            });
        }
    });

    OVERLAY_LAYER.addEventListener('click', (e) => {
        if (e.target.classList.contains('manual-match-box')) {
            const id = parseInt(e.target.getAttribute('data-id'));
            if (manualMatches[currentPageNum]) {
                manualMatches[currentPageNum] = manualMatches[currentPageNum].filter(m => m.id !== id);
                updateSummary();
                currentPdfDoc.getPage(currentPageNum).then(p => {
                    drawOverlays(currentPageNum);
                });
            }
        }
    });
}

function updateSummary() {
    let autoTotal = 0;
    Object.values(matchesData).forEach(arr => autoTotal += arr.length);
    document.getElementById('totalFound').textContent = autoTotal;

    let manualTotal = 0;
    Object.values(manualMatches).forEach(arr => manualTotal += arr.length);
    document.getElementById('manualFound').textContent = manualTotal;
}

function drawOverlays(pageNum) {
    OVERLAY_LAYER.innerHTML = '';

    const autos = matchesData[pageNum] || [];
    autos.forEach(match => {
        // Pure pixel: PyMuPDF coords * zoom = screen pixels
        const x = match.x * currentZoom;
        const y = match.y * currentZoom;
        const w = match.width * currentZoom;
        const h = match.height * currentZoom;

        const box = document.createElement('div');
        box.className = 'auto-match-box';
        box.style.left = x + 'px';
        box.style.top = y + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';
        box.title = match.word;
        OVERLAY_LAYER.appendChild(box);
    });

    const manuals = manualMatches[pageNum] || [];
    manuals.forEach(match => {
        const x = match.x * currentZoom;
        const y = match.y * currentZoom;
        const w = match.width * currentZoom;
        const h = match.height * currentZoom;

        const box = document.createElement('div');
        box.className = 'manual-match-box';
        box.setAttribute('data-id', match.id);
        box.style.left = x + 'px';
        box.style.top = y + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';
        OVERLAY_LAYER.appendChild(box);
    });
}

async function applyChanges(isPreview = false) {
    if (!currentFile && !backendFileId) {
        alert("Sube un archivo primero.");
        return;
    }

    showLoading('Aplicando cambios...');

    let allReplacements = [];
    const replaceText = document.getElementById('replaceInput').value || 'art tocador';

    // Bug 1 fix: el tamaño global del usuario siempre tiene prioridad
    const defFont = document.getElementById('defaultFontInput').value;
    const defSize = parseFloat(document.getElementById('defaultFontSizeInput').value) || 11;

    Object.keys(matchesData).forEach(page => {
        matchesData[page].forEach(m => {
            allReplacements.push({
                page: parseInt(page),
                // orig_* = where to ERASE in the source PDF (never changes)
                orig_x: m.x, orig_y: m.y, orig_width: m.width, orig_height: m.height,
                // x/y/w/h = where to INSERT text (user can drag to adjust)
                x: m.x, y: m.y, width: m.width, height: m.height,
                text: replaceText,
                viewport_rotation: m.viewport_rotation || 0,
                font_name: defFont,
                font_size: defSize
            });
        });
    });

    Object.keys(manualMatches).forEach(page => {
        manualMatches[page].forEach(m => {
            allReplacements.push({
                page: parseInt(page),
                orig_x: m.x, orig_y: m.y, orig_width: m.width, orig_height: m.height,
                x: m.x, y: m.y, width: m.width, height: m.height,
                text: replaceText,
                viewport_rotation: m.viewport_rotation || 0,
                font_name: defFont,
                font_size: defSize
            });
        });
    });

    if (allReplacements.length === 0) {
        alert("No hay ningún reemplazo que aplicar.");
        hideLoading();
        return;
    }

    const formData = new FormData();
    formData.append('file', currentFile);
    formData.append('replacements', JSON.stringify(allReplacements));
    formData.append('rotation', document.getElementById('rotationInput').value);

    try {
        const res = await fetch('/api/replace', {
            method: 'POST',
            body: formData
        });
        const data = await res.json();

        if (data.status === 'success') {
            if (isPreview) {
                // Load the corrected PDF for editable preview
                const pdfRes = await fetch('/api/preview/' + data.filename);
                const arrayBuffer = await pdfRes.arrayBuffer();
                const newPdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

                currentPdfDoc = newPdf;
                isPreviewMode = true;
                previewedFilename = data.filename;
                previewReplacements = allReplacements; // Store for editing

                // Show preview banner and update UI
                document.getElementById('previewBanner').classList.add('active');
                DRAW_BTN.style.display = 'none';
                if (document.getElementById('drawBtnTop')) {
                    document.getElementById('drawBtnTop').style.display = 'none';
                }

                // Inicializar navegación
                currentBoxIdx = -1;
                updateNavLabel();

                renderPage(currentPageNum);

            } else {
                // Direct download
                const link = document.createElement('a');
                link.href = data.download_url;
                link.download = '';
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            }
        } else {
            alert('Error: ' + data.message);
        }
    } catch (err) {
        console.error(err);
        alert('Fallo de conexión.');
    } finally {
        hideLoading();
    }
}

async function togglePreview() {
    if (isPreviewMode) {
        exitPreviewMode();
    } else {
        await applyChanges(true);
    }
}

function exitPreviewMode() {
    isPreviewMode = false;
    currentPdfDoc = originalPdfDoc;
    previewedFilename = null;
    selectedEditBox = null;
    currentBoxIdx = -1;

    document.getElementById('previewBanner').classList.remove('active');
    document.getElementById('propsPanel').classList.remove('open');
    DRAW_BTN.style.display = 'block';
    if (document.getElementById('drawBtnTop')) {
        document.getElementById('drawBtnTop').style.display = 'inline-block';
    }
    renderPage(currentPageNum);
}

// ─────────────────────────────────────────────
// EDITABLE PREVIEW SYSTEM
// ─────────────────────────────────────────────

let previewedFilename = null;
let previewReplacements = [];
let selectedEditBox = null;
let currentBoxIdx = -1;

// ── Actualiza el label "1/5" del navigator ──
function updateNavLabel() {
    const lbl = document.getElementById('boxNavLabel');
    if (!lbl) return;
    const total = previewReplacements.length;
    lbl.textContent = total === 0 ? '0/0' : `${currentBoxIdx >= 0 ? currentBoxIdx + 1 : '-'}/${total}`;
}

// ── Ordena replacements por página → Y → X (lectura natural) ──
function getSortedBoxes() {
    return previewReplacements
        .map((rep, origIdx) => ({ rep, origIdx }))
        .sort((a, b) => {
            if (a.rep.page !== b.rep.page) return a.rep.page - b.rep.page;
            if (Math.abs(a.rep.y - b.rep.y) > 2) return a.rep.y - b.rep.y;
            return a.rep.x - b.rep.x;
        });
}

// ── Navega delta = +1 (siguiente) o -1 (anterior) ──
function navigateToBox(delta) {
    const sorted = getSortedBoxes();
    if (sorted.length === 0) return;

    currentBoxIdx = ((currentBoxIdx + delta) % sorted.length + sorted.length) % sorted.length;
    updateNavLabel();

    const { rep } = sorted[currentBoxIdx];

    if (rep.page !== currentPageNum) {
        currentPageNum = rep.page;
        renderPage(currentPageNum);
        // Esperar a que el render termine antes de seleccionar la caja
        setTimeout(() => selectBoxByRep(rep), 350);
    } else {
        selectBoxByRep(rep);
    }
}

// ── Encuentra el elemento DOM del box y lo selecciona ──
function selectBoxByRep(rep) {
    const repIdx = previewReplacements.indexOf(rep);
    const boxes = document.querySelectorAll('.edit-box');
    boxes.forEach(box => {
        if (parseInt(box.getAttribute('data-idx')) === repIdx) {
            // Scroll suave al centro del viewport
            box.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
            // Simular click para seleccionar y abrir panel de props
            box.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        }
    });
}

function renderEditableOverlays(pageNum) {
    OVERLAY_LAYER.innerHTML = '';
    if (!isPreviewMode) return;

    const pageReps = previewReplacements.filter(r => r.page === pageNum);
    if (pageReps.length === 0) return;

    pageReps.forEach((rep, idx) => {
        const box = document.createElement('div');
        box.className = 'edit-box';
        box.setAttribute('data-idx', previewReplacements.indexOf(rep));

        const x = rep.x * currentZoom;
        const y = rep.y * currentZoom;
        const w = rep.width * currentZoom;
        const h = rep.height * currentZoom;

        box.style.left = x + 'px';
        box.style.top = y + 'px';
        box.style.width = w + 'px';
        box.style.height = h + 'px';

        // Label showing the replacement text
        const label = document.createElement('div');
        label.className = 'edit-box-label';
        label.textContent = rep.text || '(vacío)';
        box.appendChild(label);

        // Resize handles
        ['nw', 'ne', 'sw', 'se'].forEach(dir => {
            const handle = document.createElement('div');
            handle.className = `resize-handle ${dir}`;
            handle.setAttribute('data-dir', dir);
            setupResizeHandle(handle, box, rep);
            box.appendChild(handle);
        });

        setupDragForEditBox(box, rep);
        setupSelectForEditBox(box, rep);

        OVERLAY_LAYER.appendChild(box);
    });
}

function setupSelectForEditBox(boxEl, rep) {
    boxEl.addEventListener('click', (e) => {
        if (e.target.classList.contains('resize-handle')) return;
        e.stopPropagation();

        // Deselect all
        document.querySelectorAll('.edit-box.selected').forEach(b => b.classList.remove('selected'));
        boxEl.classList.add('selected');
        selectedEditBox = { el: boxEl, rep };

        // Fill props panel
        document.getElementById('propText').value = rep.text || '';
        document.getElementById('propFont').value = rep.font_name || 'helv';
        document.getElementById('propFontSize').value = rep.font_size || 11;
        document.getElementById('propX').value = parseFloat(rep.x).toFixed(1);
        document.getElementById('propY').value = parseFloat(rep.y).toFixed(1);
        document.getElementById('propW').value = parseFloat(rep.width).toFixed(1);
        document.getElementById('propH').value = parseFloat(rep.height).toFixed(1);

        document.getElementById('propsPanel').classList.add('open');
    });
}

// ─── ALIGNMENT GUIDE LINE SYSTEM ───────────────────────────────────────
const SNAP_THRESHOLD = 6; // px

function getAllBoxEdges(excludeEl) {
    // Collect key horizontal/vertical positions from all OTHER edit boxes
    const hLines = new Set(); // y values
    const vLines = new Set(); // x values
    document.querySelectorAll('.edit-box').forEach(el => {
        if (el === excludeEl) return;
        const l = parseFloat(el.style.left);
        const t = parseFloat(el.style.top);
        const w = parseFloat(el.style.width);
        const h = parseFloat(el.style.height);
        vLines.add(l);           // left edge
        vLines.add(l + w / 2);  // center x
        vLines.add(l + w);      // right edge
        hLines.add(t);           // top edge
        hLines.add(t + h / 2);  // center y
        hLines.add(t + h);      // bottom edge
    });
    return { hLines: [...hLines], vLines: [...vLines] };
}

function showGuideLines(hPositions, vPositions) {
    removeGuideLines();
    const layer = OVERLAY_LAYER;
    const W = parseFloat(PDF_WRAPPER.style.width) || layer.offsetWidth;
    const H = parseFloat(PDF_WRAPPER.style.height) || layer.offsetHeight;

    hPositions.forEach(y => {
        const line = document.createElement('div');
        line.className = 'guide-line guide-h';
        line.style.cssText = `position:absolute;left:0;top:${y}px;width:${W}px;height:1px;
            background:rgba(37,99,235,0.7);pointer-events:none;z-index:500;
            border-top:1px dashed rgba(37,99,235,0.9);`;
        layer.appendChild(line);
    });
    vPositions.forEach(x => {
        const line = document.createElement('div');
        line.className = 'guide-line guide-v';
        line.style.cssText = `position:absolute;top:0;left:${x}px;height:${H}px;width:1px;
            background:rgba(37,99,235,0.7);pointer-events:none;z-index:500;
            border-left:1px dashed rgba(37,99,235,0.9);`;
        layer.appendChild(line);
    });
}

function removeGuideLines() {
    OVERLAY_LAYER.querySelectorAll('.guide-line').forEach(l => l.remove());
}

function snapToGuides(val, candidates, threshold) {
    let best = val, bestDist = threshold;
    candidates.forEach(c => {
        const d = Math.abs(val - c);
        if (d < bestDist) { bestDist = d; best = c; }
    });
    return best;
}

function setupDragForEditBox(boxEl, rep) {
    let dragStartX, dragStartY, origLeft, origTop;

    boxEl.addEventListener('mousedown', (e) => {
        if (e.target.classList.contains('resize-handle')) return;
        e.preventDefault();
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        origLeft = parseFloat(boxEl.style.left);
        origTop = parseFloat(boxEl.style.top);
        const boxW = parseFloat(boxEl.style.width);
        const boxH = parseFloat(boxEl.style.height);

        const { hLines, vLines } = getAllBoxEdges(boxEl);

        const onMove = (me) => {
            const dx = me.clientX - dragStartX;
            const dy = me.clientY - dragStartY;
            let newLeft = origLeft + dx;
            let newTop = origTop + dy;

            // Snap candidates for left edge, center x, right edge
            const snapX = snapToGuides(newLeft, vLines, SNAP_THRESHOLD)
                ?? snapToGuides(newLeft + boxW / 2, vLines, SNAP_THRESHOLD) - boxW / 2
                ?? snapToGuides(newLeft + boxW, vLines, SNAP_THRESHOLD) - boxW;

            const snapY = snapToGuides(newTop, hLines, SNAP_THRESHOLD)
                ?? snapToGuides(newTop + boxH / 2, hLines, SNAP_THRESHOLD) - boxH / 2
                ?? snapToGuides(newTop + boxH, hLines, SNAP_THRESHOLD) - boxH;

            // Find which edges snapped (for guide display)
            const activeH = [], activeV = [];
            const snappedLeft = Math.abs(newLeft - snapX) < SNAP_THRESHOLD ? snapX : newLeft;
            const snappedTop = Math.abs(newTop - snapY) < SNAP_THRESHOLD ? snapY : newTop;
            const snappedCX = Math.abs(newLeft + boxW / 2 - snapX) < SNAP_THRESHOLD ? snapX - boxW / 2 : null;
            const snappedCY = Math.abs(newTop + boxH / 2 - snapY) < SNAP_THRESHOLD ? snapY - boxH / 2 : null;

            // Prefer center snap, then edge snap
            newLeft = snappedCX ?? snappedLeft;
            newTop = snappedCY ?? snappedTop;

            // Collect active guides
            vLines.forEach(v => {
                if (Math.abs(newLeft - v) < 1 || Math.abs(newLeft + boxW / 2 - v) < 1 || Math.abs(newLeft + boxW - v) < 1)
                    activeV.push(v);
            });
            hLines.forEach(h => {
                if (Math.abs(newTop - h) < 1 || Math.abs(newTop + boxH / 2 - h) < 1 || Math.abs(newTop + boxH - h) < 1)
                    activeH.push(h);
            });

            showGuideLines(activeH, activeV);

            boxEl.style.left = newLeft + 'px';
            boxEl.style.top = newTop + 'px';
            rep.x = newLeft / currentZoom;
            rep.y = newTop / currentZoom;

            if (selectedEditBox?.rep === rep) {
                document.getElementById('propX').value = parseFloat(rep.x).toFixed(1);
                document.getElementById('propY').value = parseFloat(rep.y).toFixed(1);
            }
        };

        const onUp = () => {
            removeGuideLines();
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}

function setupResizeHandle(handleEl, boxEl, rep) {
    handleEl.addEventListener('mousedown', (e) => {
        e.stopPropagation();
        e.preventDefault();
        const dir = handleEl.getAttribute('data-dir');
        const startX = e.clientX;
        const startY = e.clientY;
        const origLeft = parseFloat(boxEl.style.left);
        const origTop = parseFloat(boxEl.style.top);
        const origW = parseFloat(boxEl.style.width);
        const origH = parseFloat(boxEl.style.height);

        const onMove = (me) => {
            const dx = me.clientX - startX;
            const dy = me.clientY - startY;
            let newLeft = origLeft, newTop = origTop, newW = origW, newH = origH;

            if (dir.includes('e')) newW = Math.max(20, origW + dx);
            if (dir.includes('s')) newH = Math.max(10, origH + dy);
            if (dir.includes('w')) { newLeft = origLeft + dx; newW = Math.max(20, origW - dx); }
            if (dir.includes('n')) { newTop = origTop + dy; newH = Math.max(10, origH - dy); }

            boxEl.style.left = newLeft + 'px';
            boxEl.style.top = newTop + 'px';
            boxEl.style.width = newW + 'px';
            boxEl.style.height = newH + 'px';

            rep.x = newLeft / currentZoom;
            rep.y = newTop / currentZoom;
            rep.width = newW / currentZoom;
            rep.height = newH / currentZoom;

            if (selectedEditBox?.rep === rep) {
                document.getElementById('propX').value = parseFloat(rep.x).toFixed(1);
                document.getElementById('propY').value = parseFloat(rep.y).toFixed(1);
                document.getElementById('propW').value = parseFloat(rep.width).toFixed(1);
                document.getElementById('propH').value = parseFloat(rep.height).toFixed(1);
            }
        };
        const onUp = () => {
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    });
}

// Apply props panel values to selected box
function applyPropsToSelected() {
    if (!selectedEditBox) return;
    const rep = selectedEditBox.rep;
    const el = selectedEditBox.el;

    rep.text = document.getElementById('propText').value;
    rep.font_name = document.getElementById('propFont').value;
    rep.font_size = parseFloat(document.getElementById('propFontSize').value);
    rep.x = parseFloat(document.getElementById('propX').value);
    rep.y = parseFloat(document.getElementById('propY').value);
    rep.width = parseFloat(document.getElementById('propW').value);
    rep.height = parseFloat(document.getElementById('propH').value);

    el.style.left = (rep.x * currentZoom) + 'px';
    el.style.top = (rep.y * currentZoom) + 'px';
    el.style.width = (rep.width * currentZoom) + 'px';
    el.style.height = (rep.height * currentZoom) + 'px';

    const label = el.querySelector('.edit-box-label');
    if (label) label.textContent = rep.text || '(vacío)';
}

// Delete selected box from preview replacements
function deleteSelected() {
    if (!selectedEditBox) return;
    const rep = selectedEditBox.rep;
    const idx = previewReplacements.indexOf(rep);
    if (idx > -1) previewReplacements.splice(idx, 1);
    selectedEditBox.el.remove();
    selectedEditBox = null;
    document.getElementById('propsPanel').classList.remove('open');
}

// Confirm edits → re-apply to original PDF and download
async function confirmAndDownload() {
    if (previewReplacements.length === 0) {
        alert('No hay reemplazos que confirmar.');
        return;
    }
    showLoading('Generando PDF final...');

    const formData = new FormData();
    formData.append('file', currentFile);
    formData.append('replacements', JSON.stringify(previewReplacements));
    formData.append('rotation', document.getElementById('rotationInput').value);

    try {
        const res = await fetch('/api/replace', { method: 'POST', body: formData });
        const data = await res.json();
        if (data.status === 'success') {
            const link = document.createElement('a');
            link.href = data.download_url;
            link.download = '';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } else {
            alert('Error: ' + data.message);
        }
    } catch (err) {
        console.error(err);
        alert('Error al generar PDF.');
    } finally {
        hideLoading();
    }
}

// Setup close props panel + navigation
document.addEventListener('DOMContentLoaded', () => {
    // ── Aplicar mismo texto a TODAS las etiquetas del preview ──
    document.getElementById('applyAllBtn')?.addEventListener('click', () => {
        const txt = document.getElementById('applyAllText').value.trim();
        if (!txt) {
            alert('Escribe el texto que quieres aplicar a todas las etiquetas.');
            return;
        }
        previewReplacements.forEach(rep => { rep.text = txt; });
        // Actualizar los labels visibles en la página actual
        document.querySelectorAll('.edit-box-label').forEach(lbl => {
            lbl.textContent = txt;
        });
        // Si hay una caja seleccionada, actualizar el panel de propiedades
        if (selectedEditBox) {
            document.getElementById('propText').value = txt;
        }
        alert(`Texto "${txt}" aplicado a las ${previewReplacements.length} etiquetas.`);
    });

    document.getElementById('closePropsPanelBtn')?.addEventListener('click', () => {
        document.getElementById('propsPanel').classList.remove('open');
        selectedEditBox = null;
        document.querySelectorAll('.edit-box.selected').forEach(b => b.classList.remove('selected'));
    });
    document.getElementById('exitPreviewBtn')?.addEventListener('click', exitPreviewMode);
    document.getElementById('confirmChangesBtn')?.addEventListener('click', confirmAndDownload);

    // Navegación entre cajas
    document.getElementById('prevBoxBtn')?.addEventListener('click', () => navigateToBox(-1));
    document.getElementById('nextBoxBtn')?.addEventListener('click', () => navigateToBox(1));

    // Click en canvas vacío deselecciona
    document.getElementById('overlayLayer')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('overlayLayer')) {
            selectedEditBox = null;
            document.querySelectorAll('.edit-box.selected').forEach(b => b.classList.remove('selected'));
            document.getElementById('propsPanel').classList.remove('open');
        }
    });
    init();
});
