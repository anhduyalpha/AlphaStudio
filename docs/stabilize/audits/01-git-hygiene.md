# Audit: Git history, branch safety, hygiene

**Auditor:** independent git-hygiene pass  
**Date:** 2026-07-24  
**Repo path:** `C:\Users\Duy\Code\Project\AlphaStudio`  
**Remote:** `origin` → `https://github.com/anhduyalpha/AlphaStudio.git`  
**Audit HEAD:** `stabilize/alphastudio-stable-baseline` @ `ed460ee763663eef3f0aae9080eeb5e15c68fe1c`  
**Method note:** Prefer read-only inspection of `.git/*`, tracked trees via GitHub API, and existing local files. No force-push, no branch delete, no destructive checkout. Local shell `git status`/`git log` were not available in this auditor session; evidence below is still concrete (refs, reflogs, API payloads, tracked trees).

---

## Scope

In scope:

- Git history hygiene (commit style, reset/placeholder, merge lineage)
- Branch safety (local/remote tips, merge-base, upstream tracking, unpushed work)
- Repository hygiene (`.gitignore`, `.gitattributes`, large/binary tracking, secrets, hooks, tags, branch protection cues)
- Remote topology and orphaned / stale refs
- What must **not** be lost (`ux-ui-redesign` 37 commits)

Out of scope:

- Product code changes under `server/src/`, `src/`, `python/`, package deps
- CI implementation details beyond “absent / present”
- Functional correctness of RUNTIME_VALIDATION.md claims (explicitly not trusted without re-evidence)

---

## Method / commands run

### Local filesystem / git metadata (read-only)

| Evidence source | Purpose |
|-----------------|---------|
| `.git/HEAD` | Current branch |
| `.git/config` | remotes, branch upstreams |
| `.git/refs/heads/*`, `.git/refs/remotes/origin/*` | Tip SHAs |
| `.git/packed-refs` | Packed remote tips (stale vs loose) |
| `.git/logs/HEAD`, `.git/logs/refs/heads/*` | Reflog: create/checkout/reset/commit sequence |
| `.git/FETCH_HEAD` | Last fetch remote branch set |
| `.git/COMMIT_EDITMSG` | Last commit message buffer |
| `.git/refs/tags/` (empty) | Tags |
| `.git/hooks/*.sample` only | No active hooks |
| `.git/info/exclude` | Default empty excludes |
| `.gitignore`, `.gitattributes`, `.npmrc`, `.env`, `.env.example` | Hygiene config + local secrets |
| Workspace inventory (`data/`, `node_modules/`, `docs/stabilize/`, screenshots leftovers) | Untracked runtime vs tracked |

### Remote / API (read-only)

| Call | Purpose |
|------|---------|
| `GET https://api.github.com/repos/anhduyalpha/AlphaStudio` | visibility, size, default branch, license |
| `GET .../branches?per_page=100` | remote branches + protection flags |
| `GET .../branches/main` | protection object for `main` |
| `GET .../tags` | release tags |
| `GET .../git/trees/ed460ee...?recursive=1` | tracked files on `main` / stabilize base |
| `GET .../git/trees/d03497f...?recursive=1` | tracked files on `ux-ui-redesign` (binaries) |
| `GET .../compare/main...ux-ui-redesign` | ahead/behind, merge-base, 37 commits |
| `GET .../commits?sha=main&per_page=30` | main history sample, signed merges |
| `GET .../contents/?ref=main` | root listing (no `.github/`) |

Equivalent commands an operator would re-run for proof:

```text
git rev-parse --abbrev-ref HEAD
git rev-parse HEAD main ux-ui-redesign stabilize/alphastudio-stable-baseline
git rev-parse origin/main origin/ux-ui-redesign
git merge-base main ux-ui-redesign
git rev-list --left-right --count main...ux-ui-redesign
git branch -vv
git remote -v
git tag
git status --short
git stash list
git ls-files .env data node_modules
git check-ignore -v .env data/alphastudio.db node_modules
git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)'
# GitHub: branch protection UI / API for main, ux-ui-redesign
```

---

## Evidence citations

### Topology (verified)

| Ref | SHA | Notes |
|-----|-----|-------|
| `HEAD` | `ref: refs/heads/stabilize/alphastudio-stable-baseline` | Checked out stabilize branch |
| `stabilize/alphastudio-stable-baseline` | `ed460ee763663eef3f0aae9080eeb5e15c68fe1c` | Created from `main` (reflog) |
| `main` | `ed460ee763663eef3f0aae9080eeb5e15c68fe1c` | Matches `origin/main` loose ref |
| `origin/main` | `ed460ee763663eef3f0aae9080eeb5e15c68fe1c` | Loose ref; see packed-refs note |
| `ux-ui-redesign` | `d03497f77083a42e6461db34fb24724f8e76854d` | Local tip |
| `origin/ux-ui-redesign` | `d03497f77083a42e6461db34fb24724f8e76854d` | Matches local |
| Merge-base `main`…`ux-ui-redesign` | `ed460ee…` | Compare API: `ahead_by: 37`, `behind_by: 0` |
| Tags | **none** | `.git/refs/tags` empty; API `tags: []` |
| Stash | **none** | no `.git/logs/refs/stash` |
| Default branch | `main` | GitHub repo metadata |

### Remote branches (API + FETCH_HEAD)

Present on `origin` (2026-07-24):

1. `main` @ `ed460ee…` — `protected: false`
2. `ux-ui-redesign` @ `d03497f…` — `protected: false`
3. `feature/converter-phase-1-engine-registry` @ `b7eb754…` — `protected: false`
4. `features/python-runtime` @ `2d4a653…` — `protected: false` (merged into main via PR #3 @ `5699274…`, branch still exists)

`features/pdftools` not present remotely (merged via PR #2 @ `de14e5f…`).

### Upstream tracking (`.git/config`)

```ini
[remote "origin"]
	url = https://github.com/anhduyalpha/AlphaStudio.git
	fetch = +refs/heads/*:refs/remotes/origin/*
[branch "main"]
	remote = origin
	merge = refs/heads/main
[branch "ux-ui-redesign"]
	remote = origin
	merge = refs/heads/ux-ui-redesign
```

**Missing:** no `[branch "stabilize/alphastudio-stable-baseline"]` upstream section. Branch is **local-only** until first normal push with `-u`.

### Reflog safety highlights

- Stabilize create: `branch: Created from main` → tip `ed460ee…` (`.git/logs/refs/heads/stabilize/alphastudio-stable-baseline`).
- Checkout path preserved `ux-ui-redesign` tip: last ux commit then `checkout: moving from ux-ui-redesign to main` then to stabilize — **no hard-reset of redesign tip**.
- On `ux-ui-redesign`, one intentional soft undo: `commit: placeholder` → `reset: moving to HEAD~1` (removes placeholder from branch tip; object may remain dangling locally).
- Many same-second commits during redesign phases (automation/agent batching).

### `.gitignore` (root)

Ignores (among others): `node_modules/`, `server/node_modules/`, `dist/`, `server/dist/`, `data/`, `data-test/`, `data-test-*/`, `data-smoke/`, `.tools/`, `.runtime/`, `.env`, `*.log`, `coverage/`, `audit/`, `python/**/__pycache__/`, `*.pyc`, `server/package-lock.json`.

Does **not** ignore: `docs/ux-ui-redesign/screenshots/**`, `*.png` screenshots, `mcps/`, process state JSON files that appear only on redesign branch (`.ux-ui-redesign-state.json`, `.converter-complete-state.json`).

### `.gitattributes`

```text
fixtures/pdf/*.pdf binary
```

Only PDF fixtures marked binary. No LFS filters. PNGs under redesign screenshots use default text/diff heuristics (binary-ish blobs still stored as full objects).

### Tracked tree on `main` / stabilize base (`ed460ee`)

- **Present:** source, server, python, scripts, fixtures (small PDFs; largest ~114 KiB `fixtures/pdf/large-205-pages.pdf`), `package-lock.json` (~196 KiB), `public/` brand assets, `mcps/**` tool JSON schemas, `.env.example`.
- **Absent (good):** `.env`, `data/`, `node_modules/`, `.github/`, Docker/compose at root, large redesign screenshot trees.
- **Local untracked/runtime (present on disk, not in main tree):** `data/` (SQLite + uploads/outputs), `node_modules/`, `.env` (defaults only; tokens commented), `data-test-ratelimit/`, `docs/stabilize/**` (process artifacts for this program), residual `docs/ux-ui-redesign/screenshots/baseline/` directory left in workspace after branch switch.

### Tracked tree on `ux-ui-redesign` (`d03497f`) — large binary evidence

Under `docs/ux-ui-redesign/screenshots/` many full-page PNGs, routinely **~250–750 KiB each**, e.g.:

- `.../after-corrective/converter/1920.png` size **733810**
- `.../after-corrective/dashboard/1920.png` size **687762**
- `.../baseline-corrective/archive/1920.png` size **746964**
- `.../baseline-corrective/audio/1920.png` size **746763**

Multiple viewport sets × multiple screens × multiple capture rounds → primary driver of GitHub `size: 68066` (~**66 MiB** repo weight). **No Git LFS**.

### Secrets / sensitive content

| Item | Status |
|------|--------|
| `.env` tracked? | **No** (ignored; not in main tree) |
| Local `.env` contents | Mirrors `.env.example`; `API_AUTH_TOKEN` / `VITE_API_TOKEN` **commented placeholders** — no live secret observed |
| Test PDF password | `fixtures/pdf/manifest.json` documents fixture password `"alphastudio"` for `encrypted-password-alpha.pdf` — intentional test fixture, not production secret |
| Author email in commits | Mix of `110324461+anhduyalpha@users.noreply.github.com` and personal `duydang0768134698@gmail.com` (public repo → email disclosure) |
| Signed commits | GitHub merge commits (PR #2, #3) GitHub-signed; most direct commits **unsigned** |

### Branch protection

GitHub API for `main`:

```json
"protected": false,
"protection": {
  "enabled": false,
  "required_status_checks": { "enforcement_level": "off", "contexts": [] }
}
```

All listed branches report `protected: false`. Public repo, no license field set.

### History style (sample)

- `main`: short conventional messages (`fix:`, `docs:`, `feat(…)`) + GitHub merge commits.
- `ux-ui-redesign`: 37 linear commits with program prefixes (`[ux-ui-redesign:phase-N]`, `corrective-*`, `rq-*`, `converter:*`); several near-empty “phase-9 complete” follow-ups in same minute (noise, not data loss).

---

## Findings (P0–P4)

| ID | Sev | Finding | Location / evidence | Impact |
|----|-----|---------|---------------------|--------|
| GH-01 | **P1** | **No branch protection on `main` (or any branch)** | GitHub API `branches/main` → `protected: false`; all four remote branches unprotected | Anyone with write access (or compromised token) can force-push / delete `main` or rewrite history; no required reviews/status checks |
| GH-02 | **P1** | **`ux-ui-redesign` holds 37 unmerged commits with substantial product+UI work; tip is recoverable remotely but unprotected** | Compare `main...ux-ui-redesign`: `ahead_by: 37`, merge-base `ed460ee`; remote tip `d03497f`; `protected: false` | Accidental remote branch delete or force-push loses redesign/converter residual work; process policy must treat this branch as **do-not-delete** until archive/merge decision |
| GH-03 | **P1** | **Large binary screenshot trees committed without LFS on `ux-ui-redesign`** | Tree `d03497f`: many PNGs 250–750 KiB under `docs/ux-ui-redesign/screenshots/**`; repo size ~66 MiB | Clone/fetch bloat permanently in history; merge to `main` would drag binaries into default branch; future history rewrites painful |
| GH-04 | **P2** | **`stabilize/alphastudio-stable-baseline` has no upstream and is not on origin** | `.git/config` lacks branch section; remote branch list has no `stabilize/*` | Process work only local until push; machine loss = process artifact loss; also risk of diverging from main without tracking |
| GH-05 | **P2** | **No tags / no release anchors** | Empty tags; API `[]` | Cannot pin “known good” baseline by tag; stabilize program must invent its own tagging policy later |
| GH-06 | **P2** | **No `.github/` workflows / no in-repo CI gates** | Main root listing has no `.github`; TOPOLOGY/STATE also note absence | Nothing prevents broken main merges; complements GH-01 |
| GH-07 | **P2** | **Author identity inconsistency + personal email on public history** | Commits on redesign use `duydang0768134698@gmail.com`; some main commits use noreply | Privacy leak; harder commit signing/CLA hygiene; not a secret leak of tokens |
| GH-08 | **P2** | **Stale packed-refs entry for `origin/main`** | `packed-refs` still lists `de14e5f… refs/remotes/origin/main` while loose ref is `ed460ee…` | Low operational risk (loose wins) but confuses tooling/scripts that read packed-refs only; prune/pack hygiene |
| GH-09 | **P2** | **`.gitattributes` incomplete for binaries actually stored** | Only `fixtures/pdf/*.pdf binary`; PNGs and other media unannotated; no LFS | Diff noise, merge pain, no pointer-based storage policy |
| GH-10 | **P3** | **Commit noise on redesign (placeholder + multi phase-9 microcommits)** | Reflog: `placeholder` then `reset HEAD~1`; multiple consecutive identical subject lines for phase-9 | History harder to review; not data-loss if tip preserved |
| GH-11 | **P3** | **`mcps/**` tool descriptor JSON tracked on `main`** | Tree paths under `mcps/codegraph`, `codebase-memory`, `neon`, `tasks` | Clutters product repo; not secrets observed; may be intentional for agent tooling — confirm ownership |
| GH-12 | **P3** | **Stale remote feature branches after merge** | `features/python-runtime` still at merge tip `2d4a653`; converter registry branch `b7eb754` unmerged relative to main | Branch inventory clutter; risk of accidental checkouts of outdated work |
| GH-13 | **P3** | **Local residual untracked dirs after branch switches** | Working tree contains `docs/ux-ui-redesign/screenshots/baseline/` while HEAD is stabilize@main; also process `docs/stabilize/**`, runtime `data/`, `node_modules/` | Operator confusion; risk of accidental `git add` of screenshots if ignore rules not extended before redesign merge |
| GH-14 | **P3** | **No active git hooks** | Only `*.sample` under `.git/hooks` | No local secret-scan / commit-msg lint; relies entirely on human discipline |
| GH-15 | **P4** | **Test fixture password documented in repo** | `fixtures/pdf/manifest.json` → `"password": "alphastudio"` | Expected for encrypted fixture; ensure never reused as real secret |
| GH-16 | **P4** | **Unsigned day-to-day commits** | Most non-PR commits `verification.verified: false` | Weaker supply-chain story; optional for single-dev public repo |
| GH-17 | **P4** | **`.gitignore` gaps for future screenshot/process files** | No ignore for `docs/**/screenshots/**`, `*.webm`, Playwright output dirs beyond listed | Next redesign wave may reintroduce binary bloat if not gated |

### Explicit non-findings (positive hygiene)

| Area | Observation |
|------|-------------|
| `.env` not tracked | Correct ignore; not in `ed460ee` tree |
| `data/` not tracked | Runtime SQLite/uploads/outputs local only |
| `node_modules/` not tracked | Correct |
| `main` == `origin/main` | Both `ed460ee…` |
| Stabilize base == main tip | Safe create point |
| Merge-base clean | Redesign is pure ahead-of-main (no divergent main commits to rebase yet) |
| No stash backlog | Clean stash state |
| No force-push evidence in available reflogs for redesign tip | Tip still matches origin |

### Severity summary

- **P0:** none observed in this pass (no confirmed secret in history, no lost redesign tip, no tracking of `.env`/`data`/`node_modules` on main).
- **P1:** GH-01, GH-02, GH-03 (protection + preserve redesign + binary bloat risk).
- **P2:** GH-04–GH-09.
- **P3:** GH-10–GH-14.
- **P4:** GH-15–GH-17.

---

## Proposed implementation plan (ordered small steps)

These steps are **git/hygiene-only** recommendations for the stabilize program. Do **not** rewrite public history without an explicit owner decision.

### Step 1 — Freeze branch safety policy (process, no code)

1. Document in stabilize STATE: never delete/force-push `ux-ui-redesign`, `main`, or `stabilize/*`.
2. Prefer `git switch` / `git switch -c` over `checkout -f`.
3. Before any checkout of redesign, ensure process commits on stabilize are committed or stashed.

### Step 2 — Publish stabilize branch (normal push only)

```text
git switch stabilize/alphastudio-stable-baseline
git push -u origin stabilize/alphastudio-stable-baseline
git rev-parse HEAD
git rev-parse origin/stabilize/alphastudio-stable-baseline
# prove equal
```

### Step 3 — Enable GitHub branch protection (owner UI/API)

Minimum for `main` (and ideally `stabilize/alphastudio-stable-baseline` once pushed):

- Disallow force-push
- Disallow deletion
- Require PR (even if solo: self-review gate) **or** at least block direct force
- Optional later: required status checks when CI exists

For `ux-ui-redesign`: **disallow deletion + force-push** until merge/archive decision.

### Step 4 — Binary / LFS / screenshot policy (before any redesign merge)

1. Decide: keep screenshots in git **or** move to release assets / LFS / external store.
2. If keep short-term: mark `docs/**/screenshots/**/*.png binary` in `.gitattributes`.
3. If remove from default branch path: do **not** merge screenshot-heavy trees into `main` without filter; consider `git filter-repo` only as a planned migration on a throwaway clone.
4. Extend `.gitignore` for local capture dirs if screenshots become non-tracked evidence.

### Step 5 — Ignore / attributes hardening (small PR on stabilize)

1. Confirm `.env`, `data/`, `node_modules/` remain ignored (already OK).
2. Add ignores for common agent/tool noise if desired: Playwright output, local screenshot dumps, OS junk already partly covered.
3. Expand `.gitattributes` for known binaries (`*.png`, `*.jpg`, `*.wav`, fixtures).

### Step 6 — Identity hygiene (forward-only)

1. Set `user.email` to GitHub noreply for future commits.
2. Do **not** mass-rewrite past commits solely for email unless privacy mandate (rewrites break SHAs for all remotes).

### Step 7 — Tag baseline after stabilize program proves green

```text
git tag -a alphastudio-stable-v0 -m "First stabilize baseline after audit gates"
git push origin alphastudio-stable-v0
```

Only after tests/build gates (other audits), not at this audit alone.

### Step 8 — Remote branch inventory cleanup (after decisions)

1. Keep `ux-ui-redesign` until merge or explicit archive tag + documented deletion.
2. Optionally delete `features/python-runtime` after confirming fully contained in `main` (merge commit `5699274` already on main).
3. Review `feature/converter-phase-1-engine-registry` vs redesign converter commits before delete.

### Step 9 — Optional secret scan of full history

Run offline (operator machine):

```text
git log -p --all -S 'API_AUTH_TOKEN' -- .
# or gitleaks / trufflehog against full clone
```

This pass did **not** exhaustively scan every historical blob.

### Step 10 — Pack/ref hygiene

```text
git fetch --prune
git remote prune origin
git gc --prune=now   # only if comfortable; local only
```

Addresses stale packed `origin/main` and gone remote-tracking confusion noted in TOPOLOGY.

---

## Dependencies

| Dependency | Why |
|------------|-----|
| GitHub repo admin rights | Enable branch protection, manage branch deletes |
| Network to `origin` | Push stabilize; fetch/prune |
| Decision owner for redesign merge strategy | Affects whether screenshot binaries ever enter `main` |
| CI/audit 08 (CI/release) | Status checks for protection rules |
| Other stabilize audits (tests, security) | Must pass before “stable” tags |
| Optional: Git LFS install on all developer machines | Only if LFS policy chosen |

---

## Risks

| Risk | Mitigation |
|------|------------|
| Force-push `main` or `ux-ui-redesign` | Branch protection + policy; never use `--force` on shared branches |
| Losing redesign work by deleting local-only recovery paths | Remote tip currently equals local `d03497f`; still tag archive before any delete |
| Merging redesign into main without binary policy | Gate merge on screenshot decision (GH-03) |
| Accidental `git add -A` of `data/` or `.env` if ignore broken | Keep ignores; pre-commit optional later |
| History rewrite “to clean screenshots” | Only on coordinated migration; never casual `filter-branch` on sole clone |
| Stabilize remains unpushed (GH-04) | Step 2 normal push with upstream |
| Public personal email already in history | Accept or rewrite with full awareness of SHA changes |

---

## Unknowns

1. **Full historical secret scan** not run (only current trees + sample history + local `.env` review).
2. **Whether GitHub secret scanning / Dependabot** is enabled at org/user level (API not fully available without auth).
3. **Exact byte sum of all screenshot blobs** (many large PNGs confirmed; aggregate not computed via `git rev-list --objects`).
4. **Why `mcps/` is committed** — product requirement vs accidental agent dump.
5. **Intent of `feature/converter-phase-1-engine-registry`** relative to redesign converter commits (overlap unknown without content audit).
6. **Local `docs/ux-ui-redesign/screenshots/baseline/` residual** — leftover untracked vs incomplete clean after switch; not in main tree.
7. **Whether TOPOLOGY’s `[gone]` note for `origin/ux-ui-redesign` still reproduces** after fetch — this pass still sees remote branch live via API and loose ref.
8. **Working tree cleanliness right now** may include untracked stabilize process files (expected during audit pass); not re-verified with `git status` binary.

---

## Explicit non-claims

This audit does **not** claim:

- That the application is “stable,” production-ready, or that tests pass.
- That `RUNTIME_VALIDATION.md` or any PDF “final report” is correct without re-running commands.
- That no secret has **ever** been committed historically (only that current `main` tip tree does not track `.env`/`data`/`node_modules`, and local `.env` currently has no live tokens).
- That branch protection was “configured” simply because GitHub exists.
- That `ux-ui-redesign` is merge-ready (binary bloat and product review are separate).
- That force-push never occurred in the distant past (only available reflogs/API tips inspected).
- Completeness of large-object inventory without `git rev-list --objects` operator re-run.
- License, security, or vulnerability status of dependencies.

---

## Appendix A — Ref map (short SHAs)

```text
main / origin/main / stabilize tip:
  ed460ee763663eef3f0aae9080eeb5e15c68fe1c

ux-ui-redesign / origin/ux-ui-redesign:
  d03497f77083a42e6461db34fb24724f8e76854d

features/python-runtime (remote, merged):
  2d4a653905a7399d30497aef4fc16f75f160b28d

feature/converter-phase-1-engine-registry (remote):
  b7eb75469d4fbe659051948d349024eb3a8ef1f5

packed-refs stale origin/main (superseded by loose):
  de14e5f900daa76bcb39be0f7d0adf4935eea855
```

## Appendix B — Cross-links

- Topology narrative: `docs/stabilize/TOPOLOGY.md`
- Process state: `docs/stabilize/STATE.md`
- Handoff rules: `docs/stabilize/HANDOFF_FORMAT.md`
