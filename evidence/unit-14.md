# Unit 14 — D3 Workbench and panel registry

## Scope

- Added the single config-driven Workbench used by every hub route.
- Rendered the canonical mode → input → configure → run → results flow without
  checking a hub id or name.
- Bound files, upload sessions, jobs, outputs, hydrate/error state, selected
  inputs, and normative batch progress to the protocol store through `useStore`.
- Scoped jobs, failures, progress, and outputs to the current hub+mode resume
  pointer/current-attempt ids; unrelated workspace jobs cannot leak across
  modes, and local-only modes never inherit job progress.
- Kept run-blocking capability/implementation reasons visible in the persistent
  RunBar rather than silently disabling its action.
- Added declarative option rendering for text/select/textarea/toggle/range/color
  and derived values.
- Added the lazy panel registry for all ten normative panel keys. Unknown or
  not-yet-built keys render a persistent ErrorState naming the key.
- Added reference validation for capability ids, accept-list ids, panel keys,
  option builders, and local compute functions.
- Mounted Workbench from App for every hub route; D1 route-only configs render
  honest disabled skeletons until their Track E implementation lands.

## Automated gates

- `npm run test:client` — PASS, 20 files / 403 tests.
- `npm run typecheck` — PASS.
- `VITE_UI=next npm run build:client` — PASS.
- `npm run visual:checks` — PASS: token purity, motion purity, WCAG contrast.
- `git diff --check` — PASS.

## Browser QA

- Ran `#/pdf` in the rebuild client at `http://127.0.0.1:4177`.
- Desktop rendered the normative three-column input/configure/results workspace
  with one sticky RunBar and no horizontal overflow.
- At an exact 1200px viewport the workspace retained all three columns; only
  widths strictly below 1200px collapse the Results region.
- The route-only PDF config exposed all three modes in the registry order and
  named the not-yet-implemented run reason.
- At 390 × 844 the workspace collapsed to one column, retained the pinned
  RunBar, and had no horizontal overflow.
- Chromium console: 0 errors and 0 warnings.

## Visual evidence

- `evidence/unit-14-desktop.png` — three-column PDF workbench.
- `evidence/unit-14-mobile.png` — one-column responsive workbench.

## Independent review

- The first pass found workspace-global job/result leakage and an inclusive
  1200px collapse. Both were fixed with attempt-scoped selectors, a cross-hub
  regression, and strict range breakpoints. Final verdict: `SHIP`.
