# Unit 28 / F1 — flip, deletion, and S3

Date: 2026-07-28
Branch: `unit-28-f1-flip-deletion-s3`

## Shipped target state

- The rebuilt client now boots unconditionally from `src/App.jsx`; `src/next`
  and the `VITE_UI` branch are gone.
- Rebuilt components, hooks, and bespoke views occupy their final §3.1 paths.
- The complete legacy view/component/hook/style deletion set is physically
  absent.
- `api/client.js` is poll-only for job waiting; `protocol/events.ts` is the
  sole event-stream owner.
- `formatBytes` and upload-metric calculation each have one shared
  implementation.
- All client-source structural tests have moved out of `server/tests`;
  obsolete UI structural tests and old-UI Playwright specs are deleted.
- `e2e/rebuild-journey.spec.js` is the only functional browser spec.

## Structural and visual proof

- `src/tests/target-architecture.test.ts`: 16 target-state checks, with both
  transitional exception arrays literally empty.
- Final client suite: 42 files, 594 tests passed.
- Visual policy: token purity, motion purity, and WCAG contrast passed.
- Visual capture: 269 captured, 0 missing, 0 console-error surfaces, maximum
  CLS `0.0022389865`.
- Visual diff: 268 append-only baselines verified, 269 captures accounted for;
  all required interaction states are pixel-distinct.
- Reviewed representative dark/light production routes and primitive/modal
  captures, including:
  `visual/baselines/home--dark.png`,
  `visual/baselines/home--light.png`,
  `visual/baselines/convert--dark.png`,
  `visual/baselines/pdf--light.png`, and
  `visual/baselines/state--modal--dialog--default--dark.png`.

## Verification gates

- `git diff --check` — pass
- `npm run typecheck` — pass
- `npm test` — 445 pass, 0 fail, 1 intentional skip
- `npm run test:client` — 594 pass, 0 fail
- `npm run build` — pass, production client + server
- `npm run visual:checks` — pass
- `npm run visual:capture` — 269 captured, 0 missing
- `npm run visual:diff` — 268 baselines verified, pass
- `npm run test:e2e` — 1/1 full production acceptance journey passed in 3.8m

The E2E journey covered all production routes in both themes, legacy
redirects, multipart and resumable upload, pause/reload/resume, mixed
success/failure conversion, mid-job reload recovery, retry/remove/repair,
single-result download, batch ZIP download, and browser console/network audit.
