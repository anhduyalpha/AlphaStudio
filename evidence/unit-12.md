# Unit 12 — D1 shell skeleton, router, and hub registry

## Scope

- Added the `VITE_UI=next` client branch while preserving the current client as
  the default.
- Kept the old and rebuild stylesheet graphs mutually exclusive at runtime:
  the legacy branch loads `styles.css` plus `animations/index.css`; the rebuild
  App owns `tokens.css`, `base.css`, and `primitives.css`.
- Added route-only TypeScript stubs for all six future hub configs.
- Added the single hub registry that owns route metadata, navigation order,
  mode order/defaults, and changed legacy redirects.
- Added a minimal rebuild App that exercises hash routing without pre-empting
  D2 shell chrome or later view units.
- Removed the verified no-op device heuristic from the pre-paint motion script;
  the observable default remains `balanced`.

## Route acceptance

- Ten production routes are registered: Home, six hubs, Activity, Settings,
  and Profile.
- `#/assets` resolves only when `includeAssets` is true (the App passes
  `import.meta.env.DEV`); otherwise it resolves to `#/`.
- Hub URLs without `?mode=` select `modes[0]`; valid deep links select the named
  mode; invalid modes canonicalize to the first mode.
- The complete changed-route redirect table is covered:
  dashboard, converter, image, audio, media, archive, developer, qr, color,
  text, and security.
- PDF, Activity, Settings, and Profile remain stable.
- Canonical mode links such as `#/media?mode=audio` bypass the legacy
  mode-less redirect.
- Navigation order is derived directly from the hub registry: Home, six hubs,
  then Activity/Settings/Profile.

## Automated gates

- `npm run test:client -- --run` — PASS, 18 files / 372 tests.
- `npm run typecheck` — PASS.
- Default `npm run build` — PASS, client and server.
- `VITE_UI=next npm run build` — PASS, client and server.
- `npm run visual:checks` — PASS: token purity, motion purity, WCAG contrast.
- `npm run visual:capture` — PASS: 1 smoke capture; 268 gallery targets remain
  assigned to later build units.
- `npm run visual:diff` — PASS: 1 capture accounted for.

## Browser QA

- Ran the rebuild flag on `http://127.0.0.1:4176`.
- Chromium console: 0 errors and 0 warnings from the Unit 12 server.
- The rebuild root computed the new font token grammar and opaque dark
  `--surface`, confirming the legacy token sheet was not loaded into the
  document.
- Clicking PDF kept `#/pdf`, selected Operations (`modes[0]`), and exposed
  both route and mode `aria-current` states.
- Visiting `#/converter` replaced the hash with `#/convert` and rendered the
  Convert stub.
- Visiting mode-less `#/media` replaced the hash with
  `#/media?mode=video`.
- An unknown route replaced the hash with `#/` and rendered Home.
- In the dev server, `#/assets` remained available as Asset Gallery.
- No horizontal overflow at 1280 × 900.

## Visual review

D1 intentionally renders only a route skeleton. PLAN assigns the finished
Sidebar/Topbar/palette composition and Asset Gallery state matrix to D2, so
there is no D1 visual artifact to judge or baseline to accept.

## Independent spec review

Pending.
