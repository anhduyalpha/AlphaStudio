# Unit 23 — V1 Home view and ResumeStrip evidence

## Delivered

- Replaced the Home placeholder with the store-backed command center at `#/`.
- Added workspace statistics for jobs run, stored file/output bytes, active jobs,
  and completed jobs.
- Added the full ResumeStrip placement with resumable upload sessions plus
  active/queued jobs, owning hub/mode links, Resume, Discard, and the required
  `Nothing to resume.` empty state.
- Added active-job and recent-job boards with status, relative time, and direct
  links to the owning workflow.
- Derived all six launch tiles and their workflow counts from the hub registry.
- Kept the existing uploads-only ResumeStrip above Dropzone in every file-based
  hub and verified that recovered sessions never become synthetic FileRow items.
- Corrected the desktop shell width so the fixed sidebar no longer pushes the
  main surface beyond the viewport.

## Browser verification

Running frontend: `http://127.0.0.1:4177/#/`

Running backend: `http://127.0.0.1:8787`

- Rendered live workspace values: 24 jobs, 44 KB stored, 0 active, 24 completed.
- Created and paused a real 12 MiB resumable session named
  `unit-23-resume-demo.mp4`.
- Verified the Home full strip at `0 B of 12 MB`, with inline Resume and Discard
  actions and a link to `#/media?mode=video`.
- Followed that link and verified the uploads-only strip renders above the Media
  Studio Dropzone.
- Returned Home, used Discard, and verified the strip immediately returned to
  `Nothing to resume.`; the temporary server session was removed.
- Verified recent completed Utilities and Security jobs link to their owning
  modes and all six registry-backed studio launchers are present.
- Desktop DOM: `scrollWidth=1265`, `clientWidth=1265`; the shell and every major
  Home region end within the viewport (`right <= 1232.8`).
- Final runtime warning/error log: empty.

Visual captures:

- `evidence/unit-23-home-populated.png`
- `evidence/unit-23-home-empty.png`

## Automated verification

- `npm run test:client -- --run`: 28 files, 482 tests passed.
- `npm run typecheck`: passed.
- `npm run build`: passed; 146 client modules transformed and server TypeScript compiled.
- `npm run visual:checks`: token purity, motion purity, and WCAG AA contrast passed.
- `npm run visual:diff`: passed; the Unit 23 capture set was accounted for.
- `git diff --check`: passed.
