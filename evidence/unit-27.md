# Unit 27 — F2 E2E acceptance gate

## Scope

- Added the single production-build Playwright journey required by SPEC §7.3.
- Added deterministic small, multipart, resumable, corrupt, repaired, restart,
  and reduced-motion fixtures generated inside the test.
- Added browser auditing for console errors, page errors, unexpected request
  failures, and HTTP failures. Only the deliberately interrupted upload/SSE
  requests are allowlisted.
- Added a restartable production server harness so the journey can kill and
  replace Fastify mid-SSE, verify a new epoch, rehydrate state, and continue.
- Made the E2E runner own its API/client services through IPC. This avoids the
  Windows process-tree teardown failure and guarantees a clean exit after the
  test.
- Rendered failed results with an inline ErrorState and Retry action, retained
  the bad-input removal path, and exposed stable job ids for duplicate-result
  assertions.
- Made queued work use the indeterminate RunBar form, including when a queued
  job waits behind a running job.
- Bounded visual capture settling on realtime pages so open SSE connections do
  not force a 30-second `networkidle` timeout per route.

## SPEC §7.3 acceptance journey

1. Cold start rendered Home and all ten Sidebar destinations.
2. All ten production routes rendered in dark and light themes; `#/assets`
   redirected to Home in the production build.
3. Legacy converter, image, developer, and QR hashes canonicalized correctly.
4. A small upload and a >8 MiB resumable upload completed; pause, reload,
   ResumeStrip discovery, and resume all succeeded.
5. A mixed conversion produced two successes and one failure; the failed result
   exposed ErrorState and Retry.
6. Reload during an active job never regressed composed progress.
7. Retry created a new attempt at zero progress; removing the corrupt input and
   supplying the repaired file completed successfully.
8. Single-artifact and batch ZIP downloads passed signature/ZIP validation.
9. Fastify restarted during SSE, emitted a new epoch, rehydrated without
   duplicate/regressed rows, and completed a post-restart streaming job.
10. Reduced motion rendered a static indeterminate queued indicator while job
    state remained visible and advanced.
11. Command-palette search for Audio navigated to Media Studio → Audio.
12. The whole-journey audit ended with zero unexpected console errors, page
    errors, failed requests, or HTTP failures.

## Automated verification

- `npm run test:e2e -- e2e/rebuild-journey.spec.js`
  - `1 passed (2.6m)`
  - production client: `150 modules transformed`
  - the only server warning was the expected recovery of the job deliberately
    interrupted by the restart.
- `npm run test:client`
  - `Test Files 31 passed (31)`
  - `Tests 507 passed (507)`
- `npm run typecheck`
  - passed.
- `npm run build`
  - passed; client and server production builds completed.
- `npm run visual:checks`
  - `PASS token-purity (§4.6) [53 file(s)]`
  - `PASS motion-purity (§5.2/§5.3) [5 file(s)]`
  - `PASS contrast (WCAG AA on §4.1 tokens)`
- `npm run visual:capture`
  - passed; `captured=1 missing=268`.
  - the inherited capture marker remains inactive until the final F1 flip; the
    production E2E screenshot below is the rendered F2 visual artifact.
- `npm run visual:diff`
  - `[visual:diff] PASS — 0 baseline(s) verified, 1 capture(s) accounted for.`
- `git diff --check`
  - passed.

## Visual review

- Verdict: `SHIP`.
- The final production frame is coherent at 1440 × 900: persistent Sidebar,
  compact Topbar, three-column workbench, clear empty states, visible active
  Audio tab, legible dark-theme contrast, and no horizontal overflow.
- No clipped controls, overlapping panels, broken icon geometry, or unreadable
  status/action text was observed.

## Evidence

- `evidence/unit-27-journey.png`
