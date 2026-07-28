# Unit 25 — Settings + Profile views

## Scope

- Added direct SQLite-backed Settings and Profile views under the transitional `src/next/` namespace.
- Wired both routes into the next client shell.
- Theme and motion retain their permitted browser mirrors.
- Density is persisted by the server and deliberately has no visual semantics or client-side storage key, per the SPEC §8.2 deferred decision.
- Added live Profile preview, validation, reset, loading, error, dirty, and saved states.

## Automated verification

- `npm run test:client -- --run src/tests/settings-profile-view.test.jsx`
  - 1 file passed, 7 tests passed.
- `npm run test:client`
  - 30 files passed, 495 tests passed.
- `npm run typecheck`
  - passed.
- `npm run build`
  - passed; client transformed 149 modules and the server TypeScript build completed.
- `npm run visual:checks`
  - token purity passed across 52 files.
  - motion purity passed across 4 files.
  - WCAG AA token contrast passed.
- `git diff --check`
  - passed.

## Browser verification

- Settings loaded from the live server with `theme=system`, `density=comfortable`, `motion=balanced`, and `defaultQuality=balanced`.
- Changed density to `compact` and default quality to `small`, saved through the UI, and confirmed both values through `GET /api/settings`.
- Restored the original Settings values through the UI and confirmed the server returned to the original state.
- Confirmed the density control is explicitly described as saved-only/inert; the structural test proves no density local-storage key exists.
- Entered `Unit 25 profile preview verification.` in Bio and confirmed the live preview updated before save.
- Saved through the UI, confirmed the value through `GET /api/profile`, then restored the original empty Bio and confirmed the server state.
- Both views stayed within the 1280 px viewport (`documentWidth=1265`) with no horizontal overflow.
- Browser console audit returned no warnings or errors.

## Visual evidence

- `evidence/unit-25-settings-desktop.png`
- `evidence/unit-25-profile-desktop.png`
