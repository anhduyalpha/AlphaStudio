# PDF Tools Audit

**Branch:** `features/pdftools`  
**Date:** 2026-07-21  
**Scope:** Pre-implementation audit of AlphaStudio PDF Tools (no behavior changes in this document).

## 1. Current processing flow

```
PdfView.jsx
  → FilePicker + operation options
  → useJobRunner.run('pdf', { files, options })
  → api.runJob (upload files if needed)
  → POST /api/jobs { type: 'pdf', uploadIds, options }
  → createJob (assertJobCapable, SQLite row, category=pdf)
  → worker pool (jobs.ts) leases job → fork worker-process
  → worker-process validates paths → getProcessor('pdf')
  → processors/index → processPdf (lazy import)
  → validatePdfInput (per file) → switch(operation)
  → pdf-lib / convert/pdfRender / convert/pdfText
  → assertValidOutput → ProcessResult
  → parent persists output path/name/mime + result cache
  → frontend JobOutputCard / download via GET /api/jobs/:id/download
```

Progress path: worker `onProgress` → IPC → progress batcher (Δ≥5% or 500ms) → DB + SSE `/api/jobs/:id/events` + `jobEvents` emitter. Client may also poll `GET /api/jobs/:id`.

## 2. What currently works well

| Area | Assessment |
|------|------------|
| Job engine isolation | PDF work runs in worker processes; main API stays non-blocking |
| Lazy processor load | `processors/index.ts` lazy-imports heavy modules |
| Input validation | `validatePdfInput` checks magic, empty, encryption, page tree, MIME/ext mismatch |
| Core edit ops | merge, split (every page→ZIP), rotate (+existing rotation), reorder, extract, from-images via pdf-lib |
| Structural compress | Honest `structuralOnly` meta + quality presets |
| PDF→images | External only: pdftoppm → mutool → ghostscript; LibreOffice excluded |
| PDF→text | pdftotext → mutool → native stream scan; OCR gated on tesseract+rasterizer |
| Child process tracking | `execFileTracked` / child-registry for cancel of external tools |
| Capability gating | `pdf.to-images` / `pdf.ocr` hidden or unavailable when tools missing |
| Worker category | PDF classified separately for concurrency |
| Tests | pdf-pipeline, pdf-validation, pdf-routing, pdf-jobs-reliability cover core paths |
| Output validation | `assertValidOutput` for size/ext; PDF text uses `assertMeaningfulTextOutput` |

## 3. Incomplete, incorrect, fragile, or risky areas

### 3.1 Missing operations
- **delete-pages**, **duplicate-pages**, **inspect** (as job op), **repair**, dedicated **ocr** op, **advanced compress**, **decrypt** — not implemented as first-class ops.
- Split only supports “every page → ZIP”; no every-N, selected ranges, or user-defined groups.
- Images→PDF: only PNG path via sharp re-encode; no page size modes, margins, fit modes, EXIF orientation control beyond sharp defaults.
- Compress: structural pdf-lib only; no Ghostscript/qpdf advanced path despite optional binaries detecting qpdf/gs.

### 3.2 Page selection
- `parsePages` in `processors/pdf.ts` silently drops invalid tokens and clamps out-of-range ends; no `odd`/`even`/`last`/`all`.
- Does not throw on invalid syntax or pages beyond document range (requirement: clear errors).
- Duplicates removed via `Set` (order of first occurrence kept); reorder cannot intentionally duplicate without a separate option.

### 3.3 Output naming
- Generic download names: `merged.pdf`, `rotated.pdf`, `reordered.pdf`, `extracted.pdf`, `compressed.pdf`, `images.pdf`, `split-pages.zip`.
- Internal storage uses `randomServerName` (good); user-facing `outputName` is not derived from original filename.

### 3.4 Monolithic processor
- All ops live in single `server/src/processors/pdf.ts` (~350 lines growing). Harder to unit-test ops in isolation; duplicates load/save patterns.

### 3.5 Engine reporting
- UI hardcodes **Engine: pdf-lib** for every operation.
- `convertPdfToImages` meta uses generic `engine: 'rasterizer'` instead of `pdftoppm` | `mutool` | `ghostscript`.
- Inspect result always reports `engine: 'pdf-lib'`.

### 3.6 UI gaps
- No PDF→text, OCR, inspect, repair, delete, duplicate, advanced compress in `PdfView.jsx`.
- Page range + rotate angle shown for all ops (including merge/from-images).
- Capability `pdf.compress` (single) vs needed split structural/advanced.
- No job summary, client-side validation depth, preview/page organizer, tab reconnect UX beyond default job runner.
- Inputs not cleared after success; no Organize/Convert/Optimize/Analyze grouping.
- Batch/Export tabs are empty shells.

### 3.7 Progress stages
- Mixed ad-hoc stages: `extracting`, `Merged N/M`, `OCR`, `optimizing` — not the mandated set (`queued`, `uploading`, `validating`, `inspecting`, `preparing`, `processing`, `rendering`, `ocr`, `optimizing`, `packaging`, `validating-output`, `completed`).
- No guarantee of monotonic progress helper; completion sometimes reported before all validation in nested helpers (mostly OK for savePdf path).

### 3.8 Password / encryption
- Encrypted PDFs throw `PASSWORD_REQUIRED` (good distinction vs corrupt when message matches).
- No decrypt path; password if ever passed would be JSON-stringified into `jobs.options` (security risk).
- No tests proving password absence from logs/DB/events/result.

### 3.9 Error model
- Partial codes in `PdfErrorCode`; missing mandated: `INVALID_PASSWORD`, `PAGE_RANGE_INVALID`, `PAGE_OUT_OF_RANGE`, `RASTERIZER_UNAVAILABLE`, `REPAIR_UNAVAILABLE`, `COMPRESSION_UNAVAILABLE`, `PDF_TOO_LARGE`, `PDF_PAGE_LIMIT_EXCEEDED`, `CANCELLED`, `TIMEOUT`.
- Cancellation often throws `badRequest('Cancelled')` instead of stable `CANCELLED`.
- Some rasterizer failures map to `UNSUPPORTED_CONVERSION` / `BAD_REQUEST`.

### 3.10 Capabilities incomplete
Present: merge, split, rotate, reorder, compress (structural), extract, to-images, to-text, ocr, from-images.  
Missing as distinct caps: `pdf.delete-pages`, `pdf.duplicate-pages`, `pdf.compress.structural`, `pdf.compress.advanced`, `pdf.inspect`, `pdf.repair`, `pdf.decrypt`.  
`pdf.compress` is not split; advanced compress not capability-gated.

## 4. Backend operations not exposed in the UI

| Operation | Backend | UI |
|-----------|---------|-----|
| `to-text` / `extract-text` | Yes (`processPdf`) | **No** |
| OCR (via to-text + ocr flag) | Yes | **No** dedicated control |
| `to-images` | Yes | Only if capability available (OK) |
| inspect route (`/api/inspect`) | Yes (generic) | Not a PDF job op / card |
| delete-pages, duplicate-pages, repair, advanced compress, ocr op | No | No |

## 5. Wrong or generic engine reporting

| Location | Current | Correct |
|----------|---------|---------|
| `PdfView.jsx` sidebar | Always `pdf-lib` | Per-op expected engine or result meta |
| `pdfRender.convertPdfToImages` meta | `rasterizer` | Actual `pdftoppm` / `mutool` / `ghostscript` |
| Compress meta | No `engine` field | `pdf-lib` (structural) or gs/qpdf |
| Capability list | No engine field on tools | Optional selected engine when detectable |

## 6. External binary dependencies

| Binary | Used for | Required? |
|--------|----------|-----------|
| **pdf-lib** (npm) | Merge/split/rotate/reorder/extract/compress-structural/from-images load | Bundled |
| **sharp** (npm) | Images→PDF | Bundled |
| **archiver** (npm) | Multi-file ZIP | Bundled |
| **pdftoppm** (Poppler) | PDF→images, OCR raster | Optional |
| **mutool** (MuPDF) | PDF→images, text | Optional |
| **ghostscript** (`gs` / `gswin64c`) | PDF→images fallback; advanced compress/repair target | Optional |
| **pdftotext** (Poppler) | Text extract | Optional |
| **tesseract** | OCR | Optional (+ rasterizer) |
| **qpdf** | Detected in optional-binaries; **not used** yet (repair/decrypt/compress target) | Optional |
| **LibreOffice** | **Must not** rasterize or process PDF inputs | N/A for PDF tools |

Detection: `server/src/tools/optional-binaries.ts` (PATH + Windows common paths, 60s cache).

## 7. Risk assessment

| Risk | Severity | Notes |
|------|----------|-------|
| **Memory** | High | `readFileSync` full PDF into Buffer for every load; merge loads docs sequentially (good) but holds output doc growing; large multi-page rasters accumulate files |
| **File descriptors** | Medium | Sync open/read patterns; inspect cache holds results; ZIP streams OK |
| **Timeouts** | Medium | Raster/OCR use 120–180s tool timeouts; job-level timeout exists in worker pool |
| **Worker crashes** | Medium | Pool restart logic present; must ensure jobs fail clearly not stuck forever (reliability tests exist partially) |
| **Cancellation** | Medium | Child kill via registry; in-process pdf-lib loops check `isCancelled` but not between every page on all paths; cancel often reported as BAD_REQUEST |
| **Temp cleanup** | Medium | OCR/raster work dirs cleaned in try/finally mostly; failure paths use empty catch for unlink |
| **Unicode paths (Windows)** | Medium | Text/render stage ASCII copy for tools; good pattern to extend everywhere external tools run |
| **Corrupted PDFs** | Low–Med | Magic + load catch; truncated heuristic weak (only size&lt;100 without %%EOF) |
| **Encrypted PDFs** | Med | Distinguished when pdf-lib throws encrypt message; no decrypt; options would persist secrets if password added naively |
| **Empty / bad outputs** | Med | assertValidOutput checks size/ext; ZIP path traversal not explicitly hardened on extract side; empty PDF after save guarded |
| **Extension mismatches** | Low | validatePdfInput checks declared name/mime |
| **Progress stuck at 99%** | Low–Med | Depends on progress batcher + final 100% only on success paths |
| **Cache invalidation** | Med | Cache key from type+checksums+normalized options; missing files handled in reliability tests partially |
| **Concurrency** | Med | PDF category exists; OCR/raster can still monopolize a worker; no separate OCR slot limit |

## 8. Security notes (pre-change)

- Worker rejects input paths outside uploads dir and fixed work/output dirs (good).
- Client cannot pass arbitrary FS paths into processor inputs via job API (upload ids only).
- External tools invoked via `execFile`/`execFileTracked` with argument arrays (good).
- `sanitizeUserError` strips local paths from many user messages.
- Job options stored raw in SQLite — any future password field must be redacted before persist.
- No path-traversal hardening documented for ZIP member names on multi-output packaging beyond archiver controlled names.

## 9. Test coverage snapshot

| Suite | Covers |
|-------|--------|
| `pdf-pipeline.test.ts` | merge, rotate, split zip, reorder, extract, compress structural, from-images, to-text |
| `pdf-validation.test.ts` | magic, empty, encrypt, parsePages ranges, OCR unavailable, text sample |
| `pdf-routing.test.ts` | capability/routing for ops |
| `pdf-jobs-reliability.test.ts` | empty output, cancel/cache edge cases |
| Gaps | delete/duplicate/inspect/repair/advanced compress; strict page parser; password redaction; engine meta; naming helpers; UI struct |

## 10. Architecture target (post-upgrade)

```
server/src/pdf/
  types.ts, page-selection.ts, output-names.ts, operation-options.ts,
  progress.ts, errors.ts, load.ts, save.ts
  operations/{merge,split,rotate,reorder,extract,delete-pages,
              duplicate-pages,images-to-pdf,pdf-to-images,pdf-to-text,
              ocr,compress,inspect,repair}.ts
server/src/processors/pdf.ts  → thin validate + normalize + dispatch (lazy)
```

`processPdf` remains the sole job entry; capabilities expand; UI groups Organize / Convert / Optimize / Analyze with honest gates.

## 11. Implementation priority (for implementers)

1. Shared page-selection + output naming + error codes + progress tracker (unit tests first).
2. Split ops from monolithic `pdf.ts` with behavior parity, then add missing ops.
3. Engine metadata accuracy in render/compress/repair.
4. Capabilities + password redaction in createJob/jobPublic.
5. Frontend workspace + capability-aware controls + inspect card.
6. Previews (PDF.js if justified) for edit ops.
7. Full tests + docs (ARCHITECTURE / SETUP / TESTING) + regression smoke.

## 12. Audit conclusion

The foundation is solid: worker isolation, validation, lazy loaders, optional binary detection, and core pdf-lib operations. Gaps for production completeness are modular ops structure, missing organize/analyze/optimize operations, accurate engines and naming, stricter page selection, UI completeness, password hygiene, standardized progress/errors, and advanced compression/repair behind real tool capability gates — not fakes.

**Implementation must not begin until this audit file exists on `features/pdftools`.** (This file fulfills that gate.)
