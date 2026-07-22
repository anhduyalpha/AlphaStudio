# PDF Tools Testing

## Unit / integration (no optional binaries required)

From repo root:

```bash
npm run fixtures:pdf:verify
npm run test:pdf
npm run test:e2e
```

Or targeted files:

```bash
cd server
node --import tsx --test --test-concurrency=1 \
  tests/pdf-page-selection.test.ts \
  tests/pdf-output-names.test.ts \
  tests/pdf-ops-extended.test.ts \
  tests/pdf-password-redaction.test.ts \
  tests/pdf-pipeline.test.ts \
  tests/pdf-validation.test.ts \
  tests/pdf-routing.test.ts \
  tests/pdf-jobs-reliability.test.ts \
  tests/ui-pdf-struct.test.ts
```

## What the suite covers

- Page selection syntax, order, out-of-range, invalid tokens
- Output naming (not bare `merged.pdf` / `download.pdf`)
- Merge, split (every page + every-N), rotate, reorder, extract
- Delete pages, duplicate pages, inspect JSON
- Structural compress metadata
- Images→PDF, PDF→text, scanned without OCR
- Exact operation contracts, cardinality, names, Unicode download headers, and metadata
- Output signature, archive structure, MIME/extension, reparse, and cache validation
- Upload abort, idempotency, SSE fallback, reload reconnection, and completed-result restoration
- PDF.js worker loading, bounded thumbnails, replacement cleanup, large-preview limits, and responsive layouts
- Repair available / unavailable
- Routing never uses LibreOffice for PDF input
- UI structure (groups, capability gates, engine label)

External binaries are **conditional**: tests pass without Poppler/GS/Tesseract/qpdf by asserting capability errors or skipping success paths when tools are present.

## Real integration procedure (with binaries installed)

1. Install Poppler, Ghostscript, Tesseract, qpdf (see `PDF_TOOLS_SETUP.md`).
2. Restart the API so capability cache refreshes (`detectCapabilities(true)` or process restart).
3. Confirm:

```bash
curl -s http://127.0.0.1:8787/api/capabilities | jq '.tools[] | select(.id|startswith("pdf."))'
```

4. Manual smoke (UI or API):

| Job | Expected |
|-----|----------|
| merge two small PDFs | `*-merged.pdf`, valid `%PDF-` |
| split every-n=2 | ZIP with parts |
| to-images PNG | engine `pdftoppm` or `mutool` or `ghostscript` in meta |
| to-text on text PDF | `.txt` with page markers |
| ocr on scanned PDF | text when tesseract+rasterizer present |
| compress-advanced | engine Ghostscript only; size fields in meta |
| repair | repaired PDF when qpdf/gs present |
| inspect | JSON card with pageCount, checksum |

5. Cancellation: start OCR on multipage PDF, cancel — child processes should terminate (no orphan tesseract/gs).

## Typecheck / build

```bash
npm run build:server
npm run build:client
npm run typecheck
```

## Regression

Run the complete server regression suite:

```bash
npm test
```

Playwright uses isolated temporary `DATA_DIR` and `DB_PATH` values and a production Vite build. The committed fixture generator verifies deterministic hashes, including a real password-protected PDF (`alphastudio`). Linux setup is documented and code-reviewed; do not report Linux execution unless a Linux runner was actually used.
