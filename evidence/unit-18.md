# Unit 18 — E4 Media hub + preview/crop evidence

## Delivered

- Replaced the Media Studio stub with executable video, audio, and image mode configs.
- Added a shared-workbench media controller using the canonical contract, upload, store,
  immutable-job, retry, cancel, result-history, and download paths.
- Preserved every legacy operation:
  - video: trim, transcode, extract audio, inspect
  - audio: convert, trim, normalize, inspect
  - image: optimize, resize, crop, rotate, convert, compress, strip metadata
- Capability-gated every operation and derived upload accept rules/quality presets from the
  server contract.
- Added authenticated source preview loading with cancellation and a 256 MB browser-preview
  bound.
- Added `MediaPreviewPanel` with video/audio/image default, loading, error, undecodable, and
  completed-output preview states.
- Added `CropPanel` with pointer selection, numeric fields, centered reset, natural-pixel
  mapping, bounds clamping, and disabled-state guards.
- Kept source/output blob URLs revocable through the existing `useJobPreviewUrl` lifecycle.

## Browser verification

Running frontend: `http://127.0.0.1:4177/#/media?mode=image`

Running backend: `http://127.0.0.1:8787`

- Selected and previewed persisted `sample.png`.
- Optimize completed as `sample.webp`.
- Switched to Crop; natural dimensions and default `1 × 1` crop rendered and the job
  completed.
- Uploaded `fixtures/samples/sample.wav` through the workbench upload path.
- Browser audio preview reported a real 0.10 second duration.
- Audio convert completed as `converted.mp3`; completed output replaced the source player
  through the authenticated job-preview hook.
- Desktop DOM: `innerWidth=1280`, `scrollWidth=1265`, no horizontal overflow.
- Crop overlay present; RunBar remained sticky.
- Fresh browser warning/error log: empty.

Visual capture: `evidence/unit-18-media-crop-desktop.png`.

## Automated verification

- `npm run test:client -- --run`: 24 files, 447 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed.
- `npm run visual:checks`: token purity, motion purity, and WCAG AA contrast passed.
- `npm run visual:diff`: passed; one capture accounted for.
- `git diff --check`: passed.
