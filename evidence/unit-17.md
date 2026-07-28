# Unit 17 — E3 PdfOrganizerPanel evidence

## Delivered

- Added the lazily registered `PdfOrganizerPanel`.
- Derived reorder, rotate, extract, delete-pages, and duplicate-pages choices from the live
  server operation contract and capability gates.
- Kept authenticated file reads, workspace state, and job submission in
  `usePdfWorkbench`; the panel imports no API/protocol/store modules.
- Added abortable preview file reads with a 32 MB preflight limit.
- Added bounded PDF.js parsing and thumbnails:
  - 200-page document limit
  - 12-page render window
  - 2 concurrent renders
  - loading/render cancellation and document destruction on invalidation
- Added manual page/order entry, thumbnail selection, drag/keyboard reorder, global rotate
  angle, paging, retry/error/limited states, and delete-all protection.
- Added responsive token-only workbench styling and platform-independent registry source
  assertion.

## Browser verification

Running frontend: `http://127.0.0.1:4177/#/pdf?mode=organize`

Running backend: `http://127.0.0.1:8787`

Verified with a persisted two-page `text-basic.pdf` workspace input:

- PDF.js loaded two real thumbnails.
- Reorder page 2 before page 1 published `2,1` and completed
  `text-basic-reordered.pdf` with two pages.
- Rotate selected page 1 at 180° completed `text-basic-rotated.pdf`.
- Duplicate selected page 1 completed `text-basic-pages-duplicated.pdf` with three pages.
- Delete-pages with all two pages selected disabled the apply-selection action and displayed
  “Keep at least one page in the PDF.”
- Completed outputs persisted in Results after each immutable job attempt.
- Desktop DOM: `innerWidth=1280`, `scrollWidth=1265`, no horizontal overflow.
- RunBar remained `position: sticky` at `bottom: 12px`.
- Fresh browser warning/error log: empty.

Visual capture: `evidence/unit-17-pdf-organizer-desktop.png`.

## Automated verification

- `npm run test:client -- --run`: 23 files, 436 tests passed.
- `npm run test:pdf`: 146 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run visual:checks`: token purity, motion purity, and WCAG AA contrast passed.
- `npm run visual:diff`: passed; one capture accounted for.
- `git diff --check`: passed.
