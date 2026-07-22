# PDF Tools WebUI Audit

**Branch:** `features/pdftools`  
**Date:** 2026-07-21  
**Method:** Source inspection of backend (`server/src/pdf/**`, `capabilities.ts`, processors/routes) + live API smoke on `http://127.0.0.1:8787` + Playwright WebUI on `http://localhost:5173/#/pdf` (Vite proxy).  
**Rule:** This audit was written from inspection **before** WebUI behavior fixes.

## Environment (live probe)

| Check | Result |
|-------|--------|
| Branch | `features/pdftools` |
| Health | `GET /api/health` → healthy (via direct API and Vite proxy) |
| Capabilities | `GET /api/capabilities` → full `pdf.*` set |
| Upload | `POST /api/uploads` → 201 |
| Jobs | `POST /api/jobs` type=`pdf` + poll → works |
| SSE | Covered by `server/tests/pdf-api-jobs.test.ts` |
| External tools (this machine) | **Missing / unavailable:** Ghostscript, qpdf, pdftoppm/mutool rasterizer stack, Tesseract OCR. **Available:** pdf-lib, sharp, pdftotext |

Live capability snapshot (2026-07-21):

| Capability | Available | Engine |
|------------|-----------|--------|
| pdf.merge / split / rotate / reorder / extract / delete-pages / duplicate-pages | yes | pdf-lib |
| pdf.from-images | yes | pdf-lib+sharp |
| pdf.to-text | yes | pdftotext |
| pdf.compress / pdf.compress.structural | yes | pdf-lib |
| pdf.inspect | yes | pdf-lib |
| pdf.compress.advanced | **no** | needs Ghostscript or qpdf |
| pdf.to-images | **no** | needs pdftoppm / mutool / Ghostscript |
| pdf.ocr | **no** | needs Tesseract + rasterizer |
| pdf.ocr.searchable | **no** | not implemented (always false) |
| pdf.repair | **no** | needs qpdf or Ghostscript |
| pdf.decrypt | **no** | needs qpdf; **no operation handler** even when qpdf present |

---

## 1. PDF operations implemented by the backend

Registered in `server/src/pdf/index.ts` loaders:

| Op ID | Capability ID | Inputs | Key options | Output |
|-------|---------------|--------|-------------|--------|
| `merge` | pdf.merge | ≥1 PDF (typically ≥2) | order of uploadIds | PDF |
| `split` | pdf.split | 1 PDF | splitMode, pages, everyN, groups | PDF or ZIP |
| `rotate` | pdf.rotate | 1 PDF | pages, angle | PDF |
| `reorder` | pdf.reorder | 1 PDF | order/pages, allowDuplicates | PDF |
| `extract` | pdf.extract | 1 PDF | pages (required) | PDF |
| `delete-pages` | pdf.delete-pages | 1 PDF | pages (required; cannot delete all) | PDF |
| `duplicate-pages` | pdf.duplicate-pages | 1 PDF | pages, insertAt | PDF |
| `from-images` | pdf.from-images | ≥1 image | pageSize, orientation, fit, margin | PDF |
| `to-images` | pdf.to-images | 1 PDF | pages, format, quality, dpi | image or ZIP |
| `to-text` / `extract-text` | pdf.to-text | 1 PDF | ocr, ocrLang, ocrPageLimit | TXT |
| `ocr` | pdf.ocr | 1 PDF | ocrLang, pages, ocrPageLimit | TXT |
| `compress` / `compress-structural` | pdf.compress.structural | 1 PDF | quality (structural) | PDF |
| `compress-advanced` | pdf.compress.advanced | 1 PDF | quality, compressMode | PDF |
| `inspect` | pdf.inspect | 1 PDF | password (redacted) | JSON |
| `repair` | pdf.repair | 1 PDF | — | PDF |

**Not implemented as a handler:** `decrypt` — capability `pdf.decrypt` exists for gating/docs, but `getPdfOperation('decrypt')` returns null → `Unknown PDF operation: decrypt` (confirmed via live API).

Options normalized in `server/src/pdf/operation-options.ts` (angle, format, quality, dpi, ocr*, compressMode, splitMode, everyN, groups, allowDuplicates, insertAt, pageSize, orientation, fit, marginPt, password, searchablePdf).

---

## 2. PDF operations currently visible in the WebUI

`src/views/PdfView.jsx` GROUPS catalog:

| Group | Visible ops |
|-------|-------------|
| Organize | merge, split, reorder, rotate, extract, delete-pages, duplicate-pages |
| Convert | from-images, to-images, to-text |
| Optimize | compress-structural, compress-advanced, repair |
| Analyze | inspect, ocr |

**Not visible:** `decrypt`, `pdf.ocr.searchable`, legacy alias-only `compress` (UI uses compress-structural / compress-advanced).

---

## 3. Operations missing from the WebUI

| Operation | Backend | Notes |
|-----------|---------|-------|
| decrypt | Capability only; **no op handler** | Deferred — must not ship as a working control |
| searchable OCR | Capability always unavailable | Correctly omitted |
| Legacy `compress` op id | Maps to structural | Covered by compress-structural |

---

## 4. UI controls that exist but do not send the correct backend options

| Issue | Detail |
|-------|--------|
| **Stale result card** | `displayJob = job \|\| lastOutput`. `run()` sets `job=null` at start, so previous completed job remains visible with **Download**. Progress/completion of the *new* job is obscured; automation and users can think the old output is the new result. |
| **Inspect panel timing** | Inspect meta is stored when job completes, but files are cleared; panel depends on `operation === 'inspect'`. Switching ops hides inspect data even though lastOutput remains. |
| **Structural quality** | UI always sends `quality` for structural compress; backend accepts it but structural mode is mostly quality-agnostic (low risk). |
| **Split groups** | Sent as a single semicolon string — **correct** (backend splits). |
| **Rotate empty pages** | Empty pages → backend `parsePageSelection` treats as all pages — OK, but UI still shows optional pages field without clarifying default=all. |

No wrong option *key names* found for the core path (operation, pages, order, angle, format, quality, splitMode, everyN, groups, ocr, ocrLang, pageSize, fit, margin, allowDuplicates, insertAt, compressMode) relative to `normalizePdfOptions`.

---

## 5. Backend options that have no corresponding UI controls

| Option | Ops | Severity |
|--------|-----|----------|
| `orientation` | from-images | Medium — backend supports auto/portrait/landscape |
| `dpi` | to-images (and OCR path) | Medium when to-images available |
| `ocrPageLimit` / `maxOcrPages` | to-text / ocr | Low — server default 50 |
| `password` | inspect / future decrypt | Low on this machine (no qpdf); needed for encrypted inspect |
| `searchablePdf` | ocr | N/A — searchable OCR unavailable |
| File **reorder** for multi-PDF merge | merge | Medium — upload order is merge order; FilePicker only allows remove, not reorder |

---

## 6. Capabilities incorrectly hidden

None for end-user ops that are available on this machine. All bundled ops appear in GROUPS.

---

## 7. Capabilities incorrectly shown as available

| Issue | Detail |
|-------|--------|
| Optional ops in `<option>` | Gated ops (to-images, ocr, compress-advanced, repair) are listed. Buttons disable when `isAvailable === false`. **Race:** before capabilities load, `isAvailable` is `null`, so options are **not** `disabled` and buttons are not “Unavailable”. After load, buttons gate correctly (Playwright confirmed). Option labels may not always show “(unavailable)” if render races. |
| **decrypt** | Not shown (good). If it were shown when qpdf appears, job would still fail (no handler). |

---

## 8. Operations showing the wrong engine

| Path | Assessment |
|------|------------|
| Sidebar engine | Uses `job.meta.engine` when present, else capability engine via `expectedEngine` — **correct design**. |
| Stale job card | After a new run starts, old job meta can still drive UI until new job arrives (see §4). Playwright saw `pdf-lib+sharp` linger after switching away from from-images because of lastOutput. |
| JobOutputCard | Does **not** display engine or pageCount at all — only filename + status + Download. |

---

## 9. Operations with incomplete progress reporting

| Area | Assessment |
|------|------------|
| Upload band | useJobRunner maps upload progress to 0–30% — OK |
| Job band | Maps server progress to 30–99% — OK |
| Stage text | `status` shows `job.message` — OK when SSE/poll works |
| **Busy + lastOutput** | Progress % updates, but Result card still says **completed** for the previous job — **misleading** |
| SSE | Client prefers EventSource `/api/jobs/:id/events`, falls back to poll |

---

## 10. Operations that produce a result but do not display or download it

| Issue | Detail |
|-------|--------|
| Download | JobOutputCard download works when `job.downloadUrl` present (confirmed inspect). |
| Meta in card | pageCount / engine / warnings **not shown** on JobOutputCard. |
| Export tab | Mostly a placeholder (“Last output”); actual download lives in always-mounted JobOutputCard below tabs. |
| Inspect | JSON downloadable; on-page inspect summary works when still on Inspect op after completion. |

---

## 11. Operations that fail only after submitting

| Case | Client pre-check | Server |
|------|------------------|--------|
| delete all pages | **No** client block | Fails: `Cannot delete all pages...` |
| merge with 1 file | Allows (≥1) | Succeeds as single-PDF copy — may surprise users expecting ≥2 |
| extract / delete / duplicate without pages | Client blocks extract/delete/duplicate | Server also validates |
| reorder without order | Client blocks | Server validates |
| Optional tool ops | Button disabled when caps known | 503 UNAVAILABLE if forced |
| decrypt (API only) | N/A in UI | Unknown operation |

Playwright: empty extract pages → toast `Page selection is required for this operation` — **works**.

---

## 12. Broken preview or thumbnail behavior

| Check | Result |
|-------|--------|
| PdfPageOrganizer on Preview tab | Present for reorder/rotate/extract/delete/duplicate |
| pdfjs-dist | Dependency present; thumbs render with PREVIEW_PAGE_LIMIT=40 |
| Full-PDF base64 | Not uploaded — plan is page indices only |
| Playwright preview | Organizer visible, no “Preview failed” on 4-page sample |

Residual risk: large PDFs may be slow client-side; limit mitigates.

---

## 13. Browser console errors

Playwright session: **0** page errors / console errors during exercised ops. Only Vite HMR debug and React DevTools info.

---

## 14. Network request failures

| Path | Result |
|------|--------|
| `/api/health`, `/api/capabilities` via Vite proxy | 200 |
| `/api/uploads` | 200/201 |
| `/api/jobs` for available ops | 201 → completed |
| Optional ops if forced | 503 (capability) — correct |
| CORS | Same-origin proxy — none observed |

---

## 15. State persistence and reload problems

| Feature | Assessment |
|---------|------------|
| sessionStorage `alphastudio.pdf.activeJobId` | PdfView opts into auto-resume with expectedJobType=`pdf` |
| Resume tests | `server/tests/ui-job-resume.test.ts` |
| After success | Files cleared (`setFiles([])`) — intentional; re-select required |
| lastOutput | Survives op switch (good) but **not cleared on new run** (bad — §4) |

---

## 16. Responsive-layout problems

| Issue | Severity |
|-------|----------|
| Workspace grid + sticky sidebar | Generally OK on desktop |
| Page organizer grid | CSS-in-JS minmax 96px — usable |
| Mobile sidebar / narrow forms | Not exhaustively tested; non-blocking polish |

---

## 17. Accessibility problems

| Issue | Severity |
|-------|----------|
| Toast validation messages | Visible but may not be announced reliably (depends on global toast) |
| Result card | `aria-live="polite"` present on JobOutputCard |
| Select disabled options | Good when caps loaded |
| File reorder for merge | No keyboard reorder affordance |
| Preview drag-reorder | Mouse drag only |

---

## 18. Operation matrix

```text
Operation | Backend implemented | UI visible | Request correct | Result usable | Status | Required fix
----------|---------------------|------------|-----------------|---------------|--------|-------------
merge | yes | yes | yes (upload order + reorder UI) | yes | FIXED | Stale card cleared; ≥2 files validated; file reorder arrows
split (every-page/ranges/every-n/groups) | yes | yes | yes | yes | FIXED | Ranges/groups client validation; stale card cleared
rotate | yes | yes | yes | yes | FIXED | Empty pages label clarifies all; stale card cleared
reorder | yes | yes | yes | yes | FIXED | Preview organizer + allowDuplicates
extract | yes | yes | yes | yes | FIXED | Pages required; meta on card
delete-pages | yes | yes | yes | yes | FIXED | Client block delete-all (all / 1-N); stale card cleared
duplicate-pages | yes | yes | yes (insertAt) | yes | FIXED | insertAt wired
from-images | yes | yes | yes | yes | FIXED | orientation + pageSize + fit + margin
to-images | yes (gated) | yes | yes (dpi/format/quality) | n/a here | FIXED-GATE | DPI control; button/option gated when rasterizer missing
to-text | yes | yes | yes (ocr toggle) | yes | FIXED | OCR toggle + lang
ocr | yes (gated) | yes | yes (lang) | n/a here | OK-GATE | Button Unavailable when no stack
compress-structural | yes | yes | yes | yes | FIXED | compressMode structural; engine on result card
compress-advanced | yes (gated) | yes | yes | n/a here | OK-GATE | Button Unavailable without gs/qpdf
inspect | yes | yes | yes | yes | FIXED | Meta on card; inspect panel retained; Export summary
repair | yes (gated) | yes | yes | n/a here | OK-GATE | Button Unavailable without tools
decrypt | capability only, no handler | no | n/a | n/a | DEFERRED | Not exposed; capability remains for honesty
pdf.ocr.searchable | unavailable | no | n/a | n/a | OK | Intentionally omitted
```

**Post-fix (2026-07-21):** P0/P1 items implemented in `PdfView.jsx`, `JobOutputCard.jsx`, `FilePicker.jsx`, `src/lib/pdfJobOptions.js`. Unit tests: `server/tests/pdf-webui-options.test.ts`, extended `ui-pdf-struct.test.ts`.

---

## API exercise summary (UI-shaped options)

Live `POST /api/jobs` (same option keys as PdfView builder):

| Op | Status |
|----|--------|
| merge, split×4, rotate, reorder, extract, delete-pages, duplicate-pages, from-images, to-text, inspect, compress-structural | completed |
| delete-all pages | failed (expected message) |
| to-images, ocr, compress-advanced, repair | 503 UNAVAILABLE (expected) |
| decrypt | failed Unknown PDF operation |

---

## Playwright WebUI summary (pre-fix)

- PDF Studio route `#/pdf` loads; categories Organize/Convert/Optimize/Analyze present.
- Capability-gated ops: **Process** button shows **Unavailable** and is disabled for to-images, ocr, repair, compress-advanced.
- Extract empty pages: client toast blocks submit.
- Preview: Page organizer renders.
- Export: “Last output” copy exists; download is via shared JobOutputCard.
- Console: no errors.
- **Critical:** Result card not cleared when starting a new job (`lastOutput` retention bug).

---

## Required fix list (priority) — status after repair

1. **P0** — Clear `lastOutput` when starting; while `busy` show only in-flight job — **DONE**
2. **P0** — JobOutputCard surfaces engine / pages / meta — **DONE**
3. **P1** — `orientation` + `dpi` controls via `buildPdfJobOptions` — **DONE**
4. **P1** — Client validation (merge ≥2, ranges, delete-all, pages) — **DONE**
5. **P1** — FilePicker reorder for merge/from-images — **DONE**
6. **P1** — Gated options show `(unavailable)`; no decrypt UI — **DONE**
7. **P2** — Export tab summary with filename/engine/pages — **DONE**
8. **P2** — a11y/responsive polish — residual (non-blocking)

---

## Explicit non-goals / deferred

- Implementing full **decrypt** operation (qpdf) — capability remains for honesty; UI stays free of fake controls.
- Installing system Ghostscript/qpdf/Tesseract in CI — gating must remain correct without them.
- Visual redesign of PDF Studio.
- Searchable OCR product path (`pdf.ocr.searchable`).

---

## Evidence locations (local harness)

- `{SCRATCH}/branch-state.txt`
- `{SCRATCH}/api-smoke-*.json`
- `{SCRATCH}/webui-ops-api-matrix.json`
- `{SCRATCH}/webui-ops-log.md`
- `{SCRATCH}/webui-browser-log.json`
- Screenshots: `webui-after-inspect.png`, `webui-preview.png`, `webui-export.png`
