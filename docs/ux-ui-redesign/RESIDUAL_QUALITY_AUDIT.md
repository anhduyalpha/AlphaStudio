# Residual Quality Audit (RQ0)

**Branch tip at audit:** `f0e91d1` (`ux-ui-redesign`)  
**Base:** `origin/main` @ `ed460ee`  
**Program:** `residual-quality` (schema v3)  
**Skills:** ux-ui-pro-max, taste (design-taste-frontend)  
**Dials:** VARIANCE 5 · MOTION 4 · DENSITY 6–7  

## Design read

Local-first utility **workbench** (product UI), Linear-style dark-tech, restrained liquid feedback. Not a marketing landing page. Composition shells from corrective C0–C9 are retained; functional depth is the residual program.

## What is verified retained (do not discard)

| Area | Evidence |
|------|----------|
| Studio rail + dashboard command center | Shell/dashboard struct tests; App health probe |
| WorkbenchLayout + WorkspaceHeader + StudioPrimitives | Shared components + CSS |
| Converter conversion board | `conversion-board`, selected group, workspace hydrate |
| PDF document workspace + PdfPageOrganizer | PDF e2e + struct |
| Dedicated views (not Modular wrappers) | App routes Image/Media/Audio/Archive/Text/Color/Security |
| Empty after-corrective screenshots | 66 idle frames under `screenshots/after-corrective/` |

## Functional gaps (code evidence)

| Gap | Verified problem | Residual phase |
|-----|------------------|----------------|
| Audio/Media trim format | Backend trim stream-copies, ignores format; UI still offers format | RQ2 |
| Audio encode controls | Bitrate/sample rate/channels only via quality preset; no target loudness UI | RQ2 |
| Image crop | UI sets `left=0`, `top=0` always | RQ3 |
| Image compare | Job JSON has no `previewUrl`/`outputFileId`; img src on download is fragile | RQ1, RQ3 |
| Color palette | Synthetic hex ladder; Apply is toast; no export | RQ4 |
| Archive browser | Flat entry list; no tree/search/windowing | RQ5 |
| Text diff/export | Token-set compare; weak copy/download | RQ6 |
| Typed results | Generic `JobOutputCard` only | RQ1, RQ7 |
| PDF density | Many form controls; needs op-gated disclosure pass | RQ8 |
| Converter residual | Mobile/batch/result polish | RQ9 |
| Manage routes | Light polish only | RQ10 |
| Liquid fallbacks | Partial reduced-motion; incomplete low-power / no-backdrop matrix | RQ11 |
| Behavioral tests | Regex struct tests dominate | RQ12 |
| Stateful screenshots | Empty only | RQ13 |
| Suite debt | `test:maint` 1 fail on `runtime:prepare` script surface | RQ14 |
| Final report | Stale modular claims | RQ15 |

## Backend contracts to preserve

Processors, upload/resumable, SQLite workspace, SSE/poll/cancel, converter engines, PDF.js lifecycle, capabilities, job create/download/delete.

## Screenshot policy going forward

- Keep `baseline-corrective` and empty `after-corrective` as historical.
- New matrices land under `screenshots/residual-states/` and `screenshots/before-after/`.
- Do not claim route quality scores until RQ12 + RQ13 evidence exists.
