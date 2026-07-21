# PDF Tools Setup (Windows + Linux)

Core PDF edit operations (merge, split, rotate, reorder, extract, delete, duplicate, structural compress, images→PDF, inspect, native text) work with **bundled** `pdf-lib` and `sharp` only.

Optional tools unlock advanced features.

## Optional tools

| Tool | Provides |
|------|----------|
| Poppler (`pdftoppm`, `pdftotext`) | PDF→images, better text extract |
| MuPDF (`mutool`) | PDF→images, text fallback |
| Ghostscript (`gs` / `gswin64c`) | PDF→images, advanced compress, repair |
| Tesseract | OCR (requires a rasterizer) |
| qpdf | Repair (preferred), object optimization, decrypt capability |

## Windows

### Poppler
- Download Poppler for Windows (e.g. from oschwartz10612/poppler-windows releases).
- Extract and add `Library\bin` to PATH, or place under `C:\Program Files\poppler\Library\bin`.

### MuPDF
- Install MuPDF tools; ensure `mutool.exe` is on PATH or under `C:\Program Files\mupdf\`.

### Ghostscript
- Install from https://ghostscript.com/releases/gsdnld.html
- Prefer `gswin64c.exe` under `C:\Program Files\gs\gs*\bin\`.

### Tesseract
- Install from https://github.com/UB-Mannheim/tesseract/wiki
- Default path: `C:\Program Files\Tesseract-OCR\tesseract.exe`
- Install language packs (e.g. `eng`, `vie`) as needed.

### qpdf
- Install from https://github.com/qpdf/qpdf/releases
- Ensure `qpdf.exe` is on PATH or under `C:\Program Files\qpdf\bin\`.

### AlphaStudio helper
```bash
npm run setup:tools
npm run tools:check
```

## Linux (Debian/Ubuntu)

```bash
sudo apt update
sudo apt install -y poppler-utils mupdf-tools ghostscript tesseract-ocr tesseract-ocr-eng qpdf
# Optional languages:
# sudo apt install tesseract-ocr-vie
```

## Linux (Fedora)

```bash
sudo dnf install poppler-utils mupdf ghostscript tesseract qpdf
```

## Verify

```bash
npm run tools:check
# or start the app and open Settings / capabilities API:
# GET /api/capabilities
```

Look for:

- `pdf.to-images.available`
- `pdf.ocr.available`
- `pdf.compress.advanced.available`
- `pdf.repair.available`
- `pdf.decrypt.available`

## Fallback engine selection

- **Rasterize:** pdftoppm → mutool → ghostscript
- **Text:** pdftotext → mutool → native content-stream scan → optional OCR
- **Advanced compress:** ghostscript → qpdf → structural pdf-lib
- **Repair:** qpdf → ghostscript
- **Never** use LibreOffice for PDF input rasterization or PDF edit ops
