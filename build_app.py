import os
import sys
import PyInstaller.__main__

if __name__ == '__main__':
    sep = ';' if sys.platform.startswith('win') else ':'
    is_win = sys.platform.startswith('win')
    is_mac = sys.platform == 'darwin'

    args = [
        'app.py',
        '--name=EditorPDF_ArtTocador',
        '--onefile' if is_win else '--onedir',  # onedir en macOS evita conflicto con .app bundle
        '--noconsole' if is_win else '--windowed',
        f'--add-data=templates{sep}templates',
        f'--add-data=static{sep}static',
        '--collect-all=fitz',
        '--hidden-import=flask',
        '--hidden-import=werkzeug',
        '--hidden-import=jinja2',
        '--hidden-import=PIL',
        '--hidden-import=PIL.Image',
        '--hidden-import=pytesseract',
        '--hidden-import=fitz',
        '--clean',
    ]

    # Agregar icono si existe
    if is_win and os.path.exists('icon.ico'):
        args.append('--icon=icon.ico')
    elif is_mac and os.path.exists('icon.icns'):
        args.append('--icon=icon.icns')

    PyInstaller.__main__.run(args)

    # En macOS, crear .dmg automáticamente
    if is_mac:
        import subprocess
        app_path = 'dist/EditorPDF_ArtTocador.app'
        dmg_path = 'dist/EditorPDF_ArtTocador.dmg'
        if os.path.exists(app_path):
            print(f"\nCreando {dmg_path}...")
            subprocess.run([
                'hdiutil', 'create',
                '-volname', 'EditorPDF ArtTocador',
                '-srcfolder', app_path,
                '-ov', '-format', 'UDZO',
                dmg_path
            ], check=True)
            print(f"DMG creado: {dmg_path}")
