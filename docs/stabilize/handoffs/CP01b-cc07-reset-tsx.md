# Handoff: CP01b — CC-07 reset tsx hoist + bench fixtures

**Date:** 2026-07-24  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Parent:** CP01 hygiene (`0c39f58`)

### Goal

Close skeptic gaps: reset DB init under workspace root-hoisted tsx; bench-startup fixtures on clean clone; residual list honesty.

### Changes

- `scripts/maint/lib/tsx-resolve.mjs` — root + server tsx candidates + package resolve
- `scripts/maint/init-db.mjs` — full `ensureDataDirs` + `initDb` (dist or TS under `--import tsx`)
- `scripts/maint/reset.mjs` — uses init-db; **refuses dirs-only soft-fail**
- `scripts/maint/bench-startup.mjs` — `fixtures/samples` first
- Hygiene tests: tsx resolve, init-db real run, bench path

### Gates

| Gate | Result | Evidence |
|------|--------|----------|
| Focused tests | PASS | hygiene-tests-cc07.txt (7/7), maint-core-cc07.txt |
| Typecheck | PASS | typecheck-cc07.txt |
| Build | PASS | build-cc07.txt |
| Reset DB init | PASS | reset-db-init.txt (`[init-db] ok`, full repair versions 1–7) |
| Reset dry-run | PASS | reset-dry-run.txt mentions init-db.mjs |
| Diff scope | maint scripts + tests + stabilize docs | |
| Normal push + HEAD==remote | after push | branch-safety.txt |

### Residuals (honest)

- Branch protection: ops only  
- Linux case FS: static-only  

No open in-scope P0–P2 for hygiene/clean-clone after this handoff.

### Next action

CP2 — CI + backup/rollback notes.
