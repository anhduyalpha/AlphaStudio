# Approved repair sequence — CP1 hygiene / clean-clone

**Status:** APPROVED by coordinator (2026-07-24)  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Pre-repair tip:** `c48bca1`  
**Recorded product base:** `main` @ `ed460ee`  
**Scope:** git integrity, repository hygiene, clean-clone reproducibility only  

## Forbidden actions (no exceptions in this checkpoint)

- History rewrite (`filter-repo`, `rebase -i` of published commits, amend of pushed commits)
- Force-push
- Credential rotation
- Deleting untracked local work or `ux-ui-redesign`
- Branch reset / hard-reset of shared branches
- Committing `.env`, `data/`, `.runtime/`, secrets

## Cross-review (high-risk)

| Item | Decision |
|------|----------|
| Branch protection missing | **Residual P2 ops** — cannot fix via app commit alone; do not force-push |
| `ux-ui-redesign` 37 commits | **Preserve** — out of repair sequence |
| `scripts/audit` restore | **Impossible** on this clone (`git log -- scripts/audit` empty) → **remove** scripts + scrub docs |
| Live secrets | None tracked; keep `.env` ignored |
| `predev`/`prebuild`/`prestart` | **Do not add** full-runtime hooks (breaks clean-clone / core mode). Align maint test + BUILD doc to `bootstrap` only |

Audits: `09-hygiene-clean-clone.md`, `10-hygiene-git-integrity.md`, scratch cross-review notes.

## Ordered repairs (execute in order)

### R1 — Broken npm scripts (P0)

- Remove `test:audit` and `audit:backend` from root `package.json`.
- Regression guard: real test that every `package.json` script referencing a path under `scripts/` or `server/` points at an existing file/dir (glob parents ok).

### R2 — Fixtures clean-clone (P1)

- Copy `audit/fixtures/*` → tracked `fixtures/samples/` (jpg/pdf/png/txt/wav).
- Point `server/tests/detect.test.ts` and `helpers.test.ts` at `fixtures/samples`.
- Keep `audit/` gitignored for ephemeral audit outputs; do not require untracked fixtures.

### R3 — Maint test honesty (P1)

- Fix `scripts/maint/tests/maint-core.test.mjs` to assert:
  - `bootstrap` runs `npm ci` + `runtime:prepare`
  - `predev` / `prebuild` / `prestart` are **absent** (core mode honesty)
- Do **not** invent multi-GB pre-hooks.

### R4 — Docs honesty (P0/P1)

- `RUNTIME_VALIDATION.md`: mark historical claims; remove assertion that missing audit scripts pass.
- `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` §2/§6: only `bootstrap` prepares full runtime; drop `test:audit` / `audit:backend` from gates; list honest gates (`build`, `test`, `test:maint`, `deps:check`, doctor/tools as optional).
- Light fix on other docs that mandate missing scripts if grepped.

### R5 — Ignore hygiene (P2)

- `.gitignore`: ensure Playwright reports, test-results, screenshots artifacts ignored if not already; keep data/runtime/env ignored.
- Add root `.dockerignore` excluding `node_modules`, `data`, `.runtime`, `.env`, `dist`, logs, etc. (even without Dockerfile yet — future-proof).

### R6 — Legacy tool scripts (P2)

- Make `scripts/check-tools.mjs` and `scripts/repair-tools.mjs` thin forwarders to `scripts/maint/tools.mjs` (or print deprecation + exit 1 with redirect). Prefer forwarder so accidental direct runs work.

### R7 — db:repair path honesty (P2)

- Improve `scripts/maint/db-repair.mjs` to load full `repairDb`/`initDb` via `tsx` when dist missing (or document + use `node --import tsx` in package script). Prefer: `db:repair` script uses `node --import tsx` to call server repair API so fresh clone after typecheck/build OR without dist still migrates fully.

### R7b — reset.mjs CC-07 tsx root-hoist (P2) — closed in follow-up

- **Was:** `reset.mjs` looked only at `server/node_modules/tsx/dist/cli.mjs` (absent after workspace `npm ci` root hoist) and soft-fell to dirs-only.
- **Fix:** `scripts/maint/lib/tsx-resolve.mjs` + `scripts/maint/init-db.mjs`; reset uses `node --import tsx scripts/maint/init-db.mjs` (or dist). Refuses dirs-only soft-fail.
- **Guard:** hygiene tests assert tsx resolve + full init-db.
- **Evidence:** `{SCRATCH}/reset-db-init.txt`, `hygiene-tests-cc07.txt`.

### R7c — bench-startup fixtures (P2)

- Retarget `defaultUploadFixture()` to `fixtures/samples/*` first (legacy `audit/fixtures` last).

### R8 — Regression guards + process

- Add `scripts/maint/tests/package-scripts-hygiene.test.mjs` (or section in maint-core) for script path existence + no audit scripts + fixtures/samples present.
- Optional: server test that fixtures/samples files exist (helpers already asserts exists).

### R9 — Clean-clone proof (gate)

- Isolated worktree/clone: `npm ci`, `typecheck`, `build`, core start with empty DATA_DIR, fresh DB, `db:repair`. Capture logs under scratch.

### R10 — Checkpoint

- STATE + handoff; focused tests; typecheck; build; one coherent commit (or small series if needed); normal push; HEAD equality.

## Out of scope (not P0–P2 for this checkpoint)

- Job retry/security download path (product CP3–4)
- Full CI GitHub Actions (CP2 product program)
- Frontend a11y
- Installing full tool profiles

## Residual accepted (with evidence)

| ID | Why residual |
|----|----------------|
| Branch protection | Requires GitHub admin settings |
| Linux case FS runtime | Static scan: no collisions; no case-sensitive FS here |
| Full optional runtime install | Explicitly non-goal |

## Implementation note

Repairs begin **after** this file is committed or present in the working tree as the freeze artifact. Prefer one primary repair commit + process commit if cleaner; multi-commit OK if each is green.
