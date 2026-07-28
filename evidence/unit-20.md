# Unit 20 — E6 Text & Dev hub evidence

## Delivered

- Published four config-driven Text & Dev modes: Text, Editor, OCR, and Developer tools.
- Wired Text cleanup, analysis, case conversion, and hashing to the existing server text
  job contract.
- Added a browser-only editor with live word/character/line statistics, case actions,
  copy/export controls, and a bounded line-diff panel.
- Published exactly the eight existing developer utilities: JSON Formatter, Base64
  Encode, Base64 Decode, URL Encode, URL Decode, SHA-256 Hash, Text Cleaner, and UUID
  Generator.
- Added server-backed developer output previews with explicit waiting, loading, error,
  and ready states.
- Capability-gated OCR with the server-provided install/availability explanation and a
  disabled run action when unavailable.

## Browser verification

Running frontend: `http://127.0.0.1:4177/#/text`

Running backend: `http://127.0.0.1:8787`

- Editor input reported 4 words, 24 characters, and 2 lines; comparison input rendered
  one removed and one added line, then produced a completed browser-only analysis.
- JSON Formatter sent inline UTF-8 input to the server, completed as `formatted.json`,
  and rendered the formatted output preview.
- OCR showed the unavailable capability explanation and kept `Run OCR` disabled.
- Uploaded `fixtures/samples/sample.txt`, selected it automatically, and completed Text
  cleanup as `cleaned.txt`.
- Desktop DOM: `scrollWidth=1265`, `clientWidth=1265`, no horizontal overflow.
- Final runtime warning/error log: empty.

Visual capture: `evidence/unit-20-text-dev-desktop.png`.

## Automated verification

- `npm run test:client -- --run`: 25 files, 459 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run visual:checks`: token purity, motion purity, and WCAG AA contrast passed.
- `npm run visual:diff`: passed; one capture accounted for.
- `git diff --check`: passed.
