# Unit 15 — E1 Convert hub

## Outcome

The `#/convert` route is now an operational config-driven Workbench. It uses
the protocol store as workspace truth, the upload orchestrator for multipart
and resumable files, detect-derived conversion groups, immutable job attempts,
terminal-event output hydration, scoped cancellation, inline retry/remove
recovery, and single/batch downloads.

## Acceptance evidence

- Hub config: complete normative mode shape with `converter.batch`,
  `buildConvertJobOptions`, files input, server-published quality options, and
  file results. No client format or MIME catalogue.
- Upload: browser uploaded `fixtures/converter/sample.png`; the FileRow became
  `Ready` and Configure changed to `1 detected group`.
- Run/live sync: the UI created a converter job, showed `Running 1 job`,
  exposed scoped Cancel, and the sidebar showed `1 active jobs`.
- Terminal/output: browser live announcement reported
  `sample.webp completed`; after the terminal hydrate fix, Results gained the
  completed row without a manual reload. A second live run proved the same
  path and rendered two completed outputs.
- Single artifact: `GET /api/jobs/<id>/download` returned a 778-byte
  RIFF/WEBP file (`52-49-46-46 ... 57-45-42-50`).
- Batch artifact: the workspace ZIP endpoint returned a 1,250-byte valid ZIP
  containing two non-empty 778-byte WEBP entries.
- Reload: the populated workspace rehydrated with its input and completed
  outputs intact.
- Resume/retry semantics are pinned by the B4 protocol suite and E1 builder
  tests: resumable tasks adopt/continue server sessions, retry requires a new
  client request id and creates a new immutable row.

## Verification

- `npm run test:client -- --run` — 21 files, 414 tests passed.
- `npm run typecheck` — passed.
- `npm run build` — client and server passed.
- `npm run visual:checks` — token purity, motion purity, and contrast passed.
- `git diff --check` — passed.
- Browser runtime log after the final reload — zero new console errors.
- Visual review initially blocked the translucent/over-muted mobile RunBar.
  The bar now uses an opaque surface, avoids double disabled opacity, and
  reserves one RunBar height of mobile scroll space. Re-review: **SHIP**.

## Screenshots

- `evidence/unit-15-convert-desktop.png`
- `evidence/unit-15-convert-mobile.png`

The captures use the live local API and show `Workspace ready` / `Mode ready`.
