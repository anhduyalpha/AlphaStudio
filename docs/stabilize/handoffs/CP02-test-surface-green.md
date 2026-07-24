# Handoff: CP02 — Full test surface, fixtures, core runtime green

**Date:** 2026-07-24  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Base before work:** `24d108e`  
**HEAD after push:** (fill)  
**Local HEAD == remote:** (fill)

## Goal

Discover full test matrix; run required suites green (no weakened asserts); multi-run server + E2E; core health; cleanup regression; process update.

## Matrix

See `docs/stabilize/TEST_MATRIX.md`.

## Suite results (this pass)

| Suite | Result | Evidence |
|-------|--------|----------|
| typecheck | PASS | suite-runs/typecheck.txt |
| build | PASS | suite-runs/build.txt |
| npm test #1 | **566 pass / 0 fail / 0 skip** | suite-runs/npm-test-1.txt |
| npm test #2 | **566 pass / 0 fail / 0 skip** | suite-runs/npm-test-2.txt |
| test:maint | 35 pass | suite-runs/test-maint.txt |
| test:hygiene | 7 pass | suite-runs/test-hygiene.txt |
| test:pdf | 144 pass | suite-runs/test-pdf.txt |
| fixtures:pdf:verify | 8 records | suite-runs/fixtures-pdf-verify.txt |
| test:python | 15 OK | suite-runs/test-python.txt |
| test:e2e #1 | 4 passed | suite-runs/e2e-1.txt |
| test:e2e #2 | 4 passed | suite-runs/e2e-2.txt |
| Core health ×2 | healthy + version 3.6.0 | core-startup-health.txt |

## Repair this checkpoint

| Issue | Root cause | Fix | Regression |
|-------|------------|-----|------------|
| `data-test-ratelimit/` left after suite | `rate-limit-absent.test.ts` after() closed app/DB but did not rm data dir | `after()` rmSync with retries | Focused re-run: dir gone (`rate-limit-cleanup.txt`) |

No assertion softening. No unexplained skips in required suites.

## Cleanup

- After rate-limit test: `data-test-ratelimit` **absent**
- Ports freed after core health double-start
- E2E uses isolated tmp DATA_DIR (playwright.config)

## Explicit non-claims

- Not fully product-stable (security path, job retry honesty, a11y, full CI still open per master plan)
- Branch protection still ops residual

## Next action

**CP3** — security download/preview path confinement (master plan XR-02/S-01) or minimal GitHub Actions if preferred before product security fixes.
