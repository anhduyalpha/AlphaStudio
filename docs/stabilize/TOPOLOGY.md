# Git topology (stabilization baseline)

**Captured:** 2026-07-24 (this pass only — do not treat older reports as proof)  
**Branch for process artifacts:** `stabilize/alphastudio-stable-baseline`  
**Base commit:** `ed460ee763663eef3f0aae9080eeb5e15c68fe1c` (`main` tip)

## Remotes

| Remote | URL |
|--------|-----|
| origin (fetch/push) | `https://github.com/anhduyalpha/AlphaStudio.git` |

## Working tree

- Clean: no uncommitted or unstaged changes at capture time.
- No stash entries.
- No tags in the repository.

## Branch tips

| Ref | SHA | Upstream | Notes |
|-----|-----|----------|--------|
| `main` | `ed460ee` | `origin/main` (0/0) | Local main matches remote |
| `origin/main` | `ed460ee` | — | Same as local main |
| `ux-ui-redesign` | `d03497f` | `origin/ux-ui-redesign` | **[gone]** after fetch --prune: remote-tracking ref may be deleted or not fetchable as expected; local tip still at `d03497f` |
| `origin/ux-ui-redesign` | `d03497f` | — | Present at capture after fetch (0 ahead/behind local) |
| `stabilize/alphastudio-stable-baseline` | `ed460ee` (at create) | none initially | Created from `main` @ `ed460ee` for this program |

**Note on `[gone]`:** `git branch -vv` reported `[origin/ux-ui-redesign] [gone]` even while `origin/ux-ui-redesign` resolved to the same SHA after `git fetch --prune`. Treat remote tracking of `ux-ui-redesign` as fragile; **never delete** the local branch until its 37 commits are reviewed and either merged or explicitly archived.

## Merge base

```text
git merge-base main ux-ui-redesign
→ ed460ee763663eef3f0aae9080eeb5e15c68fe1c
```

`ux-ui-redesign` is **exactly 37 commits ahead** of `main` (left-right count `0 37`).  
Those commits are local design/converter residual work and must be preserved.

## Other remote branches (not checked out)

- `origin/feature/converter-phase-1-engine-registry`
- `origin/features/python-runtime`
- `origin/HEAD` → `origin/main`

## Stabilize branch policy

- Create/resume from recorded safer base: **`main` @ `ed460ee`**.
- Do **not** modify `main`, force-push, hard-reset, or delete `ux-ui-redesign`.
- Process-only commits land on `stabilize/alphastudio-stable-baseline`.
- Product features are out of scope for this program’s audit pass.

## Evidence files (scratch; ephemeral)

- `{SCRATCH}/git-topology.txt` — raw command capture
- `{SCRATCH}/repo-inventory.txt` — scripts/docs/tests inventory
- `{SCRATCH}/branch-safety.txt` — post-commit branch safety proof

## Explicit non-proofs

The following exist but are **not** accepted as proof of repository stability without fresh command/test evidence:

- `RUNTIME_VALIDATION.md`
- PDF tools “final report” docs under `docs/`
- Completion flags or prior audit narratives
- Presence of `audit/fixtures/` without `scripts/audit/`

## Inventory highlights (this pass)

| Item | Observation |
|------|-------------|
| `.github/` | **Absent** — no CI/CD workflows in tree |
| Dockerfile / compose at root | **Absent** (0 files) |
| `scripts/audit/` | **Absent** while `package.json` defines `test:audit` and `audit:backend` |
| `audit/` | Fixtures only (`sample.jpg/pdf/png/txt/wav`) |
| `server/tests/` | 52 `*.ts` test files |
| `e2e/` | `pdf-tools.spec.js` + `support/browser-audit.js` |
| Maint scripts | `scripts/maint/*` (doctor, tools, python, db-repair, deps, clean/clear/reset) |
| Docs | BUILD_AND_RUN_WINDOWS_LINUX, job-engine, python-runtime, PDF_* suite, etc. |
| Runtime | `.runtime/` present locally; `.env` + `.env.example` present |
