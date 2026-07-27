# Unit 11 — C4 primitives: overlay and chrome

## Scope

- Added the rebuild overlay primitives: Modal and CommandPalette.
- Added the rebuild chrome primitives: Sidebar and Topbar.
- Added the single shared `useFocusTrap` hook consumed by Modal and the mobile
  Sidebar drawer.
- Extended `src/styles/primitives.css` with token-driven overlay, palette,
  sidebar, topbar, skip-link, responsive, low-power fallback, and
  reduced-motion treatments.
- Added structural and server-rendered accessibility coverage in
  `src/tests/primitives-overlay-chrome.test.jsx`.
- The pre-rebuild component layer and entrypoint remain untouched.

## Acceptance evidence

- Modal: named dialog semantics, initial focus, cyclic focus trap, Escape close,
  scrim close, busy-state close protection, focus restoration, actions, and
  dialog/palette variants.
- CommandPalette: searches both hubs and modes, renders a named listbox with
  roving option focus, supports ArrowUp/ArrowDown/Home/End, exposes a designed
  empty state, and returns the selected internal workflow href.
- Sidebar: registry-driven grouped navigation, `aria-current` route state,
  active-job status, branded chrome, opaque desktop treatment, and a responsive
  glass drawer using the shared focus trap.
- Topbar: skip link before all chrome controls, route heading, mobile menu,
  command search, API status, theme control, and profile link.
- Glass is limited to the dialog, command palette, and mobile drawer; opaque
  fallbacks apply when backdrop filtering is unsupported or low-power mode is
  selected.

## Automated gates

- `npm run test:client -- --run` — PASS, 17 files / 355 tests.
- `npm run typecheck` — PASS.
- `npm run build:client` — PASS.
- `npm run visual:checks` — PASS: token purity, motion purity, WCAG contrast.

## Browser QA

- Chromium console: 0 application errors, 0 application warnings.
- Desktop dark/light chrome, modal, palette, and empty-state captures at
  1280 × 900: no horizontal overflow.
- Mobile drawer capture at 375 × 812: no horizontal overflow.
- The skip link is the first focusable element in document order.
- Modal initial focus lands on “Export 3 files”; Tab wraps to “Close dialog”;
  Shift+Tab wraps back; Escape removes the dialog and reveals “Open dialog”.
- Palette search for “audio” leaves exactly one “Audio — Media Studio” option;
  ArrowDown moves DOM focus to the selected option; activation reports
  `#/media?mode=audio`.
- Mobile drawer is a named modal dialog, initially focuses “Close navigation”,
  and exposes the current Media Studio route plus the live active-job count.
- Root `data-motion="reduced"` reports no modal/scrim animation and `0s`
  transition durations for modal and sidebar.
- Visual proofs are the `unit-11-{dark,light}-{chrome,modal,palette,empty}.png`
  files and `unit-11-mobile-drawer.png` in this directory.

## Independent reviews

Pending visual and specification review.
