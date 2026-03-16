import os
import sys
import threading
import webbrowser
import json
import re
import pytesseract
from PIL import Image
import io
from flask import Flask, request, jsonify, send_file, render_template
from werkzeug.utils import secure_filename
try:
    import pymupdf as fitz   # PyMuPDF >= 1.24 (nombre oficial del paquete)
except ImportError:
    import fitz               # PyMuPDF < 1.24 (nombre legacy)

# --- Auto-detectar Tesseract en Windows si no está en PATH ---
if sys.platform.startswith('win'):
    _TESSERACT_CANDIDATES = [
        r'C:\Program Files\Tesseract-OCR\tesseract.exe',
        r'C:\Program Files (x86)\Tesseract-OCR\tesseract.exe',
        os.path.expanduser(r'~\AppData\Local\Programs\Tesseract-OCR\tesseract.exe'),
        os.path.expanduser(r'~\AppData\Local\Tesseract-OCR\tesseract.exe'),
    ]
    for _candidate in _TESSERACT_CANDIDATES:
        if os.path.isfile(_candidate):
            pytesseract.pytesseract.tesseract_cmd = _candidate
            print(f"[INFO] Tesseract encontrado en: {_candidate}")
            break
    else:
        print("[WARN] Tesseract no encontrado en rutas comunes. Asegúrate de instalarlo.")

if getattr(sys, 'frozen', False):
    template_folder = os.path.join(sys._MEIPASS, 'templates')
    static_folder = os.path.join(sys._MEIPASS, 'static')
    app = Flask(__name__, template_folder=template_folder, static_folder=static_folder)
    base_dir = os.path.dirname(sys.executable)
else:
    app = Flask(__name__)
    base_dir = os.path.dirname(os.path.abspath(__file__))

# Configurations
app.config['UPLOAD_FOLDER'] = os.path.join(base_dir, 'uploads')
os.makedirs(app.config['UPLOAD_FOLDER'], exist_ok=True)
app.config['MAX_CONTENT_LENGTH'] = 50 * 1024 * 1024  # 50 MB limit

@app.route('/')
def index():
    return render_template('index.html')


@app.route('/api/analyze', methods=['POST'])
def analyze_pdf():
    if 'file' not in request.files:
        return jsonify({"status": "error", "message": "No file part"}), 400
    file = request.files['file']
    if file.filename == '':
        return jsonify({"status": "error", "message": "No selected file"}), 400
    
    words = request.form.get('words', '')
    forced_rotation = request.form.get('rotation', 'auto')
    
    word_list = [w.strip().lower() for w in words.split(',') if w.strip()]
    if not word_list:
        return jsonify({"status": "error", "message": "No words provided"}), 400

    filename = secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)

    try:
        doc = fitz.open(filepath)
        results = []
        total_found = 0
        has_native_text = False
        total_pages = len(doc)
        
        for page_num in range(total_pages):
            page = doc.load_page(page_num)
            
            # vis_rot: the rotation that matches what the user sees in the browser
            vis_rot = page.rotation if forced_rotation == 'auto' else int(forced_rotation)
            page.set_rotation(vis_rot)
            
            text = page.get_text()
            if text.strip():
                has_native_text = True
            
            # --- Detect dominant font from page ---
            default_font_name = "Helvetica"
            default_font_size = 10.0
            try:
                blocks = page.get_text("dict")["blocks"]
                font_sizes = []
                font_names = []
                for b in blocks:
                    for line in b.get("lines", []):
                        for span in line.get("spans", []):
                            if span.get("size", 0) > 3:
                                font_sizes.append(span["size"])
                                font_names.append(span.get("font", "Helvetica"))
                if font_sizes:
                    # Most common size
                    from collections import Counter
                    default_font_size = round(Counter(font_sizes).most_common(1)[0][0], 1)
                    default_font_name = Counter(font_names).most_common(1)[0][0]
            except Exception:
                pass
                
            page_results = {
                "page": page_num + 1,
                "width": page.rect.width,
                "height": page.rect.height,
                "rotation": page.rotation,
                "default_font_name": default_font_name,
                "default_font_size": default_font_size,
                "matches": []
            }
            
            for w in word_list:
                text_instances = page.search_for(w)
                for inst in text_instances:
                    page_results["matches"].append({
                        "word": w,
                        "x": inst.x0,
                        "y": inst.y0,
                        "width": inst.width,
                        "height": inst.height,
                        "source": "native",
                        "viewport_rotation": vis_rot,
                        "font_name": default_font_name,
                        "font_size": default_font_size
                    })
                    total_found += 1
                    
            # --- LOCAL OCR WITH TESSERACT FALLBACK ---
            # Corre OCR si no hay coincidencias nativas O si el PDF no tiene texto nativo real
            page_text = page.get_text().strip()
            run_ocr = (not page_results["matches"]) or (not page_text)
            print(f"[DEBUG] Pág {page_num+1}: texto_nativo={bool(page_text)} | matches_nativos={len(page_results['matches'])} | run_ocr={run_ocr}")
            if run_ocr:
                try:
                    # Zoom alto para mejor calidad en PDFs escaneados
                    zoom = 3.0
                    mat = fitz.Matrix(zoom, zoom)
                    pix = page.get_pixmap(matrix=mat)
                    img = Image.open(io.BytesIO(pix.tobytes("png")))
                    print(f"[DEBUG] Pág {page_num+1}: imagen OCR {img.size[0]}x{img.size[1]}px")

                    # Intentar con español+inglés, caer en default si el lang pack no está instalado
                    lang_used = 'spa+eng'
                    try:
                        ocr_data = pytesseract.image_to_data(
                            img, lang='spa+eng', output_type=pytesseract.Output.DICT
                        )
                    except pytesseract.TesseractError:
                        lang_used = 'default(eng)'
                        ocr_data = pytesseract.image_to_data(
                            img, output_type=pytesseract.Output.DICT
                        )

                    # Tokens reconocidos (no vacíos)
                    all_tokens = [t.strip() for t in ocr_data['text'] if t.strip()]
                    print(f"[DEBUG] Pág {page_num+1}: lang={lang_used} | tokens_ocr={len(all_tokens)} | buscando={word_list}")
                    print(f"[DEBUG] Pág {page_num+1}: primeros 40 tokens OCR: {all_tokens[:40]}")

                    n_boxes = len(ocr_data['level'])
                    for i in range(n_boxes):
                        # Limpiar puntuación pegada al token OCR antes de comparar
                        raw = ocr_data['text'][i].strip()
                        text_val = re.sub(r'[^a-záéíóúüñA-ZÁÉÍÓÚÜÑ0-9]', '', raw).lower()
                        if not text_val:
                            continue

                        matched_word = None
                        for w in word_list:
                            # Coincidencia exacta (sin puntuación) o el token contiene la palabra buscada
                            if text_val == w or text_val.startswith(w) or text_val.endswith(w):
                                matched_word = w
                                break

                        if matched_word:
                            ocr_x = ocr_data['left'][i] / zoom
                            ocr_y = ocr_data['top'][i] / zoom
                            ocr_w = ocr_data['width'][i] / zoom
                            ocr_h = ocr_data['height'][i] / zoom
                            print(f"[DEBUG] Pág {page_num+1}: MATCH '{matched_word}' <- token='{raw}' en ({ocr_x:.0f},{ocr_y:.0f})")

                            page_results["matches"].append({
                                "word": matched_word,
                                "x": ocr_x,
                                "y": ocr_y,
                                "width": ocr_w,
                                "height": ocr_h,
                                "source": "ocr",
                                "viewport_rotation": vis_rot,
                                "font_name": default_font_name,
                                "font_size": round(ocr_h * 0.85, 1)
                            })
                            total_found += 1
                except Exception as e:
                    print(f"[ERROR] OCR falló en pág {page_num+1}: {e}")
                    
            results.append(page_results)
        
        doc.close()
        return jsonify({
            "status": "success",
            "has_native_text": has_native_text,
            "total_found": total_found,
            "pages": results,
            "filename": filename
        })
        
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route('/api/replace', methods=['POST'])
def replace_text():
    import json
    if 'file' in request.files:
        file = request.files['file']
        filename = secure_filename(file.filename)
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        file.save(filepath)
    else:
        # Fallback to json payload if previously uploaded
        data = request.json or {}
        filename = secure_filename(data.get('filename', ''))
        filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
        if not filename or not os.path.exists(filepath):
            return jsonify({"status": "error", "message": "File not found on server. Suba el archivo primero."}), 404

    replacements_str = request.form.get('replacements')
    if replacements_str is None and request.json:
        replacements_str = json.dumps(request.json.get('replacements', []))
    
    try:
        replacements = json.loads(replacements_str)
    except (json.JSONDecodeError, TypeError):
        replacements = []

    if not replacements:
        return jsonify({"status": "error", "message": "No replacements provided"}), 400

    forced_rotation = request.form.get('rotation', 'auto')
    if forced_rotation == 'auto' and request.json and 'rotation' in request.json:
        forced_rotation = request.json.get('rotation', 'auto')

    out_filename = filename.replace('.pdf', '_corregido.pdf')
    out_filepath = os.path.join(app.config['UPLOAD_FOLDER'], out_filename)

    
    try:
        doc = fitz.open(filepath)
        
        for page_num in range(len(doc)):
            page = doc.load_page(page_num)
            orig_rot = page.rotation
            
            # Filter replacements for this page
            page_reps = [r for r in replacements if r.get('page', 1) - 1 == page_num]
            
            if page_reps:
                print(f"Page {page_num} processing {len(page_reps)} replacements.")
                
                # Group replacements by the rotation they were made in
                grouped_reps = {}
                for rep in page_reps:
                    vrot = rep.get('viewport_rotation', orig_rot)
                    grouped_reps.setdefault(vrot, []).append(rep)
                    
                for vrot, reps in grouped_reps.items():
                    page.set_rotation(vrot)
                    derot = page.derotation_matrix  # visual → physical transform
                    
                    # Step 1: Redact the ORIGINAL word position (orig_* or x/y fallback)
                    for rep in reps:
                        ox = rep.get('orig_x', rep['x'])
                        oy = rep.get('orig_y', rep['y'])
                        ow = rep.get('orig_width', rep['width'])
                        oh = rep.get('orig_height', rep['height'])
                        orig_vis_rect = fitz.Rect(ox, oy, ox + ow, oy + oh)
                        phys_rect = (orig_vis_rect * derot).normalize()
                        print(f"Redacting original (vis={orig_vis_rect} -> phys={phys_rect}) at {vrot}deg")
                        page.add_redact_annot(phys_rect, fill=(1, 1, 1))
                        
                    page.apply_redactions()
                    
                    # Step 2: Insert text at the USER-ADJUSTED position (x/y/w/h)
                    for rep in reps:
                        x, y, w, h = rep['x'], rep['y'], rep['width'], rep['height']
                        vis_rect = fitz.Rect(x, y, x + w, y + h)
                        new_text = rep.get('text') or ''

                        font_size = float(rep.get('font_size') or max(h * 0.75, 8))
                        font_size = max(font_size, 7.0)   # mínimo legible
                        font_name = rep.get('font_name', 'helv')
                        font_map = {'Helvetica': 'helv', 'Times': 'tiro', 'Courier': 'cour',
                                    'helv': 'helv', 'tiro': 'tiro', 'cour': 'cour'}
                        pymufont = font_map.get(font_name.split('-')[0], 'helv')

                        # ── Calcular ancho mínimo REAL en puntos tipográficos ──────────────
                        # Ancho aproximado por carácter en Helvetica ≈ font_size × 0.55
                        min_w = max(vis_rect.width, len(new_text) * font_size * 0.60 + 6)
                        min_h = max(vis_rect.height + 4, font_size * 1.5)

                        # Construir rect de inserción ajustado para no salir de la página
                        ins_x0 = vis_rect.x0
                        ins_x1 = ins_x0 + min_w
                        if ins_x1 > page.rect.width:          # se sale por la derecha
                            ins_x0 = max(0.0, page.rect.width - min_w)
                            ins_x1 = page.rect.width

                        ins_y0 = vis_rect.y0 - 2
                        ins_y1 = ins_y0 + min_h
                        if ins_y1 > page.rect.height:
                            ins_y1 = page.rect.height
                            ins_y0 = max(0.0, ins_y1 - min_h)

                        vis_insert = fitz.Rect(ins_x0, ins_y0, ins_x1, ins_y1)
                        phys_insert = (vis_insert * derot).normalize()

                        res = page.insert_textbox(
                            phys_insert, new_text,
                            fontsize=font_size, fontname=pymufont, color=(0, 0, 0), align=0
                        )
                        if res < 0:
                            # Todavía no cabe: reducir fuente hasta que entre
                            for scale in (0.85, 0.70, 0.55):
                                res2 = page.insert_textbox(
                                    phys_insert, new_text,
                                    fontsize=max(font_size * scale, 4),
                                    fontname=pymufont, color=(0, 0, 0), align=0
                                )
                                print(f"  ↳ retry scale={scale:.0%} → res={res2:.0f}")
                                if res2 >= 0:
                                    break
                            else:
                                print(f"  ⚠ No cupo '{new_text}' en {vis_insert} — se insertó de todos modos")
                        else:
                            print(f"  ✓ '{new_text}' insertado en {vis_insert} fs={font_size:.1f}")

            
            # Apply the correct rotation to EVERY page (not just the ones with replacements)
            # This ensures the output document looks the same as the preview for all pages
            if forced_rotation != 'auto':
                page.set_rotation(int(forced_rotation))
            else:
                page.set_rotation(orig_rot)
                
        doc.save(out_filepath)
        doc.close()
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400
        
    return jsonify({
        "status": "success",
        "message": "Proceso finalizado.",
        "download_url": f"/api/download/{out_filename}",
        "filename": out_filename
    })

@app.route('/api/debug')
def debug_info():
    """Diagnóstico del entorno: Tesseract, idiomas, PyMuPDF, Python."""
    import subprocess, platform
    info = {}

    # Python
    info['python'] = sys.version

    # PyMuPDF
    try:
        info['pymupdf'] = fitz.version
    except Exception as e:
        info['pymupdf'] = f'ERROR: {e}'

    # Tesseract — ruta y versión
    try:
        tess_cmd = pytesseract.get_tesseract_version()
        info['tesseract_version'] = str(tess_cmd)
    except Exception as e:
        info['tesseract_version'] = f'ERROR: {e}'

    try:
        info['tesseract_cmd'] = pytesseract.pytesseract.tesseract_cmd
    except Exception:
        info['tesseract_cmd'] = 'default'

    # Idiomas instalados en Tesseract
    try:
        langs = pytesseract.get_languages(config='')
        info['tesseract_languages'] = langs
    except Exception as e:
        info['tesseract_languages'] = f'ERROR: {e}'

    # Test rápido de OCR sobre imagen blanca (1 pixel)
    try:
        test_img = Image.new('RGB', (200, 50), color=(255, 255, 255))
        ocr_out = pytesseract.image_to_string(test_img)
        info['ocr_test'] = 'OK (imagen en blanco procesada sin error)'
    except Exception as e:
        info['ocr_test'] = f'ERROR: {e}'

    # Variables de entorno relevantes
    info['PATH_has_tesseract'] = 'tesseract' in os.environ.get('PATH', '').lower() or \
                                  any('tesseract' in p.lower() for p in os.environ.get('PATH','').split(os.pathsep))
    info['platform'] = platform.platform()

    return jsonify(info)


@app.route('/api/preview/<filename>')
def preview_file(filename):
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(filename))
    if os.path.exists(filepath):
        return send_file(filepath, as_attachment=False)
    return "File not found", 404

@app.route('/api/download/<filename>')
def download_file(filename):
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], secure_filename(filename))
    if os.path.exists(filepath):
        return send_file(filepath, as_attachment=True)
    return "File not found", 404

PORT = 8080

def open_browser():
    webbrowser.open_new(f'http://localhost:{PORT}/')

if __name__ == '__main__':
    # Start the browser automatically
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        threading.Timer(1.25, open_browser).start()
    app.run(port=PORT, debug=True)
