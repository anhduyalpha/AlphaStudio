# Audit 10 — Git integrity & repository hygiene

**Auditor:** independent hygiene / git-integrity pass (scope-only)  
**Date:** 2026-07-24  
**Repo path:** `C:\Users\Duy\Code\Project\AlphaStudio`  
**Remote:** `origin` → `https://github.com/anhduyalpha/AlphaStudio.git`  
**Audit HEAD (local + remote):** `stabilize/alphastudio-stable-baseline` @ `c48bca1c35173c7710b76db59c3666ccc1745079`  
**Product base:** `main` / `origin/main` @ `ed460ee763663eef3f0aae9080eeb5e15c68fe1c`  
**Relation to prior work:** Complements [01-git-hygiene.md](./01-git-hygiene.md); re-verifies after CP0 push and expands object/ignore/script/import checks. **Does not implement fixes.**

---

## Scope

In scope (hygiene only):

- Object integrity (and note on `fsck`)
- Branch / upstream consistency
- Conflict markers in tracked sources
- Case-sensitive path collisions (Windows `core.ignorecase`)
- Broken imports in tracked sources (static resolution)
- Symlinks, line endings, executable bits
- Tracked secrets / data / uploads / outputs / runtime / models / logs / caches / temps
- Large / generated artifacts
- `.gitignore` completeness; `.dockerignore` absence
- Package ignore rules (`files`, `.npmignore`)
- Duplicate / contradictory / broken scripts
- Outdated docs claiming missing tools / gates

Out of scope:

- Product logic fixes under `server/src`, `src`, `python`
- CI implementation (see audit 08)
- Security exploit analysis beyond “is it tracked / ignored”
- History rewrite execution

---

## Method / evidence sources

| Source | Purpose |
|--------|---------|
| `.git/HEAD`, `.git/config`, loose refs, `packed-refs`, reflogs, `COMMIT_EDITMSG` | Branch tips, upstream, stale pack entries |
| GitHub REST: repo, branches (`main`, stabilize), compare `main...ux-ui-redesign`, recursive trees `c48bca1`, `d03497f` | Remote equality, protection, tracked paths/sizes/modes |
| Workspace inventory (`data/`, `data-test-ratelimit/`, `node_modules/`, `audit/`, residual screenshots) | Untracked runtime vs ignore rules |
| `.gitignore`, `.gitattributes`, `.npmrc`, `.env` / `.env.example` | Hygiene config + local secret posture |
| `package.json` / `server/package.json` scripts | Broken/duplicate entrypoints |
| Grep: conflict markers; secret-like tokens; script/docs claims | Static hygiene signals |
| Relative import graph (`server/src`, `src`, `python`) vs on-disk modules | Broken import check (static) |
| **Not run:** `git fsck`, `git status`, full-history secret scanners (no shell in this auditor session) |

Operator re-proof commands (read-only preferred):

```text
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD main origin/main stabilize/alphastudio-stable-baseline origin/stabilize/alphastudio-stable-baseline
git rev-parse ux-ui-redesign origin/ux-ui-redesign
git merge-base main ux-ui-redesign
git rev-list --left-right --count main...ux-ui-redesign
git branch -vv
git fsck --full --no-dangling   # optional; report if run
git ls-files .env data node_modules .runtime .tools
git check-ignore -v .env data/alphastudio.db node_modules audit/fixtures/sample.png
git ls-files -s | findstr /R "120000 100755"   # symlinks / exec bits (Windows)
rg -n "^(<<<<<<< |=======$|>>>>>>> )" --glob '!node_modules/**'
```

---

## Topology (verified this pass)

| Ref | SHA | Upstream / notes |
|-----|-----|------------------|
| `HEAD` | `ref: refs/heads/stabilize/alphastudio-stable-baseline` | Checked out |
| `stabilize/alphastudio-stable-baseline` | `c48bca1…` | Tracks `origin/stabilize/alphastudio-stable-baseline` (config present) |
| `origin/stabilize/alphastudio-stable-baseline` | `c48bca1…` | **Matches local**; GitHub API `protected: false` |
| `main` | `ed460ee…` | Tracks `origin/main` |
| `origin/main` (loose) | `ed460ee…` | Matches local main |
| `origin/main` (packed-refs stale) | `de14e5f…` | **Stale packed entry**; loose ref wins |
| `ux-ui-redesign` / `origin/ux-ui-redesign` | `d03497f…` | Equal; **37 commits ahead** of main; merge-base `ed460ee…` |
| `origin/HEAD` | `refs/remotes/origin/main` | Default branch main |
| Tags | **none** (local tags dir empty) | No release anchors |
| Hooks | only `*.sample` | No active pre-commit / secret scan |
| Stash log | none observed | No stash backlog evidence |

**Stabilize history (process-only after base):**  
`ed460ee` → `5ec253f` → `0c2decb` → `c687600` → `c48bca1` (docs/stabilize commits; product trees under `server/src` / `src` / `python` unchanged from main at create).

**GitHub repo meta:** public; `size` ≈ 68066 KiB (~66 MiB); `default_branch=main`; `license=null`; no branch protection on `main` or stabilize.

---

## Findings (P0–P4)

| ID | Sev | Finding | Location / evidence | Impact |
|----|-----|---------|---------------------|--------|
| HY-01 | **P0** | **Broken npm gates: `test:audit` / `audit:backend` point at missing `scripts/audit/`** | `package.json` `"test:audit": "node --test scripts/audit/tests/*.test.mjs"`, `"audit:backend": "node scripts/audit/backend.mjs"`; directory **absent** (workspace + stabilize tree) | Any operator or future CI invoking these scripts fails immediately; historical “green” claims are invalid |
| HY-02 | **P0** | **Docs still claim missing audit tools passed** | `RUNTIME_VALIDATION.md` (claims `test:audit` 4/4, `audit:backend` 0 issues); `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` §6 lists both; `docs/CONVERTER_PHASE_1_PLAN.md` references `test:audit` | False release/install confidence; process honesty failure (also XR-01 in master plan) |
| HY-03 | **P1** | **No branch protection on any remote branch** | GitHub API: `main` and `stabilize/alphastudio-stable-baseline` → `protected: false` | Force-push / delete of `main`, stabilize, or redesign possible with write token — **data-loss / history-rewrite risk; cross-review required before any force ops** |
| HY-04 | **P1** | **`ux-ui-redesign` holds 37 unmerged commits + large binary screenshots; unprotected** | Compare API: `ahead_by: 37`, `behind_by: 0`; tree `d03497f` has many PNGs 250–750+ KiB under `docs/ux-ui-redesign/screenshots/**`; no LFS | Accidental remote delete/force loses redesign work; merge to main would permanently bloat default clone; **do not delete/force-push without archive tag + cross-review** |
| HY-05 | **P1** | **Required test fixtures live under gitignored `audit/`** | `.gitignore` has `audit/`; local `audit/fixtures/sample.{png,jpg,pdf,txt,wav}` present; `server/tests/helpers.test.ts` + `detect.test.ts` require `audit/fixtures/*` | Clean clone / CI cannot run those suites; fixture tree cannot be committed while ignore stands |
| HY-06 | **P1** | **Legacy tool scripts contradict canonical maint path (`.tools` vs `.runtime`)** | `package.json` `check:tools`/`repair:tools`/`tools:*` → `scripts/maint/tools.mjs`; orphans `scripts/check-tools.mjs` + `repair-tools.mjs` still write/read **`.tools/config.json`**; `setup:tools` still direct to `setup-tools.mjs` while `tools:install` goes via maint (which spawns setup-tools). Tests assert all three files exist (`ui-converter-struct.test.ts`) | Direct invocation of legacy scripts produces wrong config layout; dual installer entrypoints confuse operators |
| HY-07 | **P2** | **`.dockerignore` absent; Docker assets only on redesign branch, not stabilize/main** | No root `.dockerignore` on disk; stabilize/main tree has **no** `Dockerfile`/`compose`; redesign tree has `deploy/Dockerfile.full-runtime` + docs | Future Docker on main without ignore risks baking `node_modules`, `data/`, `.runtime`, `.env` into context; redesign/main drift on packaging |
| HY-08 | **P2** | **`.gitignore` gaps for common generated/test/runtime outputs** | Missing: `test-results/`, `playwright-report/`, `blob-report/`, `docs/**/screenshots/**`, model weight dirs (beyond `.runtime/`), agent state JSON names | Easy accidental `git add` of Playwright output, screenshot dumps, large models |
| HY-09 | **P2** | **`.gitattributes` incomplete (only PDF fixtures binary)** | File content: `fixtures/pdf/*.pdf binary` only; no `* text=auto`, no PNG/JPG/WAV binary, no LFS | Line-ending noise; binary merge/diff pain; screenshot blobs stored as full objects |
| HY-10 | **P2** | **Stale `packed-refs` for `origin/main`** | `packed-refs`: `de14e5f… refs/remotes/origin/main`; loose ref `ed460ee…` | Tools that read packed-only can misreport main tip; hygiene debt |
| HY-11 | **P2** | **No tags / no release anchors** | Empty `.git/refs/tags`; API empty tags | Cannot pin “known good” product baseline by immutable tag |
| HY-12 | **P2** | **Local runtime tree is large and sensitive but correctly untracked** | Present: `data/alphastudio.db` (+wal/shm), `data/uploads/*`, `data/outputs/*`, `data-test-ratelimit/`, `node_modules/` (~11k files), python `__pycache__` | Good ignore today; operator `git add -f` or ignore regression = **user data / DB leak risk — high-risk if ever committed** |
| HY-13 | **P3** | **Tracked non-product agent MCP schema dump** | Stabilize tree includes `mcps/{codegraph,codebase-memory,neon,tasks}/tools/*.json` | Clutters product repo; not secrets observed; ownership unclear |
| HY-14 | **P3** | **Duplicate npm script aliases + dual installer entrypoints** | `tools:check` ≡ `check:tools`; `tools:repair` ≡ `repair:tools`; `setup:tools` vs `tools:install` both install paths | Cognitive load; risk of docs documenting the weaker path |
| HY-15 | **P3** | **`core.ignorecase=true` + `core.filemode=false` (Windows clone)** | `.git/config` | Case-only renames invisible on Windows; exec bits not preserved — Linux CI may disagree if modes ever used |
| HY-16 | **P3** | **No conflict markers observed; static imports appear resolvable** | Grep `<<<<<<<` / `=======` / `>>>>>>>` on sources: **no matches**; server relative imports map to existing modules; frontend `App.jsx` views exist on disk; processors lazy-load existing files | Positive: no merge-conflict residue; no obvious broken relative import on stabilize tip |
| HY-17 | **P3** | **Symlinks / executable bits: none material in stabilize tree sample** | Recursive tree modes observed as `100644` (no `120000` symlink, no `100755` exec) for stabilize tip blobs; scripts invoked via `node …` shebang not required | Low risk today; if scripts later rely on +x, Linux clones need `100755` or continued `node` wrappers |
| HY-18 | **P3** | **Line-ending policy absent** | No `* text=eol=` / `text=auto` in `.gitattributes`; no `core.autocrlf` in repo config | Cross-platform CRLF/LF churn possible |
| HY-19 | **P3** | **Process docs partially stale after CP0** | `TOPOLOGY.md` still describes stabilize tip as `ed460ee` / “no upstream initially” while live tip is `c48bca1` with upstream | Operator confusion about “current” branch tip |
| HY-20 | **P4** | **Package publish ignore rules N/A but incomplete if ever published** | Root + server `private: true`; no `"files"` field; no `.npmignore` | If `private` ever flipped without packing rules, would ship broad tree |
| HY-21 | **P4** | **Fixture PDF password documented; models lock has empty SHA for u2net** | `fixtures/pdf/manifest.json` password `alphastudio`; `python/models.lock.json` `"sha256": ""` for u2net | Expected fixture password; empty model hash is integrity debt (not a tracked secret) |
| HY-22 | **P4** | **Personal author email on stabilize process commits** | Reflog/API: `duydang0768134698@gmail.com` on docs commits; main uses mix with GitHub noreply | Public privacy disclosure; **do not history-rewrite solely for email without cross-review** |
| HY-23 | **P4** | **`git fsck` not executed this pass** | Method limitation | Object corruption not ruled out; recommend operator `git fsck --full` on stabilize clone |

### Severity summary

| Sev | Count | IDs |
|-----|-------|-----|
| **P0** | 2 | HY-01, HY-02 |
| **P1** | 4 | HY-03, HY-04, HY-05, HY-06 |
| **P2** | 6 | HY-07–HY-12 |
| **P3** | 7 | HY-13–HY-19 |
| **P4** | 4 | HY-20–HY-23 |

---

## Object integrity

| Check | Result |
|-------|--------|
| Resolve HEAD / branch tips via loose refs | OK — all listed SHAs resolve; GitHub trees for `c48bca1` and `d03497f` fetch successfully |
| Remote tip equality stabilize | Local loose = remote loose = API commit SHA `c48bca1…` |
| `git fsck` | **Not run** — see HY-23 |
| Dangling objects | Not inventoried (placeholder commit soft-reset on redesign may leave dangling blobs — normal) |
| Corrupt packs | Unknown without fsck |

**Note:** Successful recursive tree API fetch for stabilize tip is weak positive integrity evidence, not a substitute for local `git fsck`.

---

## Branch / upstream consistency

| Branch | Local | Remote | Tracked? | Ahead/behind (vs its upstream) |
|--------|-------|--------|----------|--------------------------------|
| `main` | `ed460ee` | `ed460ee` | yes | 0 / 0 (loose) |
| `stabilize/alphastudio-stable-baseline` | `c48bca1` | `c48bca1` | yes | 0 / 0 |
| `ux-ui-redesign` | `d03497f` | `d03497f` | yes | 0 / 0 |
| vs `main`…`ux-ui-redesign` | — | — | — | **0 behind / 37 ahead** |

Positive vs audit 01: stabilize **is pushed** with upstream (GH-04 in audit 01 is **resolved** for push tracking; protection still open — HY-03).

Packed-refs still lists obsolete `origin/main` and feature branches (`feature/converter-phase-1-engine-registry`, `features/python-runtime`) — inventory hygiene only.

---

## Conflict markers

Search pattern `^<<<<<<< |^=======|^>>>>>>> ` across `*.{js,jsx,ts,tsx,mjs,cjs,py,json,md,yml,yaml,css,html,toml}` (workspace, respecting ignore): **no matches**.

**Non-finding:** no leftover merge conflict markers in scanned sources.

---

## Case-sensitive path collisions

- Config: `core.ignorecase = true` (Windows).
- Stabilize tip paths are predominantly lowercase ASCII; one intentional Unicode fixture name: `fixtures/pdf/unicode-ภาษาไทย-报告.pdf` (unique).
- **No pair of tracked paths differing only by case** observed on stabilize tree listing.

Residual risk: future case-only renames on Windows will not surface until Linux/macOS clone (HY-15).

---

## Broken imports (static)

Method: resolve relative `from '…'` / dynamic `import('./…')` under `server/src`, `src`, `python` against filesystem (extensions `.ts`/`.js`/`.jsx` as used by the project).

| Area | Result |
|------|--------|
| `server/src` route/lib/convert/pdf/workers/processors graph | Relative targets exist (e.g. processors loaders → `text/image/qr/pdf/archive/security/media/converter/pyop.js` modules present) |
| Frontend `App.jsx` view map | All imported views present under `src/views/` |
| `src/assets/registry.js` public asset paths | Matching files under `public/assets/**` present in tree |
| Python `operations/*` package imports | Package layout present (`__init__.py`, op modules) |
| npm scripts as “imports” | **Broken:** `scripts/audit/**` missing (HY-01) |

**Non-finding for product sources:** no static missing relative import found on stabilize tip.  
**Finding for package scripts:** audit entrypoints are broken paths (HY-01).

---

## Symlinks, line endings, executable bits

| Concern | Observation |
|---------|-------------|
| Symlinks (`120000`) | None observed in stabilize recursive tree sample |
| Exec bits (`100755`) | None observed; `core.filemode=false` |
| Shebang scripts | `scripts/**/*.mjs` start with `#!/usr/bin/env node` but npm always uses `node script` — OK |
| Line endings | Only PDF binary attribute; no repo-wide EOL normalization |

---

## Tracked secrets / data / runtime / models / logs

| Path / class | On disk locally? | Tracked on stabilize tip? | Ignored? |
|--------------|------------------|---------------------------|----------|
| `.env` | Yes (mirrors example; tokens commented) | **No** | Yes (`.env`) |
| `.env.example` | Yes | **Yes** | No (intended) |
| `data/` DB, uploads, outputs | Yes (real user/runtime content) | **No** | Yes (`data/`) |
| `data-test-ratelimit/` | Yes | **No** | Yes (`data-test-*/`) |
| `node_modules/` | Yes | **No** | Yes |
| `.runtime/`, `.tools/` | May exist | **No** | Yes |
| `*.log`, `coverage/`, `.vite/`, `tmp/`, `temp/`, `logs/` | varies | **No** | Yes |
| `python/**/__pycache__`, `*.pyc` | Yes | **No** | Yes |
| `audit/` fixtures + claimed logs | fixtures yes; logs claimed by RUNTIME_VALIDATION | **No** | Yes (`audit/`) — problem for fixtures (HY-05) |
| AI model weights | expected under runtime/models | **No** (only `python/models.lock.json` tracked) | Partial (`.runtime/`) |
| `fixtures/pdf/*` | Yes | **Yes** (small intentional) | No |
| Secrets in source grep | Test constants / error codes only; no live API keys observed in current tree scan | — | — |

**High-risk callout:** Committing `data/` or a filled `.env` would leak local documents and credentials. Never use history rewrite casually to “undo” such a leak without coordinated rotation + **cross-review** (HY-12).

Full historical secret scan (`gitleaks` / `trufflehog` / `git log -S`) **not run** this pass.

---

## Large / generated artifacts

| Location | Branch | Notes |
|----------|--------|-------|
| `package-lock.json` ~200 KiB | stabilize/main | Normal |
| `fixtures/pdf/large-205-pages.pdf` ~114 KiB | stabilize/main | Acceptable fixture |
| Brand PNGs ≤ ~45 KiB | stabilize/main | Acceptable |
| Screenshot PNGs 130–750+ KiB × many viewports × rounds | **`ux-ui-redesign` only** | Primary driver of ~66 MiB GitHub size; no LFS (HY-04) |
| Local `data/uploads`, `data/outputs` | untracked | Generated runtime; must stay ignored |
| `mcps/**` JSON | stabilize/main | Many small blobs; clutter not size crisis |

---

## `.gitignore` completeness

**Present and useful:** `node_modules/`, `dist/`, `data/`, `data-test*`, `.tools/`, `.runtime/`, `.env`, logs/caches/coverage, python bytecode, nested `server/package-lock.json`.

**Gaps (HY-08 / HY-05):**

1. `audit/` blanket ignore hides **required** fixtures.
2. No Playwright output dirs.
3. No screenshot capture dirs for redesign evidence.
4. No explicit ignore for agent state files (`.ux-ui-redesign-state.json` is **tracked on redesign**, not on stabilize).

---

## `.dockerignore` / package ignore

| Artifact | Status |
|----------|--------|
| `.dockerignore` | **Absent** (HY-07) |
| Root `Dockerfile` / compose on stabilize | **Absent** |
| `deploy/Dockerfile.full-runtime` | Only on `ux-ui-redesign` |
| `.npmignore` | Absent |
| `"files"` in package.json | Absent (`private: true` mitigates) |

---

## Scripts: duplicate / contradictory / broken

| Script | Target | Verdict |
|--------|--------|---------|
| `test:audit` | `scripts/audit/tests/*.test.mjs` | **Broken** (missing tree) |
| `audit:backend` | `scripts/audit/backend.mjs` | **Broken** (missing tree) |
| `tools:check` / `check:tools` | `maint/tools.mjs check` | OK, **duplicate aliases** |
| `tools:repair` / `repair:tools` | `maint/tools.mjs repair` | OK, duplicate aliases |
| `tools:install` / `runtime:prepare` | `maint/tools.mjs install` → spawns `setup-tools.mjs` | Canonical install path |
| `setup:tools` | `setup-tools.mjs --full` | Parallel entry (intentional but dual) |
| Direct `scripts/check-tools.mjs` | `.tools/config.json` | **Legacy footgun** if called by path |
| Direct `scripts/repair-tools.mjs` | `.tools/config.json` | **Legacy footgun** |
| `clear` / `reset` / `clean` | maint scripts | Documented data wipe for `--all`; **data-loss risk if misused** — operational, not a git bug |

---

## Outdated docs claiming missing tools

| Doc | Claim | Reality |
|-----|-------|---------|
| `RUNTIME_VALIDATION.md` | `test:audit` 4/4; `audit:backend` 0 issues; audit log paths under `audit/logs/` | Scripts and logs path tree missing / gitignored |
| `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` | Pre-prod checklist includes `test:audit`, `audit:backend` | Entrypoints broken |
| `docs/CONVERTER_PHASE_1_PLAN.md` | References `npm run test:audit` | Same |
| `docs/stabilize/TOPOLOGY.md` | Stabilize tip `ed460ee`, upstream “none initially” | Tip now `c48bca1` with upstream (process-doc drift) |
| README | Honest about `bootstrap` / `runtime:prepare` not auto-run by `dev`/`build`/`start` | **Better** than BUILD doc |

---

## Positive hygiene (non-findings)

- `.env`, `data/`, `node_modules/`, `.runtime/`, `.tools/` **not** tracked on stabilize tip.
- Local `.env` currently has no live `API_AUTH_TOKEN` / `VITE_API_TOKEN` (commented placeholders).
- No merge conflict markers in scanned sources.
- Static relative import graph for product code looks intact.
- Stabilize local = origin stabilize; main local = origin main (loose).
- Redesign tip preserved and equal remote/local.
- `private: true` on packages reduces accidental npm publish blast radius.
- PDF fixtures intentionally small and attributed binary.

---

## Proposed plan (hygiene-only; do not implement in this audit)

Ordered for CP1+ process; **no history rewrite** without explicit owner + cross-review.

### Step 1 — Honesty gates (P0) — **no data loss**

1. Remove or replace `test:audit` / `audit:backend` in `package.json` so they either work or do not exist.
2. Edit `RUNTIME_VALIDATION.md`, `BUILD_AND_RUN_WINDOWS_LINUX.md`, converter plan docs to stop claiming missing tools.
3. Prefer `doctor` / `test:maint` / real `npm test` as honest gates until audit suite restored.

### Step 2 — Fixtures vs ignore (P1)

1. Relocate samples to tracked `fixtures/samples/` **or** un-ignore `audit/fixtures/**` while keeping `audit/logs/` ignored.
2. Point `helpers.test.ts` / `detect.test.ts` at the committed path.
3. Verify clean-clone `npm test` path for those files.

### Step 3 — Branch protection & preserve redesign (P1) — **high-risk if ignored**

1. Enable GitHub protection on `main`, `stabilize/*`, and `ux-ui-redesign`: disallow force-push + deletion at minimum.
2. **Never** `git push --force` shared branches; **never** delete `ux-ui-redesign` without archive tag.
3. Any history rewrite / filter-repo for screenshots requires **cross-review** and a throwaway clone.

### Step 4 — Binary / screenshot policy (before redesign merge)

1. Decide LFS vs external store vs leave on redesign only.
2. Expand `.gitattributes` for images; extend `.gitignore` for local capture dumps.
3. Do not merge screenshot trees into `main` without policy.

### Step 5 — Tool script consolidation (P1/P3)

1. Deprecate `check-tools.mjs` / `repair-tools.mjs` (print “use npm run tools:check” and exit 2) **or** rewire to maint.
2. Update struct tests that require their existence accordingly.
3. Document single install entry: `tools:install` / `runtime:prepare`.

### Step 6 — Ignore & Docker hygiene (P2)

1. Add Playwright output ignores; optional screenshot ignores.
2. When adding Dockerfile to main: add `.dockerignore` excluding `data/`, `node_modules/`, `.runtime/`, `.env`, `audit/logs`, etc.
3. Reconcile redesign `deploy/Dockerfile.full-runtime` with stabilize packaging story.

### Step 7 — Ref / pack hygiene (P2) — **local only**

```text
git fetch --prune
git pack-refs --all
# optional: git fsck --full
# optional: git gc   # local only; not history rewrite of remotes
```

### Step 8 — Tag policy (after product gates green)

Annotated tag only after honest tests pass; push tag. Do not rewrite tags.

### Step 9 — Optional deep secret scan

```text
# offline, operator machine
gitleaks detect --source . -v
# or: git log -p --all -S API_AUTH_TOKEN
```

---

## Dependencies

| Dependency | Why |
|------------|-----|
| GitHub admin | Branch protection |
| Decision on redesign merge / screenshot storage | HY-04 |
| CP1 owners for package.json + fixtures + docs | HY-01, HY-02, HY-05 |
| Runtime audit 05 agreement on tool entrypoints | HY-06 |
| Operator shell for `git fsck` / secret scanners | HY-23 |

---

## Risks (explicit high-risk)

| Risk | Sev | Cross-review? | Mitigation |
|------|-----|---------------|------------|
| Force-push / delete of `main` or `ux-ui-redesign` | Data loss | **Yes** | Protection + process ban on `--force` shared branches |
| History rewrite to drop screenshots or emails | SHA break for all remotes | **Yes** | filter-repo only on coordinated throwaway clone + re-clone mandate |
| Accidental commit of `data/` or live `.env` | Secrets + user files | **Yes** if already pushed | Keep ignores; rotate tokens if leaked; consider BFG only with full awareness |
| `npm run clear -- --all` / `reset` | Local data wipe | Operator care | Document; dry-run first |
| Merging redesign binaries into main | Permanent clone bloat | Yes (product + git) | Binary policy step 4 |
| Restoring broken audit scripts without honesty | False confidence | Process | Prefer delete until real suite exists |

---

## Unknowns

1. Full `git fsck` result on this clone.
2. Whether any historical blob ever contained live tokens (not exhaustively scanned).
3. Exact aggregate screenshot byte sum on redesign (many large files confirmed; total not summed).
4. Intent of tracked `mcps/**` (product vs agent dump).
5. Future of `deploy/Dockerfile.full-runtime` from redesign vs stabilize packaging.
6. Working-tree cleanliness at any given moment after this audit file is written (untracked process artifacts expected).

---

## Explicit non-claims

This audit does **not** claim:

- Application stability, VPS-readiness, or that `npm test` currently passes end-to-end.
- That `RUNTIME_VALIDATION.md` results are reproducible.
- That object store is corruption-free without `fsck`.
- That history is free of secrets for all time.
- That fixes have been applied (none were; write path limited to this document).

---

## Diff vs audit 01 (delta)

| Topic | Audit 01 | This pass (10) |
|-------|----------|----------------|
| Stabilize upstream | Missing / local-only | **Pushed**; local = origin `c48bca1` |
| HEAD | `ed460ee` (base) | `c48bca1` (process docs) |
| Broken `scripts/audit` | Noted via topology | Elevated **P0** with docs false-green |
| Fixture gitignore | Partial | **P1** with test citations |
| Dual tool scripts | Light | Explicit `.tools` footgun |
| Static imports / conflict markers | Not focus | Checked — clean |
| `fsck` | Not run | Explicitly unknown (HY-23) |
| `.dockerignore` | Via platforms | Confirmed absent + redesign Docker drift |

---

## Citations (primary evidence paths)

- `C:\Users\Duy\Code\Project\AlphaStudio\.git\config`
- `C:\Users\Duy\Code\Project\AlphaStudio\.git\refs\heads\stabilize\alphastudio-stable-baseline`
- `C:\Users\Duy\Code\Project\AlphaStudio\.git\refs\remotes\origin\stabilize\alphastudio-stable-baseline`
- `C:\Users\Duy\Code\Project\AlphaStudio\.git\packed-refs`
- `C:\Users\Duy\Code\Project\AlphaStudio\.gitignore`
- `C:\Users\Duy\Code\Project\AlphaStudio\.gitattributes`
- `C:\Users\Duy\Code\Project\AlphaStudio\package.json`
- `C:\Users\Duy\Code\Project\AlphaStudio\RUNTIME_VALIDATION.md`
- `C:\Users\Duy\Code\Project\AlphaStudio\docs\BUILD_AND_RUN_WINDOWS_LINUX.md`
- `C:\Users\Duy\Code\Project\AlphaStudio\server\tests\helpers.test.ts`
- `C:\Users\Duy\Code\Project\AlphaStudio\server\tests\detect.test.ts`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\check-tools.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\tools.mjs`
- GitHub: `repos/anhduyalpha/AlphaStudio`, branches, compare `main...ux-ui-redesign`, trees `c48bca1`, `d03497f`
