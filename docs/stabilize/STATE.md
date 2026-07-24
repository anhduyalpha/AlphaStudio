# Stabilization state

**Program:** AlphaStudio stable baseline  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Status:** CP1_HYGIENE_IN_PROGRESS → green after push  
**Last updated:** 2026-07-24  
**Base / create SHA:** `ed460ee763663eef3f0aae9080eeb5e15c68fe1c`  
**Pre-CP1 tip:** `c48bca1`

## Declaration

**This repository is not declared fully product-stable.**  
CP1 addresses **git hygiene + clean-clone reproducibility** only.

## Topology (summary)

| Item | Value |
|------|--------|
| Remote | `origin` → `https://github.com/anhduyalpha/AlphaStudio.git` |
| `main` | `ed460ee` = `origin/main` (must stay) |
| `ux-ui-redesign` | `d03497f`, 37 ahead — **preserve** |
| Stabilize | work branch for process + hygiene repairs |

## Artifact index

| Artifact | Path | Status |
|----------|------|--------|
| Repair sequence (approved before fixes) | `docs/stabilize/REPAIR_SEQUENCE_CP1_HYGIENE.md` | written |
| Audit clean-clone | `docs/stabilize/audits/09-hygiene-clean-clone.md` | written |
| Audit git integrity | `docs/stabilize/audits/10-hygiene-git-integrity.md` | written |
| Handoff CP01 | `docs/stabilize/handoffs/CP01-hygiene-clean-clone.md` | written |
| Master plan | `docs/stabilize/MASTER_PLAN.md` | prior |
| Hygiene regression tests | `scripts/maint/tests/package-scripts-hygiene.test.mjs` | added |

## Checkpoint log

| ID | Date | Summary | Commit | Local HEAD == remote? |
|----|------|---------|--------|------------------------|
| CP0 | 2026-07-24 | Process bootstrap + 8 audits | `5ec253f`…`c48bca1` | YES at CP0 close |
| CP1 | 2026-07-24 | Hygiene + clean-clone repairs | `0c39f5879cf617b43048fb2c6dfe33b519a3d5c5` | (verify after push) |

## CP1 repairs landed (in-scope P0–P2)

| Finding | Resolution |
|---------|------------|
| P0 broken `test:audit` / `audit:backend` | Removed from `package.json` |
| P0 false docs claims | `RUNTIME_VALIDATION.md`, BUILD §6 scrubbed |
| P1 fixtures gitignored | Tracked `fixtures/samples/*`; tests retargeted |
| P1 maint pre* hooks assertion | Test expects **absent** predev/prebuild/prestart |
| P2 ignore gaps | `.gitignore` + new `.dockerignore` |
| P2 legacy check/repair-tools | Forward to `scripts/maint/tools.mjs` |
| P2 db:repair partial heal | `npm run db:repair` uses `--import tsx`; full repairDb preferred |

## Residual (explicitly accepted)

| Item | Severity | Notes |
|------|----------|-------|
| GitHub branch protection | P2 ops | Cannot enable from app commit alone |
| Linux case-sensitive FS runtime | evidence static | No case collisions in `git ls-files` |
| Full optional tool install | non-goal | Core mode only for CP1 |

## Exact next action

After CP1 green push: **CP2** — minimal GitHub Actions (typecheck+build+test) + backup/rollback notes per master plan; do not declare product stable.

