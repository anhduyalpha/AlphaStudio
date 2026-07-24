# Stabilization state

**Program:** AlphaStudio stable baseline  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Status:** CP04_SECURITY_CI_LINUX_PARITY (not fully product-stable)  
**Last updated:** 2026-07-25  
**Base create SHA:** `ed460ee`  
**Pre-CP04 tip:** `55551b3`

## Declaration

**Not fully product-stable.** CP04 emptied the open P0–P2 security register (fixes + formal boundary), cleared critical/high npm advisories, fixed Linux/Ubuntu CI suite failures, hardened core CI, and captured cleanup/resource evidence.

## Topology

| Item | Value |
|------|--------|
| main | ed460ee unchanged |
| ux-ui-redesign | preserve (+37) |
| stabilize tip | equals origin after CP04 push |

## Checkpoint log

| ID | Summary | HEAD==remote |
|----|---------|--------------|
| CP0 | Process audits | YES |
| CP1 / CP1b | Hygiene + clean-clone + CC-07 | YES |
| CP02 | Test matrix + full suites multi-run green | YES |
| CP03 | Security S-01/S-02, job retry, 7z/json, capability honesty, Docker/CI | YES |
| CP04 | S-04/S-06 + boundary, deps 0 vuln, Linux CI parity, cleanup evidence | (prove after push) |

## Test surface (required)

| Gate | Status |
|------|--------|
| typecheck / build | green |
| npm test | 606/606, 0 skip (Windows); Linux Docker parity green |
| test:maint / hygiene | green |
| npm audit | 0 vulnerabilities |
| cleanup retention tests | green |
| upload bench | acceptance true |

Matrix: `docs/stabilize/TEST_MATRIX.md`  
Handoff: `docs/stabilize/handoffs/CP04-security-ci-linux-parity.md`  
Security boundary: `docs/stabilize/SECURITY_BOUNDARY.md`

## Residuals (outside this gate)

- Frontend a11y P1s (CP6)
- Full Linux host matrix (no WSL user distro)
- VPS multi-user TLS/rate-limit (deploy epic; formal boundary recorded)
- GitHub branch protection (ops — **not** enabled; require `CI / core-ubuntu` green first)
- Tool download SHA integrity (CP5 residual)
- Windows GitHub Actions core job (optional parity)
- Action SHA pinning (tag majors still used)

## Exact next action

**CP6** — frontend a11y P1s (command palette focus trap/names/Escape; drawer/search; motion setting wire or relabel), **or** add optional Windows core CI job if dual-OS remote parity is prioritized first.
