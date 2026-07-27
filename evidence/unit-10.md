# Unit 10 — C3 primitives: file and flow

## Scope

- Added the rebuild file primitives: Dropzone, FileRow, FileList, and the single
  exported `formatBytes` implementation.
- Added the rebuild flow primitives: ProgressBar, ErrorState, Toast/ToastRegion,
  RunBar, and ResumeStrip.
- Extended `src/styles/primitives.css` with token-driven file, progress,
  recovery, glass, responsive, and reduced-motion treatments.
- Added structural and server-rendered accessibility coverage in
  `src/tests/primitives-file-flow.test.jsx`.
- The pre-rebuild component layer and entrypoint remain untouched.

## Acceptance evidence

- Dropzone: `files`/`paste`, one hidden native file input, keyboard browse,
  empty, hover, focus, drag-over, and disabled states.
- FileRow/FileList: status icon, metadata, progress, actions, selected,
  loading, error, disabled, and designed list-empty states.
- ProgressBar: clamped determinate semantics, indeterminate semantics,
  transform-only progress, silent RunBar aggregate, and static striped reduced
  form.
- ErrorState: persistent `role="alert"` block that refuses to render without a
  visible named recovery action and handler.
- Toast: notice/success/danger inside a persistent polite live region; timer
  durations read from computed `--duration-toast`/`--duration-base`; exit
  completes before internal unmount and callback.
- RunBar: default/loading/disabled states, silent aggregate progress, and the
  exact glass recipe with unsupported/low-power opaque fallback.
- ResumeStrip: full/uploads-only placements, upload Resume/Discard actions,
  active/queued job rows, required owning-workflow links, and
  “Nothing to resume.” empty copy.

## Automated gates

- `npm run test:client` — PASS, 16 files / 342 tests.
- `npm run typecheck` — PASS.
- `npm run build:client` — PASS.
- `npm run visual:checks` — PASS: token purity, motion purity, WCAG contrast.
- `npm run visual:capture` — PASS: 1 smoke capture; 268 gallery targets are
  expected pending D1/D2.
- `npm run visual:diff` — PASS: 1 capture accounted for.

## Browser QA

- Chromium console: 0 errors, 0 warnings.
- Desktop dark/light panel captures at 1280 × 1800: no horizontal overflow.
- Mobile light captures at 375px width: no horizontal overflow.
- Accessibility DOM audit found one inline alert, one persistent polite live
  region, one native file input per rendered Dropzone, and determinate/
  indeterminate progressbar roles without a separately announced RunBar
  aggregate.
- Root `data-motion="reduced"` browser audit: Toast and both indeterminate
  progress examples report `animation-name: none`; Toasts remain fully readable
  and are descendants of the populated polite live region.
- Valid visual proofs are the `unit-10-{dark,light}-{dropzone,files,progress,
  resume,run}.png` and `unit-10-mobile-*.png` files in this directory.

## Independent visual review

The visual judge requested two revision rounds:

1. Replace invalid browser full-page tile captures with short viewport-native
   panel captures and correct narrow-container Dropzone layout.
2. Capture Toasts in their readable steady state and explicitly demonstrate
   the striped reduced-motion ProgressBar form.

After both revisions, the independent review returned:

`VERDICT: SHIP`
