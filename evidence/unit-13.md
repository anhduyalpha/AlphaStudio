# Unit 13 — D2 shell chrome and Asset Gallery

## Scope

- Composed the rebuild shell from the production Sidebar, Topbar, and
  CommandPalette primitives.
- Derived both navigation surfaces from the one hub registry, including every
  hub mode in command search.
- Connected the Sidebar active-job badge to the protocol store.
- Added a first-focusable skip link, route-change focus to the Topbar `h1`, and
  one shell-owned visually-hidden polite live region for completed/failed jobs.
- Prevented the skip link's `#main-content` fragment from colliding with the
  hash router; activation preserves the route and focuses `<main>` directly.
- Kept `#/assets` development-only and outside production navigation.
- Added the complete §4.4 primitive state matrix and real dialog/palette
  launchers to Asset Gallery.
- Added responsive shell/view composition without adding new design constants.

## Automated gates

- `npm run test:client` — PASS, 19 files / 389 tests.
- `npm run typecheck` — PASS.
- `VITE_UI=next npm run build:client` — PASS.
- `npm run visual:checks` — PASS: token purity, motion purity, WCAG contrast.
- `npm run visual:capture` — PASS: 1 configured smoke target captured; the
  remaining visual manifest targets stay assigned to their later build units.
- `git diff --check` — PASS.

## Browser QA

- Ran the rebuild client at `http://127.0.0.1:4177/#/assets`.
- Chromium console: 0 errors and 0 warnings.
- Ctrl+K opened the named Search AlphaStudio dialog with one selected result;
  an `Audio` query returned mode results.
- Dark and light themes rendered without horizontal overflow at 1440 × 900.
- At 390 × 844 the page had no horizontal overflow and collapsed to the mobile
  shell.
- The mobile Sidebar opened as an `aria-modal` dialog and moved focus to its
  Close navigation button.
- The mobile Search control keeps its icon visible after responsive copy is
  hidden.
- Disabled primary actions use the neutral surface treatment while busy
  primary actions retain their progress emphasis.

## Visual evidence

- `evidence/unit-13-dark.png` — desktop dark shell and top of the matrix.
- `evidence/unit-13-light.png` — desktop light parity.
- `evidence/unit-13-mobile.png` — mobile content reflow.
- `evidence/unit-13-drawer.png` — mobile drawer, scrim, and focus target.

## Reviews

- Independent specification review found the skip-link/hash-router collision.
  The link now prevents fragment navigation, focuses `<main>` directly, and has
  a route-preservation regression test. Final verdict: `SHIP`.
- Independent visual review found the hidden mobile Search icon and an
  over-emphasized disabled primary action. Both treatments were corrected and
  the refreshed dark/light/mobile/drawer evidence received final verdict:
  `SHIP`.
