# Unit 21 — E7 Security & Archive hub evidence

## Delivered

- Published config-driven Security and Archive modes in the shared workbench.
- Added capability-aware Security flows for hash, checksum compare, metadata,
  magic-byte signature verification, and secure password generation.
- Added Archive create, extract, and inspect workflows with ZIP, TAR, GZ, and
  capability-gated 7Z output choices.
- Enforced one-file extract/inspect input and one-file GZ creation so extra inputs
  cannot be silently ignored.
- Added a bounded, searchable archive contents tree with explicit empty, loading,
  error, and populated states.
- Preserved resumable uploads, attempt-scoped jobs, retry/cancel/delete actions,
  and workspace output downloads through the canonical controller contract.

## Browser verification

Running frontend: `http://127.0.0.1:4177/#/security`

Running backend: `http://127.0.0.1:8787`

- Selected `sample.txt` and completed all four published digests as `checksums.json`.
- Ran the no-input password generator with 20 characters and symbols, completing
  as `password.json`.
- Selected `sample.png` plus `sample.txt` and completed ZIP creation as `archive.zip`.
- Uploaded a real two-entry ZIP, inspected it as `archive-listing.json`, and rendered
  `sample.png` (70 B) plus `sample.txt` (17 B) in the contents tree.
- Extracted the same ZIP and completed the safe repack as `extracted.zip`.
- Desktop DOM: `scrollWidth=1265`, `clientWidth=1265`, no horizontal overflow.
- Final runtime warning/error log: empty.

Visual capture: `evidence/unit-21-security-archive-desktop.png`.

## Automated verification

- `npm run test:client -- --run`: 26 files, 467 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run visual:checks`: token purity, motion purity, and WCAG AA contrast passed.
- `npm run visual:diff`: passed; one capture accounted for.
- `git diff --check`: passed.
