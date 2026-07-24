# Stabilization state

**Program:** AlphaStudio stable baseline  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Status:** CP03_SECURITY_JOB_RUNTIME_PLATFORMS (not fully product-stable)  
**Last updated:** 2026-07-24  
**Base create SHA:** `ed460ee`  
**Pre-CP03 tip:** `77c2601`

## Declaration

**Not fully product-stable.** CP03 closed security path/preview confinement, job retry/password honesty, multi-domain scope verification, Core/Full modes, Docker packaging evidence, and minimal CI — with green suite matrix.

## Topology

| Item | Value |
|------|--------|
| main | ed460ee unchanged |
| ux-ui-redesign | preserve (+37) |
| stabilize tip | see git after push |

## Checkpoint log

| ID | Summary | HEAD==remote |
|----|---------|--------------|
| CP0 | Process audits | YES |
| CP1 / CP1b | Hygiene + clean-clone + CC-07 | YES |
| CP02 | Test matrix + full suites multi-run green | YES |
| CP03 | Security S-01/S-02, job retry, 7z/json fixes, scopes, Docker/CI | after push |

## Test surface (required)

| Gate | Status |
|------|--------|
| typecheck / build | green |
| npm test | 587/587, 0 skip |
| test:maint / hygiene | green |
| test:pdf / fixtures:pdf:verify | green |
| test:python | 15 OK |
| Docker health + conversion | healthy + hash job completed |
| core/full capabilities | honest unavailable + full tools OK |

Matrix: `docs/stabilize/TEST_MATRIX.md`  
Handoff: `docs/stabilize/handoffs/CP03-security-job-runtime-platforms.md`

## Residuals (outside this gate)

- Frontend a11y P1s (CP6)
- Color UI stubs / dual OCR capability ids
- Full Linux host matrix (no WSL user distro)
- VPS multi-user TLS/rate-limit (deploy epic)
- GitHub branch protection (ops)
- Tool download SHA integrity (CP5 residual)

## Exact next action

**CP6** — frontend a11y P1s (command palette focus trap/names/Escape; drawer/search; motion setting wire or relabel), **or** residual capability honesty (OCR dual ids / color stubs) if UX is deferred.
