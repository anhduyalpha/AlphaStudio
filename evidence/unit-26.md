# Unit 26 — F0 motion system

## Scope

- Added the target `src/styles/motion.css` and loaded it after component/view styles.
- Added a route-keyed entrance boundary so route motion runs only on route mount, never on list/SSE re-renders.
- Implemented functional route, panel, tab-indicator, hover/press, modal/scrim, progress, toast, skeleton, drawer, and dropzone motion with §5.2 tokens.
- Restricted ambient-1 live pulse to `full` mode and disabled it under `data-power="low"`.
- Made `reduced` run zero keyframes while retaining fast interaction transitions and explicit static busy/live/skeleton forms.
- Added token-timed modal exit presence and persistent drawer scrim/drawer transitions so exits complete before unmount/hide.
- Corrected low-power detection to combine save-data with the normative discharging-below-20% battery threshold and clean up listeners.
- Hardened motion purity so multiline transition declarations cannot bypass property or timing-token checks.

## Automated verification

- `npm run test:client -- --run src/tests/motion-system.test.jsx ...`
  - 5 files passed, 90 tests passed.
- `npm run test:client`
  - 31 files passed, 506 tests passed.
- `npm run typecheck`
  - passed.
- `npm run build`
  - passed; client transformed 150 modules and server TypeScript build completed.
- `npm run visual:checks`
  - token purity passed across 53 files.
  - hardened motion purity passed across 5 stylesheets.
  - WCAG AA token contrast passed.
- `git diff --check`
  - passed.

## Browser verification

Computed styles were measured in the live rebuild:

- `balanced`
  - live badge: `animation-name: none`.
  - route entrance: `motion-route-enter`, `0.32s`.
  - active tab panel: `motion-panel-enter`, `0.22s`.
  - indeterminate progress: `progress-bar-slide`, `1.3s`.
  - skeleton: `primitive-skeleton`.
- `full`
  - live badge ambient-1: `primitive-pulse`, `2.6s`, normative ease-in-out curve.
  - functional progress remained active.
- `reduced`
  - inspected up to 1,000 rendered elements and pseudo-elements: zero running/named keyframes.
  - live dot remained visible at opacity 1.
  - indeterminate progress had no animation/transform and rendered the static repeating stripe.
  - skeleton overlay content and animation were removed; base surface remained visible.
- Modal/palette:
  - enter surface/scrim used `0.22s`.
  - close immediately exposed `modal-layer--exit` and `motion-modal-exit` at `0.32s`.
  - modal unmounted only after exit completed.
- Restored the browser/server motion preference to `balanced`.
- Console audit returned no warnings or errors.
- Desktop Asset Gallery ended at `clientWidth=scrollWidth=1265`; an observed 12 px status-code overflow was corrected.

## Visual evidence

- `evidence/unit-26-motion-gallery.png`
