# PDF Tools Architecture

## Processing flow

```
PdfView → upload → POST /api/jobs { type: 'pdf' }
  → createJob (operation contract, capability gate, idempotency, SQLite)
  → worker pool (category: pdf)
  → worker-process (path validation)
  → processors/index → processPdf (thin)
  → server/src/pdf/operations/* (lazy)
  → output validation → download
```

## Module layout

```
server/src/processors/pdf.ts     # validate + normalize + dispatch
server/src/pdf/
  operation-contract.ts           # authoritative ids/cardinality/options/outputs/engines
  page-selection.ts              # one-based → zero-based parser
  output-names.ts                # user-facing download names
  operation-options.ts           # typed options + password redaction
  progress.ts                    # monotonic stage tracker
  errors.ts                      # stable PDF error codes
  load.ts / save.ts              # shared load/save + validation
  operations/
    merge.ts, split.ts, rotate.ts, reorder.ts, extract.ts,
    delete-pages.ts, duplicate-pages.ts, images-to-pdf.ts,
    pdf-to-images.ts, pdf-to-text.ts, ocr.ts, compress.ts,
    inspect.ts, repair.ts
server/src/convert/
  pdfInspect.ts, pdfRender.ts, pdfText.ts, quality.ts
```

## Operations and engines

| Operation | Capability | Engine |
|-----------|------------|--------|
| merge | `pdf.merge` | pdf-lib |
| split | `pdf.split` | pdf-lib (+ archiver ZIP) |
| rotate | `pdf.rotate` | pdf-lib |
| reorder | `pdf.reorder` | pdf-lib |
| extract | `pdf.extract` | pdf-lib |
| delete-pages | `pdf.delete-pages` | pdf-lib |
| duplicate-pages | `pdf.duplicate-pages` | pdf-lib |
| from-images | `pdf.from-images` | sharp + pdf-lib |
| to-images | `pdf.to-images` | pdftoppm → mutool → ghostscript |
| to-text | `pdf.to-text` | pdftotext → mutool → native |
| ocr | `pdf.ocr` | tesseract + rasterizer |
| ocr searchable | `pdf.ocr.searchable` | **unavailable** (not faked) |
| compress structural | `pdf.compress.structural` | pdf-lib object streams |
| compress advanced | `pdf.compress.advanced` | Ghostscript only; fails closed |
| inspect | `pdf.inspect` | pdf-lib |
| repair | `pdf.repair` | qpdf → ghostscript |
| decrypt | `pdf.decrypt` | **unavailable** (no handler; not advertised as an operation) |

## Page selection

Shared parser (`parsePageSelection`) supports: `1`, `1,3,5`, `1-3`, `1-`, `-5`, `all`, `odd`, `even`, `last`, combinations `1-3,7,10-`. UI is one-based; backend uses zero-based indices. Invalid syntax and out-of-range pages throw.

## Progress stages

`queued` → `uploading` → `validating` → `inspecting` → `preparing` → `processing` | `rendering` | `ocr` | `optimizing` → `packaging` → `validating-output` → `completed`

Progress is monotonic (0–99 until validation succeeds, then 100).

## Operation contract

`/api/capabilities` publishes the safe descriptors from `operation-contract.ts`. The UI supplies labels and grouping only; accepted IDs, capability IDs, cardinality, options, output kinds, and engine policy come from the backend. Undocumented aliases are rejected. Password controls are not shown because no current operation consumes a password.

## Adding a new operation

1. Implement `server/src/pdf/operations/<name>.ts` exporting an async handler `(ctx: PdfOpContext) => ProcessResult`.
2. Register lazy loader in `server/src/pdf/index.ts`.
3. Add its descriptor and map its capability in `processors/index.ts` and `capabilities.ts`.
4. Add UI entry in `PdfView.jsx` under the correct group.
5. Add unit/integration tests.
6. Document engine and capability here.

## Error codes

See `server/src/pdf/errors.ts`: `PASSWORD_REQUIRED`, `INVALID_PASSWORD`, `CORRUPTED_PDF`, `EMPTY_PDF`, `MIME_MISMATCH`, `PAGE_RANGE_INVALID`, `PAGE_OUT_OF_RANGE`, `NO_EXTRACTABLE_TEXT`, `OCR_UNAVAILABLE`, `RASTERIZER_UNAVAILABLE`, `REPAIR_UNAVAILABLE`, `COMPRESSION_UNAVAILABLE`, `OUTPUT_VALIDATION_FAILED`, `PDF_TOO_LARGE`, `PDF_PAGE_LIMIT_EXCEEDED`, `CANCELLED`, `TIMEOUT`, etc.

## Limits

- Worker path allowlist: inputs under uploads, work under temp/jobId, outputs under outputs/jobId.
- External tools via argument arrays only (`execFileTracked`).
- ZIP entry names sanitized (no path traversal).
- OCR page limit configurable (default 50).
- Preview byte/page limits are configurable with `VITE_PDF_PREVIEW_MAX_BYTES` and `VITE_PDF_PREVIEW_MAX_PAGES`.
- The organizer renders a 12-page window with bounded concurrency and cancels PDF.js loading/render tasks on replacement or unmount.
- Completion validates size, signature, MIME/extension agreement, structure/reparsing, and persisted metadata before progress reaches 100%.
