# Unit 15 — E1 Convert hub

## Outcome

The `#/convert` route is now an operational config-driven Workbench. It uses
the protocol store as workspace and SSE truth, the upload orchestrator for
multipart and resumable files, detect-derived conversion groups, immutable job
attempts, terminal-event output hydration, scoped cancellation, explicit safe
recovery, and single/current-batch/all/selected downloads.

## Acceptance evidence

- Hub config: complete normative mode shape with `converter.batch`,
  `buildConvertJobOptions`, files input, server-published quality options, and
  file results. No client format or MIME catalogue.
- Upload: browser uploaded `fixtures/converter/sample.png`; the FileRow became
  `Ready` and Configure changed to `1 detected group`.
- Run/live sync: the UI created a converter job, showed `Running 1 job`,
  exposed scoped Cancel, and the sidebar showed `1 active jobs`.
- Batch board: browser exercised `Select group` → `Convert selected`; the
  selected checkbox, selected count, and action state updated before the new
  immutable attempt completed. Group/all/selected runs use only server-detected
  targets and server-published quality defaults.
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
- Results parity: durable history now exposes status/format/sort filters,
  per-row selection, download selected/all/current batch, clear/show completed,
  retry-all, and individual Retry/Remove actions. Current-attempt progress,
  cancellation, and ZIP scope stay separate from history.
- Recovery: generic result removal deletes only that job. The explicit
  `Remove bad input` action is shown only for one-input failures and deletes
  the bad source plus its related failed attempts, never unrelated batch
  inputs.
- Resume/retry semantics are pinned by the B4 protocol suite and E1 builder
  tests: resumable tasks expose real Pause and adopt/continue server sessions;
  retry requires a new client request id and creates a new immutable row.
- Capability gaps fail closed: mode and per-target server reasons render
  through the shared warning Banner, all run controls disable, and no
  client-invented engine, format, or quality fallback is displayed/submitted.

## Verification

- `npm run test:client -- --run` — 21 files, 415 tests passed.
- `npm run typecheck` — passed.
- `npm run build:client` with `VITE_UI=next` and the default legacy flag —
  both passed; `npm run build:server` passed.
- `npm run visual:checks` — token purity, motion purity, and contrast passed.
- `npm run visual:diff` — passed.
- `git diff --check` — passed.
- Browser console after clean final reload — zero warnings and zero errors.
- Visual review initially blocked the translucent/over-muted mobile RunBar.
  The bar now uses an opaque surface, avoids double disabled opacity, and
  reserves one RunBar height of mobile scroll space. Re-review: **SHIP**.

## Screenshots

- `evidence/unit-15-convert-desktop.png`
- `evidence/unit-15-convert-mobile.png`

The viewport captures use the live local API and show `Workspace ready` /
`Mode ready`; desktop was also checked for horizontal overflow after the
Results rail density fix. The mobile evidence is a three-viewport contact
sheet covering Input, Configure, Results, and the sticky RunBar.
