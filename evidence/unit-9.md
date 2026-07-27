# Unit 9 — C2 primitives: controls and status

## Scope

- Added the rebuild component layer under `src/next/components/`: Button,
  Field, Toggle, Tabs, Card, Skeleton, StatusBadge, EmptyState, Banner, Icon,
  and the shared barrel export.
- Added the token-pure `src/styles/primitives.css`.
- Added structural and server-rendered accessibility tests in
  `src/tests/primitives-controls-status.test.jsx`.
- The pre-rebuild component layer and entrypoint remain untouched.

## Acceptance evidence

- Button: primary/secondary/ghost/danger/icon, sm/md, busy and disabled.
- Field: text/select/textarea/color/range/checkbox; labels, hints,
  `aria-invalid`, `aria-describedby`, and `role="alert"` error copy.
- Tabs: underline/segmented, roving tabindex, ArrowLeft/ArrowRight/Home/End,
  disabled-item skipping, and one shared keyboard handler.
- Toggle: native button switch semantics with selected and disabled states.
- StatusBadge: neutral/live/success/warning/danger, with live polite status.
- EmptyState: default/compact, optional action, opt-in polite live status.
- Banner: neutral/warning with `role="status"`.
- Card: opaque panel/flat variants and optional interactive treatment.
- Skeleton: distinct block/row loading variants with reduced-motion fallback.
- Icon: registry-driven, decorative by default, labelled when meaningful, and
  unknown names fall back to `dashboard`.

## Automated gates

- `npm run test:client` — PASS, 15 files / 314 tests.
- `npm run typecheck` — PASS.
- `npm run build:client` — PASS.
- `npm run visual:checks` — PASS: token purity, motion purity, WCAG contrast.
- `npm run visual:capture` — PASS after the cold Vite transform cache was
  warmed: 1 smoke capture, 268 expected pending targets because D1/D2 have not
  mounted the next shell/gallery contract yet.
- `npm run visual:diff` — PASS: 1 capture accounted for.

## Browser QA

- Chromium console: 0 errors, 0 warnings on the C2 gallery after favicon fix.
- Keyboard-driven tabs: ArrowRight and End changed focus/selection and skipped
  the disabled tab; both underline and segmented variants use the same handler.
- Responsive checks: 375 × 812 portrait and 812 × 375 landscape reported
  `scrollWidth === innerWidth`; no horizontal overflow.
- Visual proofs:
  - `evidence/unit-9-dark.png`
  - `evidence/unit-9-light.png`
  - `evidence/unit-9-states-dark.png`
  - `evidence/unit-9-states-light.png`
  - `evidence/unit-9-mobile.png`

## Independent visual review

The visual judge requested two revision rounds:

1. Add explicit cross-theme state matrices, strengthen skeleton readability,
   improve dark disabled legibility, and preserve danger semantics when pressed.
2. Prevent underline-tab focus clipping and further improve disabled legibility.

After both fixes, the third review found no material visual issues and returned:

`VERDICT: SHIP`

## Independent spec review

The first spec review found four gaps, all covered by regression tests and
production fixes:

- Tabs now normalizes missing, removed, disabled, and asynchronously populated
  selections to the first enabled item, while the all-disabled case has no
  unreachable `tabIndex=0`.
- Interactive Card keeps a native button target separate from header actions,
  avoiding nested buttons and invalid always-emitted block markup.
- Field merges external `aria-describedby` IDs and preserves caller-managed
  `aria-invalid` unless local error state forces `true`.
- The exactly-one rule now targets the tablist implementation itself rather
  than rejecting legitimate keyboard handlers in future primitives.
- Interactive Cards always force a non-interactive `section` wrapper, even
  when an incompatible polymorphic `as="button"` or `as="a"` is requested;
  link-only props are not leaked onto the inner native button.
- The exactly-one structural scan covers every rebuild component when locating
  the sole tablist owner, then limits the keydown assertion to that owner.

The final spec-review pass found no correctness or requirement gaps and
returned:

`VERDICT: SHIP`
