# Stabilization state

**Program:** AlphaStudio stable baseline  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Status:** CP1_HYGIENE_GREEN (not fully product-stable)  
**Last updated:** 2026-07-24  
**Base / create SHA:** `ed460ee763663eef3f0aae9080eeb5e15c68fe1c`  
**CP1 repair commit:** `0c39f58`  
**CC-07 / bench follow-up:** see tip after push  

## Declaration

**Not fully product-stable.** CP1 closed git hygiene + clean-clone scope (including CC-07 reset tsx hoist and bench fixtures).

## Topology

| Item | Value |
|------|--------|
| main / origin/main | ed460ee (unchanged) |
| ux-ui-redesign | d03497f +37 — preserve |
| stabilize | work branch |

## Checkpoint log

| ID | Summary | Notes | HEAD==remote |
|----|---------|-------|--------------|
| CP0 | Process audits | baseline | YES |
| CP1 | Hygiene + clean-clone | `0c39f58` + docs | YES |
| CP1b | CC-07 reset tsx + bench fixtures | init-db + tsx-resolve + guards | after push |

## In-scope P0–P2 (hygiene / clean-clone) — all closed

| Finding | Resolution |
|---------|------------|
| P0 broken audit scripts | Removed from package.json |
| P0 false docs claims | RUNTIME_VALIDATION + BUILD scrubbed |
| P1 fixtures gitignored | fixtures/samples tracked |
| P1 maint pre* hooks | Assert absent |
| P2 ignore gaps | gitignore + dockerignore |
| P2 legacy tool scripts | Forwarders |
| P2 db:repair partial | --import tsx + full repairDb |
| **P2 CC-07 reset tsx** | **Fixed:** root-hoist resolve + init-db.mjs; no dirs-only soft-fail |
| **P2 bench-startup fixtures** | **Fixed:** fixtures/samples first |

## Residuals only (not open product P0–P2 in this scope)

| Item | Severity | Notes |
|------|----------|-------|
| GitHub branch protection | P2 **ops** | Cannot enable from app commit alone |
| Linux case-sensitive FS runtime | evidence limit | Static scan: no collisions; no case-sensitive FS here |

## Exact next action

**CP2** — minimal GitHub Actions (typecheck + build + test) + backup/rollback notes per MASTER_PLAN.md.
