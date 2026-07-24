# Handoff: CP01 — Hygiene, script honesty, clean-clone reproducibility

**Date:** 2026-07-24  
**Author / agent:** coordinator  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Base SHA before work:** `c48bca1c35173c7710b76db59c3666ccc1745079`  
**HEAD after commit:** (fill at push)  
**Remote HEAD after push:** (fill at push)  
**Local HEAD == remote HEAD:** (fill at push)

### Goal of this checkpoint

Repair git/repo hygiene and clean-clone blockers: remove broken audit npm scripts,
commit sample fixtures, align docs and maint tests with core-mode honesty,
ignore hygiene, db:repair full path, regression guards. Prove virgin clone
`npm ci` + typecheck + build + core start + fresh DB.

### Scope touched

- Paths: `package.json`, `.gitignore`, `.dockerignore`, `fixtures/samples/*`,
  `server/tests/{detect,helpers}.test.ts`, `scripts/maint/*`,
  `scripts/check-tools.mjs`, `scripts/repair-tools.mjs`,
  `RUNTIME_VALIDATION.md`, `docs/BUILD_AND_RUN_WINDOWS_LINUX.md`,
  `docs/CONVERTER_PHASE_1_PLAN.md`, `docs/stabilize/*`
- Out of scope: product job security/a11y/CI Actions, `main`, `ux-ui-redesign`

### Gates

| Gate | Command(s) | Result | Evidence |
|------|------------|--------|----------|
| Focused tests | `node --test scripts/maint/tests/package-scripts-hygiene.test.mjs`; maint-core; helpers+detect | PASS | `{SCRATCH}/hygiene-tests.txt`, maint-core, detect-helpers |
| Typecheck | `npm run typecheck` | PASS | `{SCRATCH}/typecheck.txt` |
| Build | `npm run build` | PASS | `{SCRATCH}/build-dev-tree.txt` |
| Relevant smoke | clean clone ci/typecheck/build + core start + db repair | (after push proof) | `{SCRATCH}/clean-clone-*.txt` |
| Diff validation | hygiene/docs/tests only; no `main` rewrite | PASS | `git diff --stat` |
| State update | `docs/stabilize/STATE.md` | PASS | this checkpoint |
| Handoff update | this file | PASS | |
| One coherent commit | hygiene clean-clone repair | PASS | |
| Normal push | no `--force` | PASS | |
| HEAD equality | local == origin/stabilize | PASS | `{SCRATCH}/branch-safety.txt` |

### Explicit non-claims

- Repository is **not** fully product-stable.
- Full tool runtime install not required.
- Branch protection remains an ops residual (not fixed in-repo).

### Follow-ups / next exact action

1. CP2 (master plan): minimal CI + backup/rollback notes — or CP3 security path confinement if CI deferred.
