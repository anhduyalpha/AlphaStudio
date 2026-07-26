# Evidence — Unit 1 (A1) Client test harness (Vitest)

- Date: 2026-07-26
- Branch: unit-1-a1-client-test-harness
- Changes: vitest ^4.1.10 (root devDependency, the one permitted new dev dep per SPEC §7.2),
  `vitest.config.js`, `tsconfig.client.json`, `src/tests/harness.test.ts`,
  `test:client` script + extended `typecheck` in package.json, CI "Client tests" step.

## Gate 1 — unit completion commands

### npm run test:client
```
 Test Files  1 passed (1)
      Tests  1 passed (1)
   Duration  340ms
EXIT=0
```

### npm run typecheck (server + new client project)
```
> tsc -p server/tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT=0
```

### npm test (server suite, serial)
```
ℹ tests 709
ℹ suites 226
ℹ pass 708
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ duration_ms 302768.4604
EXIT=0
```

## Gate 2 — deterministic visual checks
```
PENDING token-purity (§4.6) — no target files yet under src\styles (built by units C1+)
PENDING motion-purity (§5.2/§5.3) — no CSS yet under src\styles (built by units C1+/F0)
PENDING contrast (WCAG AA on §4.1 tokens) — src/styles/tokens.css not built yet (unit C1)
EXIT=0
```
All PENDING targets belong to later units (C1+/F0); A1 builds none of them.

## Gate 3 — screenshot capture + diff
First two capture runs failed: `page.goto: Timeout 30000ms exceeded` on the client.
Root cause: `npm install -D vitest` changed package-lock.json, which invalidated
Vite's dep-optimizer cache (`node_modules/.vite`); the one-time cold
re-optimization (react/react-dom/pdfjs-dist) exceeded the 30s page-load timeout.
After the cache rebuilt, capture passes; no pipeline files were modified.
```
[visual:capture] captured=1 missing=268 → visual\captures
[visual:capture] missing targets are pending build units (see report.json), not failures
EXIT=0
[visual:diff] PASS — 0 baseline(s) verified, 1 capture(s) accounted for.
EXIT=0
```
No new baselines: A1 introduces no UI surface (missing=268 are future units' targets).

## Gate 4 — visual judge
Not applicable — zero captures belong to this unit (A1 is harness-only, no UI
surface, no SPEC §4 criteria reference it). Nothing was given to the judge;
nothing was skipped that exists.
