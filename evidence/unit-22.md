# Unit 22 — E8 Utilities hub evidence

## Delivered

- Published config-driven QR and Color modes in the shared workbench.
- Added QR generation and image decoding with capability-aware PNG/SVG, size,
  margin, error-correction, and foreground/background controls.
- Routed pasted QR images through the same validated upload path as browsed files.
- Added a browser-native Color Lab for picking colors, generating palettes,
  checking WCAG contrast, building gradients, and extracting palettes from real
  image pixels.
- Demonstrated the required dual execution shape: Color Lab computations run
  locally while optional image optimization and metadata stripping run as
  capability-gated Sharp jobs.
- Preserved resumable uploads, attempt-scoped jobs, retry/cancel/delete actions,
  workspace output downloads, and the canonical controller contract.

## Browser verification

Running frontend: `http://127.0.0.1:4177/#/utilities`

Running backend: `http://127.0.0.1:8787`

- Generated `qrcode.png` for `https://alphastudio.local/unit-22`.
- Uploaded that generated PNG through the QR paste/browse surface and decoded the
  exact original URL into `qr-decode.json`.
- Verified the default picker value as RGB `155, 124, 255`.
- Verified the browser-only contrast workflow at `16.80:1`, with AA and AAA body
  text checks passing, then saved the local JSON result.
- Extracted a six-color palette from the generated QR image's real browser pixels.
- Ran the optional Sharp `Optimize image` job and completed the PNG output.
- Desktop DOM: `scrollWidth=1265`, `clientWidth=1265`, no horizontal overflow.
- Final runtime warning/error log: empty.

Visual capture: `evidence/unit-22-utilities-desktop.png`.

## Automated verification

- `npm run test:client -- --run`: 27 files, 476 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run visual:checks`: token purity, motion purity, and WCAG AA contrast passed.
- `npm run visual:diff`: passed; one capture accounted for.
- `git diff --check`: passed.
