# Audit 08 — CI, GitHub Actions, PRs, releases, backup, and rollback

| Field | Value |
|-------|--------|
| **Program** | AlphaStudio stable baseline |
| **Scope ID** | (h) CI / release / backup / rollback only |
| **Audit date** | 2026-07-24 |
| **Base SHA (main tip / stabilize create)** | `ed460ee763663eef3f0aae9080eeb5e15c68fe1c` |
| **Branch context** | `stabilize/alphastudio-stable-baseline` (process); product tree as of main @ `ed460ee` |
| **Remote** | `origin` → `https://github.com/anhduyalpha/AlphaStudio.git` |
| **Auditor stance** | Evidence-based presence/absence; **no CI stood up in this pass** |
| **Product code modified** | **None** (this file only) |

---

## 1. Executive summary

AlphaStudio has **no automated CI/CD** in-repo: **`.github/` is absent**, so there are no GitHub Actions workflows, no PR template, no issue templates, no Dependabot/Renovate config, and no CODEOWNERS. **Git tags are empty** (no release tags). Versioning is **manual and currently consistent** at **`3.6.0`** across root `package.json`, `server/package.json`, and `V3_CHANGELOG.md`.

Operational **recovery** tooling is relatively strong for a local-first app (`doctor`, `clear`/`clean`/`reset`, `db:repair`, tools/python repair), and **manual backup guidance** exists in `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` §8. There is **no backup script**, **no automated backup**, and **no formal product rollback runbook** (git-level stabilize rules exist separately under `docs/stabilize/`).

**Missing CI is a high-severity process gap**: release gates documented in build docs (`npm test`, `test:maint`, `test:audit`, `audit:backend`, etc.) are not enforced on push/PR, and some documented gates already point at **missing** `scripts/audit/`. Without CI and tags, regressions can ship unnoticed and releases cannot be pinned or rolled back by version.

---

## 2. Scope and out of scope

### In scope (this audit)

- Presence/absence of `.github/` (workflows, PR/issue templates, Dependabot, CODEOWNERS)
- Release tags and version/changelog discipline
- Backup scripts and documented backup/retention practices
- Rollback documentation and operational recovery paths
- `package.json` version, `V3_CHANGELOG.md`, maint `reset` / `clear` / `db-repair` as recovery
- Playwright/docs CI env hints vs real automation
- Severity-ranked findings, minimal proposed CI and backup/rollback **plans only**

### Explicitly out of scope

- Standing up CI workflows or GitHub settings (audit only)
- Product code, feature work, security deep-dive (see audit 07)
- Full test-coverage quality (see audit 04)
- Runtime tool binary correctness (see audit 05)
- Modifying `main`, force-push, deleting branches

---

## 3. Method and evidence sources

| Source | What was checked |
|--------|------------------|
| Filesystem | Root inventory; `docs/stabilize/*`; `scripts/maint/*`; absence of `.github/` |
| Git refs | `.git/refs/tags/` empty; no `refs/tags/*` in packed-refs; `TOPOLOGY.md` / `STATE.md` record **Tags: none** |
| Package manifests | Root + `server/package.json` `version`; npm scripts for test/build/maint |
| Changelog | `V3_CHANGELOG.md` headings vs declared version |
| Ops docs | `README.md`, `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` (§6 pre-prod, §8 backup, §10 repair) |
| Test/config | `playwright.config.js` `process.env.CI`; `server/tests/release-regressions.test.ts` |
| Stabilize process | `STATE.md`, `TOPOLOGY.md`, `HANDOFF_FORMAT.md` gates |

Graph systems were not required; this is structural presence/absence.

---

## 4. Inventory matrix (presence / absence)

| Artifact | Path / signal | Status | Notes |
|----------|---------------|--------|-------|
| GitHub Actions workflows | `.github/workflows/*` | **ABSENT** | Entire `.github/` directory missing |
| PR template | `.github/pull_request_template.md` or `PULL_REQUEST_TEMPLATE/` | **ABSENT** | |
| Issue templates | `.github/ISSUE_TEMPLATE/` | **ABSENT** | |
| CODEOWNERS | `.github/CODEOWNERS` | **ABSENT** | |
| Dependabot / Renovate | `.github/dependabot.yml` / `renovate.json` | **ABSENT** | |
| Security policy | `SECURITY.md` | **ABSENT** (not required for this audit; noted) | |
| CONTRIBUTING | `CONTRIBUTING.md` | **ABSENT** | |
| Dockerfile / compose (root) | `Dockerfile`, `docker-compose*.yml` | **ABSENT** | Confirmed in TOPOLOGY; relevant to release packaging only |
| Git release tags | `git tag` / `.git/refs/tags` | **NONE** | No `v3.x` tags despite changelog versions |
| GitHub Releases | Remote practice | **UNKNOWN** | Not verified via API; no local tag basis for releases |
| Root version | `package.json` → `"version": "3.6.0"` | **PRESENT** | Aligned |
| Server version | `server/package.json` → `"version": "3.6.0"` | **PRESENT** | Aligned |
| Changelog | `V3_CHANGELOG.md` | **PRESENT** | Latest section `v3.6.0`; manual |
| Pre-release test suite (local) | `npm test`, `test:pdf`, `test:e2e`, `test:maint`, typecheck, build | **SCRIPTS PRESENT** | Not wired to CI |
| Release regression tests | `server/tests/release-regressions.test.ts` | **PRESENT** | Static/source assertions; runs under `npm test` if suite invoked |
| Documented release gate | `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` §6 | **PRESENT** | Manual checklist; includes broken `test:audit` / `audit:backend` |
| Backup script | e.g. `scripts/**/backup*` | **ABSENT** | Docs only |
| Rollback runbook (product) | dedicated rollback doc | **ABSENT** | Partial: stabilize git policy; §10 repair steps |
| Manual backup guidance | BUILD_AND_RUN §8 | **PRESENT** | Stop server, backup `.env` + `data/`; `.runtime` reinstallable |
| Ops recovery: clear | `npm run clear` → `scripts/maint/clear.mjs` | **PRESENT** | Disposable artifacts; `--all` can wipe `data/` + `.runtime/` |
| Ops recovery: clean | `npm run clean` → `scripts/maint/clean.mjs` | **PRESENT** | Build/cache/temp only |
| Ops recovery: reset | `npm run reset` → `scripts/maint/reset.mjs` | **PRESENT** | clean + `npm ci` + DB init + tools install |
| Ops recovery: db-repair | `npm run db:repair` → `scripts/maint/db-repair.mjs` | **PRESENT** | Non-destructive schema heal |
| Ops recovery: doctor | `npm run doctor` | **PRESENT** | Diagnostics, no downloads |
| Playwright CI awareness | `playwright.config.js` | **PRESENT** | `retries`/`reporter` when `CI` set — **no runner sets it** |
| Broken audit scripts | `scripts/audit/` | **ABSENT** | `package.json` still defines `test:audit`, `audit:backend` |

---

## 5. Version and release discipline

### 5.1 Current version alignment

| Location | Value |
|----------|-------|
| Root `package.json` | `3.6.0` |
| `server/package.json` | `3.6.0` |
| `V3_CHANGELOG.md` top section | `v3.6.0 — Resumable chunk upload and fast detection` |
| `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` | States AlphaStudio **3.6.0** |

**Finding (positive):** Manifest and changelog versions match for the declared product version. No drift observed at audit time.

### 5.2 Changelog quality

`V3_CHANGELOG.md` is a user-facing narrative changelog (v3.3.0 through v3.6.0). It documents features, tests, and ops guidance references (e.g. job-engine release validation notes in v3.5.0). It is **not**:

- Linked to git tags
- Generated from commits
- Enforced by a release workflow or PR check

### 5.3 Tagging and distribution

- **No tags** in the local repository (refs empty; topology capture agrees).
- Repo is `"private": true` in both package manifests — not published as an npm package; distribution is **git clone + bootstrap**.
- Without tags, operators cannot `git checkout v3.6.0` as a known-good pin; they can only pin by commit SHA (e.g. `ed460ee` for current main).

### 5.4 Documented pre-production / release checklist

From `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` §6 (paraphrased command list):

```text
npm run build
npm test
npm run test:maint
npm run test:audit      # BROKEN — scripts/audit missing
npm run deps:check
npm audit
npm run audit:backend   # BROKEN — scripts/audit missing
```

Optional heavy release benchmarks: `npm run benchmark:workers`, `npm run benchmark:upload`.

§11 claims that for each release, regression / maintenance / audit / build / tool check / doctor should be re-run, with results in “handoff/CI of the commit” — but **there is no CI**, and stabilize handoffs are process-only and not yet a product release train.

`server/tests/release-regressions.test.ts` encodes a few structural release invariants (same-origin API client, worker drain safety, QR helpers, Converted Files behavior, no `file-type` dependency). These only protect if `npm test` is actually run.

---

## 6. CI / GitHub Actions / PRs — findings

### F-01 — No GitHub Actions / no `.github/` directory

| | |
|--|--|
| **Severity** | **High** |
| **Impact** | PRs and pushes are never automatically typechecked, built, or tested. Broken `main` can land without detection. Multi-agent / multi-branch work (`ux-ui-redesign`, feature branches) has no merge gate. Stabilize checkpoint gates in `HANDOFF_FORMAT.md` remain **human-enforced only**. Cross-platform claims (Windows/Linux) are not continuously verified. |
| **Evidence** | Directory `C:\Users\Duy\Code\Project\AlphaStudio\.github` does not exist; `TOPOLOGY.md` / `STATE.md` already flag absence. |
| **Mitigation (plan only)** | Minimal CI workflow (see §9). Do **not** block on e2e or full tool install in first iteration. |

### F-02 — No PR template or review checklist automation

| | |
|--|--|
| **Severity** | **Medium** |
| **Impact** | Reviewers lack a forced checklist for: version/changelog bumps, manual gate results, Windows vs Linux notes, data-migration risk, secrets in `.env`. Increases chance of incomplete releases and accidental product churn on stabilize branches. |
| **Evidence** | No `.github/pull_request_template.md` or `PULL_REQUEST_TEMPLATE/`. |
| **Mitigation** | Add a short PR template referencing handoff gates + “version + V3_CHANGELOG if user-facing”. |

### F-03 — Documented release gates include missing audit scripts

| | |
|--|--|
| **Severity** | **High** (process integrity) / **Medium** (if CI not yet present, still a false-green risk when humans follow docs) |
| **Impact** | Anyone following §6 or `RUNTIME_VALIDATION.md`-style claims will fail or skip critical steps. Historical docs claim `test:audit` / `audit:backend` passed; paths are currently **missing** (`scripts/audit/` absent; only `audit/fixtures` samples exist, and root `.gitignore` ignores `audit/`). Automating the broken scripts in CI would fail the pipeline immediately. |
| **Evidence** | `package.json` scripts `test:audit`, `audit:backend`; no `scripts/audit/`; STATE/TOPOLOGY hazards. |
| **Mitigation** | Either restore `scripts/audit/` or remove/rewrite docs and npm scripts before CI includes them. |

### F-04 — Playwright knows about `CI` but nothing sets it in automation

| | |
|--|--|
| **Severity** | **Low** |
| **Impact** | Config is ready (`retries: 1`, HTML reporter when `CI` is set) but unused. No false confidence of e2e in CI today. |
| **Evidence** | `playwright.config.js` lines using `process.env.CI`. |

### F-05 — No dependency update automation

| | |
|--|--|
| **Severity** | **Low–Medium** |
| **Impact** | Security and breakage updates rely on manual `npm audit` / `deps:check`. Acceptable for a local-first private app short-term; risk grows with native deps (`better-sqlite3`, `sharp`). |
| **Evidence** | No Dependabot/Renovate config. |

---

## 7. Backup — findings

### F-06 — No backup script or scheduled backup

| | |
|--|--|
| **Severity** | **High** (data durability for operators with real workspaces) |
| **Impact** | User data lives under `data/` (SQLite + uploads + outputs). `npm run clear -- --all` and accidental deletion can destroy workspaces. Without scripted backup, operators must remember manual steps; no verification of backup integrity; no WAL-aware copy procedure automated. |
| **Evidence** | Grep over `scripts/` found no backup utility; only installer file copies. |

### F-07 — Manual backup guidance exists (partial positive)

| | |
|--|--|
| **Severity** | N/A (control present, incomplete) |
| **Impact** | Reduces risk if operators read Vietnamese ops doc. Still easy to miss (not in root README). |
| **Evidence** | `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` §8: |

- Paths: `data/alphastudio.db`, `data/uploads`, `data/outputs`, `data/temp`, `.runtime/tools`
- Stop server cleanly before backup so SQLite can checkpoint WAL
- **Minimum backup:** `.env` + entire `data/`; `.runtime` can be reinstalled
- Retention knobs: `TEMP_TTL_MS`, `WORKSPACE_RETENTION_MS`
- Do not run cleanup while jobs/uploads active

### F-08 — Destructive maint paths without backup gate

| | |
|--|--|
| **Severity** | **Medium** |
| **Impact** | `clear --all` removes `data/` and `.runtime/`. `reset` runs `clean` then reinstalls; it is environment recovery, not data restore. There is no “backup first?” prompt beyond operator discipline and `--dry-run` on clear. |
| **Evidence** | `clear.mjs` / `clear-targets.mjs` (`all` → `data`); `reset.mjs` help text. |

**Note:** `clear`/`clean` protect source, lockfiles, `.env`, tests, docs via `PROTECTED_*` in `scripts/maint/lib/paths.mjs` — good safety for code; **not** a substitute for data backup.

---

## 8. Rollback and operational recovery

### 8.1 What exists (recovery, not product rollback)

| Tool | Command | Role | Data-safe? |
|------|---------|------|------------|
| Doctor | `npm run doctor` | Diagnose env, deps, DB, ports, tools | Yes (read-only intent) |
| Clean | `npm run clean` | Remove dist/cache/logs/temp | Yes for workspace DB |
| Clear | `npm run clear` | Broader disposable cleanup | **Partial** — default can remove uploads/outputs; `--all` wipes `data/` |
| Reset | `npm run reset` | clean + `npm ci` + init DB + tools install | **Rebuilds env**; does not restore prior DB content from backup |
| DB repair | `npm run db:repair` | Ensure migrations / cache tables; heal schema | **Intended non-destructive** (does not wipe workspace data by design) |
| Tools repair | `npm run tools:repair` / `tools:install` | Restore portable converters | Yes for app data |
| Python repair | `npm run python:repair` | Venv health | Yes for app data |
| Deps check/prune | `npm run deps:check` / `deps:prune` | Dependency hygiene | Prune can remove devDeps |

These are **operational recovery** tools suitable for “broken install / schema / tools” scenarios. They are **not** versioned application rollback.

### 8.2 Product / code rollback

| Mechanism | Status |
|-----------|--------|
| Git tags for prior releases | **Missing** |
| Documented “checkout previous release + restore data” runbook | **Missing** |
| Stabilize branch safety rules (no force-push main, preserve `ux-ui-redesign`) | **Present** in `docs/stabilize/*` — process, not product ops |
| Checkpoint handoff gates (test/typecheck/build/smoke/commit/push/HEAD equality) | **Present** for stabilize program — human CI substitute |

### F-09 — No formal rollback runbook

| | |
|--|--|
| **Severity** | **Medium** |
| **Impact** | After a bad deploy/update on an operator machine, path is improvised: reinstall from git SHA, hope `data/` intact, `db:repair` if schema breaks. No steps for “restore last backup + pin commit”, WAL restore edge cases, or version mismatch between code and DB schema. |
| **Mitigation** | Short runbook (see §10) + introduce tags when releasing. |

### F-10 — No release tags blocks precise rollback

| | |
|--|--|
| **Severity** | **Medium** |
| **Impact** | Operators must track SHAs manually. Changelog versions cannot be checked out as tags. |
| **Evidence** | Empty tags; version only in files. |

---

## 9. Minimal CI plan (proposal only — do not implement in this pass)

Goal: smallest useful gate on `main` and PRs without requiring full converter runtime or secrets.

### 9.1 Phase A — PR / push smoke (required)

**Trigger:** `pull_request` + `push` to `main` (and optionally `stabilize/**`).

**Runner:** `ubuntu-latest` (add `windows-latest` later if budget allows).

**Steps:**

1. Checkout  
2. Setup Node **20** (matches `engines`)  
3. `npm ci --no-audit --no-fund` (no `runtime:prepare` / no tool downloads)  
4. `npm run typecheck`  
5. `npm run build`  
6. Focused unit/integration: `npm test` **or** a timed subset if full suite is too long/flaky for CI RAM  
7. `npm run test:maint` (fast, no native tool downloads expected)

**Explicitly exclude from Phase A:**

- `npm run bootstrap` / `tools:install` (multi-GB, network, non-deterministic)
- Full Playwright e2e (browser + dual servers; enable in Phase B)
- `test:audit` / `audit:backend` until scripts restored
- `npm audit --audit-level=...` as hard fail until policy decided (optional informational)

### 9.2 Phase B — optional / scheduled

- Playwright: `npm run test:e2e:install` + `npm run test:e2e` with `CI=1`  
- Windows runner matrix for build + `test:maint`  
- Nightly `deps:check` + `npm audit` report  
- Manual `workflow_dispatch` “full tools” job only if caching strategy for `.runtime` is designed

### 9.3 Phase C — release workflow (when ready)

- On tag `v*.*.*`: verify package.json version matches tag; run Phase A; upload build artifact; create GitHub Release notes from `V3_CHANGELOG.md` section  
- Still no need to publish npm

### 9.4 PR template (minimal bullets)

- [ ] Typecheck + build + relevant tests run (or CI green)  
- [ ] If user-facing: version + `V3_CHANGELOG.md` updated together  
- [ ] No secrets committed; `.env` not staged  
- [ ] Data/migration impact noted  
- [ ] Stabilize: single coherent commit / handoff if process branch  

### 9.5 CI dependencies and risks

| Dep / risk | Note |
|------------|------|
| Native modules | `better-sqlite3`, `sharp` need compile toolchain on runner |
| Suite duration / RAM | Server tests sequential; LibreOffice/FFmpeg tests may skip or fail without tools — confirm which tests hard-require binaries |
| Missing `scripts/audit` | Must not be in required job until fixed |
| Secrets | App is local-first; CI should not need API tokens if tests use temp `DATA_DIR` |
| Flakes | Prefer Phase A stable subset before e2e |
| Cost | Dual OS matrix increases minutes |

---

## 10. Minimal backup and rollback plan (proposal only)

### 10.1 Backup (operator)

**When:** Before `clear --all`, `reset`, major upgrades, schema-touching deploys, or on a schedule (e.g. daily) if the instance holds real work.

**What:**

1. Stop server gracefully (allow SQLite WAL checkpoint).  
2. Copy atomically if possible:

   - `.env`  
   - `data/` entire tree (`alphastudio.db`, `-wal`, `-shm` if present, `uploads/`, `outputs/`)  

3. Optional: exclude `data/temp` to shrink backup.  
4. Do **not** require `.runtime` in backup (reinstall via `tools:install`).  
5. Store off-box; name with timestamp + git SHA of running code.

**Script shape (future, not written this pass):** `scripts/maint/backup.mjs` → tar/zip of allowlisted paths; refuse if server lock detected (optional PID/port probe); `--dry-run`.

### 10.2 Restore

1. Stop server.  
2. Replace `data/` (and `.env` if needed) from backup.  
3. Checkout known-good code (tag or SHA).  
4. `npm ci` + `npm run build` (or `reset --skip-install` patterns carefully).  
5. `npm run db:repair` if schema errors.  
6. `npm run doctor` + `tools:check` as needed.  
7. Start and smoke `/api/health`.

### 10.3 Code rollback

1. Introduce annotated tags `vMAJOR.MINOR.PATCH` matching `package.json` + changelog when cutting a release.  
2. Rollback = `git checkout <tag>` (or revert merge) + restore data backup if schema not forward-compatible.  
3. Document schema compatibility: migrations appear additive today; still verify before claiming reverse migration.

### 10.4 Alignment with existing maint tools

| Scenario | Prefer |
|----------|--------|
| Corrupt schema, data intact | `db:repair` |
| Broken tools/binaries | `tools:repair` / `tools:install` |
| Broken node_modules / dist | `clean` then `npm ci` / `build`; or `reset` |
| Need empty workspace | `clear` (with backup first if value remains) |
| Bad release binary/code | Git pin/tag + restore backup if needed — **not** `reset` alone |

---

## 11. Severity-ranked finding register

| ID | Severity | Title |
|----|----------|-------|
| F-01 | **High** | No CI / no `.github/` workflows — tests and builds never auto-enforced |
| F-03 | **High** | Release docs/scripts reference missing `scripts/audit/` |
| F-06 | **High** | No backup script; data loss risk on clear/reset/disk failure |
| F-02 | **Medium** | No PR template / merge checklist |
| F-08 | **Medium** | Destructive maint without backup gate |
| F-09 | **Medium** | No formal product rollback runbook |
| F-10 | **Medium** | No release tags; cannot pin/rollback by version label |
| F-05 | **Low–Medium** | No Dependabot/Renovate |
| F-04 | **Low** | Playwright CI hooks unused |
| — | **Positive** | Version 3.6.0 aligned across packages + changelog |
| — | **Positive** | Strong local maint recovery (doctor/clear/clean/reset/db-repair) |
| — | **Positive** | Manual backup notes in BUILD_AND_RUN §8 |
| — | **Positive** | Stabilize handoff gates define a human CI substitute for process work |

### P0–P4 mapping (stabilize program scale)

| Program sev | Local label | Findings |
|-------------|-------------|----------|
| **P0** | — | None for default loopback app runtime; CI absence is process-critical but not an in-app crash/RCE |
| **P1** | High | F-01 (no CI), F-03 (broken audit script gates), F-06 (no backup script) |
| **P2** | Medium | F-02, F-08, F-09, F-10 |
| **P3** | Low–Medium / Low | F-05, F-04 |
| **P4** | Positive controls | Version alignment; maint recovery tools; manual §8 backup notes |

---

## 12. Dependencies, risks, and unknowns

### Dependencies (for future CI/backup work)

- Node 20+ and npm workspaces / single root lockfile  
- Native compile for `better-sqlite3` and `sharp` on CI images  
- Optional Python only if python tests enter CI  
- Disk budget if tool install ever enters CI (~2–3 GiB)

### Risks

- Enabling full `npm test` without inventory of tool-required tests → flaky red CI  
- Operators treating `reset` as “rollback” and wiping unrecovered state  
- Docs overclaiming release validation (`RUNTIME_VALIDATION.md`, PDF final reports) without CI evidence  
- `ux-ui-redesign` and other long-lived branches merge without gates  

### Unknowns (not verified this pass)

- Whether GitHub remote has Actions enabled, branch protection, or Releases created without local tags  
- Actual wall-clock and failure rate of full `npm test` on clean Ubuntu without `.runtime`  
- Whether any external CI (local Jenkins, Gitea, etc.) exists outside the repo  
- Live schema reverse-compatibility between historical commits and current `data/`  

---

## 13. Explicit non-claims

- This audit **does not** implement CI, tags, backup scripts, or PR templates.  
- This audit **does not** declare the repository stable or releasable.  
- Passing local tests on one developer machine is **not** a substitute for CI.  
- Presence of `release-regressions.test.ts` is **not** a release process.  
- `V3_CHANGELOG.md` versions are **not** proven by git tags.  
- Manual backup prose is **not** proven practiced or automated.  

---

## 14. Recommended next actions (process order)

1. **Fix or remove** broken `test:audit` / `audit:backend` references before any CI includes them.  
2. **Add Phase A GitHub Actions** workflow (typecheck, build, unit/integration, test:maint) — separate implementation checkpoint.  
3. **Add PR template** with version/changelog and gate checklist.  
4. **Tag** current intended baseline when product owners accept it (e.g. `v3.6.0` @ agreed SHA) and document tag = package.json = changelog section.  
5. **Add `scripts/maint/backup.mjs`** (or documented shell one-liner in README) wrapping §8 paths + dry-run.  
6. **Write short rollback runbook** under `docs/` linking tag checkout + data restore + `db:repair` + `doctor`.  
7. Optionally enable branch protection on `main` requiring CI green (GitHub settings; outside repo file tree).  

---

## 15. Artifact checklist for this audit

| Item | Result |
|------|--------|
| Verified `.github/` | **Absent** |
| Verified release tags | **None** |
| Verified backup scripts | **None** |
| Verified rollback docs | **No dedicated product runbook**; partial ops + stabilize git policy |
| Verified PR templates | **Absent** |
| `package.json` version | **3.6.0** (root + server) |
| `V3_CHANGELOG.md` | **Present**, top **v3.6.0** |
| Maint recovery | **reset / clear / clean / db-repair / doctor** present |
| CI stood up | **No** (by design for this pass) |
| Product code changed | **No** |

---

*End of audit 08 — CI / release / backup / rollback.*
