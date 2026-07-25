# Stabilization state

**Program:** AlphaStudio stable baseline  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Status:** FINAL_CLOSEOUT — local baseline ready for user-approved merge  
**Last updated:** 2026-07-25  
**Base create SHA:** `ed460ee`  
**Pre-closeout tip:** `9b9bf43` (CP04 pin)

## Declaration

**Local single-user stabilize baseline is ready for user-approved merge prep.**  
Open P0–P2 register emptied for this threat model (code fixes + formal security boundary).  
**Not** VPS/multi-user/public-internet ready. **Do not** merge or tag without explicit user approval.

## Topology

| Item | Value |
|------|--------|
| main | ed460ee unchanged until approved merge |
| ux-ui-redesign | preserve (+37) until approved merge |
| stabilize tip | equals origin after closeout push |

## Checkpoint log

| ID | Summary | HEAD==remote |
|----|---------|--------------|
| CP0 | Process audits | YES |
| CP1 / CP1b | Hygiene + clean-clone + CC-07 | YES |
| CP02 | Test matrix + full suites multi-run green | YES |
| CP03 | Security S-01/S-02, job retry, 7z/json, capability honesty, Docker/CI | YES |
| CP04 | S-04/S-06 + boundary, deps, Linux CI parity | YES (`cb01099` + CI 30118515153; pin `9b9bf43` + CI 30118714453) |
| CP06 | A11y P1s, backup/rollback drill, Docker DB_PATH, archiver8 audit 0, final report | after push |

## Test surface (required)

| Gate | Status |
|------|--------|
| typecheck / build | green |
| npm test | 613/613, 0 skip |
| test:maint / hygiene | green (backup test included) |
| npm audit | 0 vulnerabilities |
| Host RC backup/restore | green |
| Docker RC | green (`DB_PATH=/data/alphastudio.db`) |

Matrix: `docs/stabilize/TEST_MATRIX.md`  
Final report: `docs/stabilize/FINAL_STABILITY_REPORT.md`  
Security boundary: `docs/stabilize/SECURITY_BOUNDARY.md`  
Backup/rollback: `docs/stabilize/backup-rollback.md`

## Residuals (P3/P4 only)

- Tool download SHA integrity (CP5 residual)
- GitHub branch protection (ops — enable when ready; require `CI / core-ubuntu`)
- Runtime axe/keyboard e2e; SSE live status chip; measured contrast
- Windows GitHub Actions core job (optional)
- Action SHA pinning (tag majors still used)
- Full Linux host matrix (no WSL user distro)
- VPS multi-user TLS/rate-limit (deploy epic; formal boundary recorded)

## Exact next action

**User-approved merge only:**

```text
stabilize/alphastudio-stable-baseline -> ux-ui-redesign
ux-ui-redesign -> main
```

After each approved merge: fetch, rerun required checks, verify local/remote HEAD equality.  
**Do not** create a stable tag without explicit approval.
