# Unit 24 — V2 Activity view evidence

## Delivered

- Replaced the Activity placeholder at `#/activity` with the SQLite-backed
  history manager.
- Added loading, populated, empty, error, refresh, and transient success states.
- Added per-row status, tool identity, detail, timestamp, linked-job reference,
  and a guarded delete action.
- Kept activity history outside the workspace store and read/wrote it only
  through the existing `api/client.js` wrappers.
- Implemented immediate optimistic row removal with exact-position rollback on
  API failure; a refresh reconciles linked-job deletes that may remove multiple
  server rows.
- Added guarded clear-all with optimistic empty state and full rollback if the
  server rejects the request.

## Browser verification

Running frontend: `http://127.0.0.1:4177/#/activity`

Running backend: `http://127.0.0.1:8787`

- Loaded 49 real history records with 24 completed rows, 0 failed rows, and 48
  linked outputs.
- Verified Refresh and Clear history controls plus the populated timeline.
- Created one isolated manual record named `unit-24-browser-row`.
- Deleted only that record through the UI confirmation flow; it disappeared
  immediately, the API succeeded, the count changed from 49 to 48, and the
  persistent success status reported `History entry deleted.`
- Existing job history and generated outputs were left untouched.
- Desktop DOM: `scrollWidth=1265`, `clientWidth=1265`, no horizontal overflow;
  the Activity surface ends at `1232.8` within the viewport.
- Final runtime warning/error log: empty.

Visual capture: `evidence/unit-24-activity-desktop.png`.

## Automated verification

- `npm run test:client -- --run`: 29 files, 488 tests passed.
- Optimistic-delete tests cover exact removal, rollback ordering, preservation
  of newer rows, duplicate-safe rollback, and unknown-row no-op behavior.
- `npm run typecheck`: passed.
- `npm run build`: passed; 147 client modules transformed and server TypeScript compiled.
- `npm run visual:checks`: token purity, motion purity, and WCAG AA contrast passed.
- `npm run visual:diff`: passed; one capture accounted for.
- `git diff --check`: passed.
