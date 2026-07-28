# Unit 16 — E2 PDF hub

## Outcome

The `#/pdf` route now runs through the shared config-driven Workbench for
Operations and Export. The client consumes the backend-published PDF operation
descriptors, accept lists, capability gates, engine policies, cardinality, and
quality presets; it does not revive a client-side execution catalogue.
Organize is wired to the shared panel boundary for Unit 17.

## Acceptance evidence

- Hub config: Operations declares ordered/selectable file input, the canonical
  PDF job builder, durable results, and a server-derived operation selector.
  Export declares no source input and downloads completed PDF outputs.
- Contract honesty: all 15 published PDF descriptors are parsed fail-closed.
  Unknown option keys disable the mode instead of being silently dropped.
  Optional operations render the backend reason and remain disabled.
- Capability/runtime parity: the runtime supplied a broken `pdftoppm.cmd`
  wrapper that existed on `PATH` but failed for every invocation. The optional
  binary probe now publishes a tool only after a successful process exit.
  `/api/capabilities` consequently reports `pdf.to-images` unavailable instead
  of offering an operation that must fail.
- Ordered input: the browser uploaded `quarterly.report.final.v1.pdf` and
  `text-basic.pdf`, selected both, and exercised Move up. Concurrent upload
  completion is normalized back to the user's input order before selection.
- Merge: the live backend produced
  `quarterly.report.final.v1-merged.pdf` with `engine: pdf-lib`, three pages,
  and two source files.
- Images to PDF: the browser switched to the server-published image accept
  list, selected `sample.png`, and produced `sample-to-pdf.pdf` with
  `engine: pdf-lib+sharp` and one page.
- Options: split, page selection/order, rotation, duplicate insertion,
  structural/advanced quality, image format/DPI, image page layout, OCR
  language/page limit, and engine policy are rendered from descriptor keys.
  Required page operations validate before creating a job.
- Immutable attempts: the builder preserves ordered upload ids in `_uploadIds`;
  Retry accepts only a failed PDF job and generates a new client request id.
- Results/Export: both completed outputs rehydrated into history with source,
  MIME, engine, page, and file metadata. Export exposes per-output download
  plus the primary `Download all PDF outputs` action.
- ZIP artifact: the output ZIP endpoint returned HTTP 200 and a valid
  2,557-byte archive containing `sample-to-pdf.pdf` (1,138 bytes) and
  `quarterly.report.final.v1-merged.pdf` (1,684 bytes).
- Responsive/accessibility: desktop and 390×844 layouts expose semantic tabs,
  labelled controls, checked selection state, disabled first/last reorder
  controls, status announcements, and the sticky run action. Measured document
  width remained within the viewport. Light and dark theme states both render.
- Visual QA found that file-row actions could consume the filename column at
  narrow rail widths. Workbench input actions now occupy their own wrapped row;
  filenames retain the flexible content column.

## Verification

- `npm run test:pdf` — 146 tests passed.
- `npm run test:client -- --run` — 22 files, 428 tests passed.
- `npm run typecheck` — passed.
- `npm run build` — client and server passed.
- `npm run visual:checks` — token purity, motion purity, and WCAG AA token
  contrast passed.
- `npm run visual:diff` — passed.
- `git diff --check` — passed.
- Fresh browser console — zero warnings and zero errors; only Vite connection,
  React development hint, and the expected CSS hot-update debug entry.

## Screenshots

- `evidence/unit-16-pdf-desktop.png`
- `evidence/unit-16-pdf-mobile.png`

Both captures use the live local API. The mobile capture shows the real sticky
RunBar at 390×844; desktop and mobile DOM measurements independently confirmed
there is no horizontal document overflow.
