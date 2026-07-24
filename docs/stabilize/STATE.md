# Stabilization state

**Program:** AlphaStudio stable baseline  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Status:** CP02_TEST_SURFACE_GREEN (not fully product-stable)  
**Last updated:** 2026-07-24  
**Base create SHA:** `ed460ee`  
**Pre-CP02 tip:** `24d108e`

## Declaration

**Not fully product-stable.** CP02 closed the **required test surface, fixtures, and core runtime** gates with multi-run evidence.

## Topology

| Item | Value |
|------|--------|
| main | ed460ee unchanged |
| ux-ui-redesign | preserve |
| stabilize tip | see git after push |

## Checkpoint log

| ID | Summary | HEAD==remote |
|----|---------|--------------|
| CP0 | Process audits | YES |
| CP1 / CP1b | Hygiene + clean-clone + CC-07 | YES |
| CP02 | Test matrix + full suites multi-run green | after push |

## Test surface (required)

| Gate | Status |
|------|--------|
| typecheck / build | green |
| npm test ×2 | 566/566, 0 skip both runs |
| test:maint / hygiene | green |
| test:pdf / fixtures:pdf:verify | green |
| test:python | 15 OK |
| test:e2e ×2 | 4/4 both runs |
| core /api/health | healthy |

Matrix: `docs/stabilize/TEST_MATRIX.md`  
Handoff: `docs/stabilize/handoffs/CP02-test-surface-green.md`

## Repair in CP02

- `rate-limit-absent.test.ts`: remove `data-test-ratelimit` in `after()` (pollution cleanup)

## Residuals (outside this gate)

- Master-plan product CPs (security path, job retry, a11y, full CI)
- GitHub branch protection (ops)

## Exact next action

**CP3** — security: re-confine download/preview paths (S-01) + regression tests; or stand up minimal CI workflow first if process priority wins.
