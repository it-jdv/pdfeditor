import os
import sys
import threading
import webbrowser
import json
import pytesseract
from PIL import Image
import io
from flask import Flask, request, jsonify, send_file, render_template
from werkzeug.utils import secure_filename
import fitz

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

@app.route('/test_geom')
def test_geom():
    return render_template('test_geom.html')

@app.route('/log_geom')
def log_geom():
    print(f"FRONTLOG: rot={request.args.get('rot')} vp0={request.args.get('vp0')} vpNat={request.args.get('vpNat')}")
    return "ok"

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
            if not page_results["matches"]:
                try:
                    # high resolution image for better OCR
                    zoom = 2.0
                    mat = fitz.Matrix(zoom, zoom)
                    pix = page.get_pixmap(matrix=mat)
                    img = Image.open(io.BytesIO(pix.tobytes("png")))
                    
                    ocr_data = pytesseract.image_to_data(img, output_type=pytesseract.Output.DICT)
                    
                    n_boxes = len(ocr_data['level'])
                    for i in range(n_boxes):
                        text_val = ocr_data['text'][i].strip().lower()
                        if text_val and text_val in word_list:
                            # Scale back coordinates to PDF space
                            ocr_x = ocr_data['left'][i] / zoom
                            ocr_y = ocr_data['top'][i] / zoom
                            ocr_w = ocr_data['width'][i] / zoom
                            ocr_h = ocr_data['height'][i] / zoom
                            
                            page_results["matches"].append({
                                "word": text_val,
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
                    print(f"OCR failed for page {page_num}: {e}")
                    
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
                        new_text = rep.get('text', '')
                        
                        font_size = float(rep.get('font_size', max(min(w, h) * 1.0, 7)))
                        font_name = rep.get('font_name', 'helv')
                        font_map = {'Helvetica': 'helv', 'Times': 'tiro', 'Courier': 'cour',
                                    'helv': 'helv', 'tiro': 'tiro', 'cour': 'cour'}
                        pymufont = font_map.get(font_name.split('-')[0], 'helv')
                        
                        vis_text = fitz.Rect(vis_rect.x0 - 150, vis_rect.y0 + 3,
                                             vis_rect.x1 + 150, vis_rect.y1 + 3 + h)
                        phys_text = (vis_text * derot).normalize()
                        
                        res = page.insert_textbox(
                            phys_text, new_text,
                            fontsize=font_size, fontname=pymufont, color=(0, 0, 0), align=1, rotate=vrot
                        )
                        if res < 0:
                            print(f"Text insertion failed res={res}, retrying smaller font")
                            page.insert_textbox(
                                phys_text, new_text,
                                fontsize=max(font_size * 0.6, 4), fontname=pymufont,
                                color=(0, 0, 0), align=1, rotate=vrot
                            )
            
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

def open_browser():
    webbrowser.open_new('http://localhost:5000/')

if __name__ == '__main__':
    # Start the browser automatically
    if os.environ.get("WERKZEUG_RUN_MAIN") != "true":
        threading.Timer(1.25, open_browser).start()
    app.run(port=5000, debug=True)
