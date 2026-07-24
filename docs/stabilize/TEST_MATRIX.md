# Test matrix — AlphaStudio stabilize

**Branch:** `stabilize/alphastudio-stable-baseline`  
**Recorded at tip:** see STATE (post CP1b `24d108e` + this checkpoint)  
**Not product-stable:** matrix + green runs only prove test surface health.

## Discovery sources

| Source | Observation |
|--------|-------------|
| Root `package.json` scripts | typecheck, build, test, test:pdf, test:e2e, fixtures:pdf*, test:maint, test:hygiene, test:python, doctor |
| `server/package.json` | `test` = `node --import tsx --test --test-concurrency=1 tests/**/*.test.ts` |
| `server/tests/` | 52 `*.test.ts` files |
| `scripts/maint/tests/` | maint-core, package-scripts-hygiene |
| `e2e/` | `pdf-tools.spec.js` + support |
| `playwright.config.js` | Chromium, ports 15173/18787, isolated DATA_DIR |
| `fixtures/pdf/`, `fixtures/samples/` | PDF + sample media |
| `python/tests/` | bridge unittest |
| `.github/` | **absent** |

## Required suites (this checkpoint)

| ID | Command | Fixtures / env | Gate |
|----|---------|----------------|------|
| T1 | `npm run typecheck` | none | required |
| T2 | `npm run build` | none | required |
| T3 | `npm test` (server full, concurrency=1) | fixtures/samples, fixtures/pdf as used; per-test DATA_DIR | required; multi-run ≥2 |
| T4 | `npm run test:maint` | tmp fixtures with spaces/Unicode | required |
| T5 | `npm run test:hygiene` | fixtures/samples, package.json | required |
| T6 | `npm run test:pdf` | fixtures/pdf/* | required |
| T7 | `npm run fixtures:pdf:verify` | fixtures/pdf/manifest.json | required |
| T8 | `npm run test:python` | Python core profile if installable | required or env-skip log |
| T9 | Core start: `node server/dist/index.js` + GET `/api/health` | isolated DATA_DIR/PORT | required |
| T10 | `npm run test:e2e` | Chromium via Playwright | required if browser installable; else honest fail log |

## Suite families (coverage map)

### Server unit / integration (`npm test`)

- API, workers, job lifecycle, workspace SSE/persist, resumable upload
- detect/cache, converter engines, PDF ops, hardening, rate-limit-absent
- UI **structural** tests (`ui-*.test.ts`) reading `src/` sources
- Python engine/pyop (capability-gated)

### Frontend structural / behavioral

- Covered primarily via `server/tests/ui-*.test.ts` (source regex/struct)
- Client build: `npm run build:client`

### Playwright E2E

- `npm run test:e2e` → `scripts/test/run-playwright.mjs`
- Spec: `e2e/pdf-tools.spec.js`

### Maint / hygiene

- `test:maint`, `test:hygiene`
- Scripts under `scripts/maint/*` (doctor, tools, python, db-repair, reset)

### PDF fixtures

- `fixtures:pdf:verify`, `test:pdf`
- Tree: `fixtures/pdf/` + unicode-named PDF

### Python bridge

- `test:python` → `scripts/maint/python.mjs test`
- `python/tests/test_bridge.py`

### DB / workspace / jobs

- Within `npm test`: workers, workspace-*, job-delete-history, pdf-jobs-reliability, live-state

## Known pollution risks

| Risk | Mitigation |
|------|------------|
| Fixed ports in some HTTP tests | Serial `--test-concurrency=1`; cleanup after |
| `data-test-*` dirs | gitignored; tests should rm on after |
| Windows file locks | retry rm; closeDb |
| Shared SQLite | per-test DATA_DIR/DB_PATH |

## Evidence location

`{SCRATCH}/suite-runs/*.txt`, `{SCRATCH}/core-startup-health.txt`, `{SCRATCH}/cleanup-notes.txt`

## Results snapshot (CP02, 2026-07-24)

| Suite | Exit | Notes |
|-------|------|-------|
| typecheck | 0 | |
| build | 0 | client+server |
| npm test #1 | 0 | 566 pass, 0 skip |
| npm test #2 | 0 | 566 pass, 0 skip (multi-run) |
| test:maint | 0 | 35 pass |
| test:hygiene | 0 | 7 pass |
| test:pdf | 0 | 144 pass |
| fixtures:pdf:verify | 0 | 8 records |
| test:python | 0 | 15 OK (bridge, gated profiles) |
| test:e2e #1 / #2 | 0 | 4 passed each (Chromium) |
| core health | OK | status healthy; second bind after kill |
