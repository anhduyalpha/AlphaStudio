# Audit 09 — Clean-clone reproducibility hygiene

| Field | Value |
|-------|--------|
| **Program** | AlphaStudio stable baseline |
| **Scope ID** | Clean-clone reproducibility blockers only |
| **Audit date** | 2026-07-24 |
| **Branch** | `stabilize/alphastudio-stable-baseline` |
| **Audit HEAD (local tip at write)** | `c48bca1c35173c7710b76db59c3666ccc1745079` |
| **Product base SHA (stabilize create)** | `ed460ee763663eef3f0aae9080eeb5e15c68fe1c` |
| **Auditor stance** | Read-mostly; **no product fixes**; this file is the only allowed write |
| **Product code modified** | **None** |

---

## 1. Executive summary

A clean clone of AlphaStudio can install Node deps, typecheck, and compile **without** `.runtime/`, `.env`, or a pre-existing `data/` tree — but several **documented gates and test entrypoints are broken or untracked**, so “clone → bootstrap/gates green” is **not** currently reproducible.

**Top blockers (this scope):**

| ID | Sev | One-line |
|----|-----|----------|
| CC-01 | **P0** | `npm run test:audit` / `audit:backend` point at **missing** `scripts/audit/` |
| CC-02 | **P0** | Docs (`RUNTIME_VALIDATION.md`, BUILD §6) claim those gates passed / required |
| CC-03 | **P1** | `.gitignore` ignores entire `audit/` while tests require `audit/fixtures/*` |
| CC-04 | **P1** | `test:maint` asserts `predev`/`prebuild`/`prestart` scripts that **do not exist** |
| CC-05 | **P1** | BUILD doc claims `dev`/`build`/`start` always run full runtime prepare; code does not |

**What still works on a honest clean path (expected):**

```text
git clone …
npm ci --no-audit --no-fund
npm run typecheck
npm run build
# optional: copy .env.example → .env
npm start   # creates data/ + SQLite on first boot; no .runtime required for core API
```

Full converter tools, Python, Playwright browsers, and several test suites are **extra** and have separate failure modes (below).

---

## 2. Scope and out of scope

### In scope

- `package.json` scripts that target missing paths
- `audit/` gitignore vs tests/fixtures consumers
- Root lockfile / workspace consistency (static)
- Minimum tracked tree for `npm ci` + `typecheck` + `build`
- Core server startup without `.runtime` (`server/src/index.ts`, `config.ts` `DATA_DIR`)
- Fresh DB init (`initDb`, migrations, `db-repair.mjs`)
- Docs that claim broken gates

### Out of scope (do not expand)

- Implementing fixes (CP1 product work)
- Security deep-dive, CI design beyond “gates break clean clone”
- Full tool-download correctness (audit 05)
- Platform matrix (audit 06)
- Declaring the product stable

---

## 3. Method / evidence sources

| Source | Use |
|--------|-----|
| Root `package.json`, `server/package.json`, `package-lock.json` (header + workspace link) | Scripts, workspaces, lock shape |
| `.gitignore` | `audit/`, `data/`, `.runtime/`, `server/package-lock.json` |
| `scripts/` inventory | Presence/absence of `scripts/audit/` |
| `audit/fixtures/` local tree | Present on this workstation only (gitignored) |
| `server/src/index.ts`, `config.ts`, `lib/paths.ts`, `db/index.ts`, `db/migrations.ts` | Startup + DB |
| `scripts/maint/db-repair.mjs`, `reset.mjs`, `bench-startup.mjs` | Repair/reset/fixture refs |
| `scripts/maint/tests/maint-core.test.mjs` | Contract assertions vs real scripts |
| `server/tests/detect.test.ts`, `helpers.test.ts` | Fixture path deps |
| `README.md`, `docs/BUILD_AND_RUN_WINDOWS_LINUX.md`, `RUNTIME_VALIDATION.md` | Doc claims |
| Prior stabilize audits 01/04/05/08, `STATE.md`, `MASTER_PLAN.md` | Cross-check (not re-proved by re-run) |

**Not executed this pass (honest unknowns):** full cold `npm ci` on empty machine, full `npm test`, full `bootstrap` tool download. Static evidence is sufficient for path/gitignore/script-missing findings.

---

## 4. Inventory: clean-clone surfaces

### 4.1 Gitignored vs local-only vs tracked

| Path | Tracked? | Notes |
|------|----------|-------|
| `package.json`, `package-lock.json`, `server/package.json` | Yes (expected) | Single root lock; workspaces `["server"]` |
| `server/package-lock.json` | **Ignored** if present | Comment: obsolete under workspaces |
| `server/src/**`, `src/**`, `public/**`, `python/**`, `scripts/**` (minus missing audit) | Yes | Core product |
| `fixtures/pdf/**` | Yes | Binary via `.gitattributes`; used by e2e / PDF fixture scripts |
| `server/tests/fixtures/**` | Yes | Converter probe text fixtures |
| `audit/**` | **Ignored** (`.gitignore` line `audit/`) | Local workstation has `audit/fixtures/sample.{jpg,pdf,png,txt,wav}` only |
| `scripts/audit/**` | **Absent** from tree | No directory under `scripts/` |
| `data/`, `data-test*/`, `.runtime/`, `.tools/`, `dist/`, `server/dist/`, `node_modules/` | Ignored | Created by install/run |
| `.env` | Ignored | `.env.example` is the tracked template |

### 4.2 npm scripts → path existence

| Script | Command target | Path exists? | Clean-clone result |
|--------|----------------|--------------|--------------------|
| `bootstrap` | `npm ci` + `runtime:prepare` | scripts present | Works if network + disk for tools; **not** required for typecheck/build |
| `runtime:prepare` / `tools:*` | `scripts/maint/tools.mjs` | Yes | Needs network/disk; optional for core |
| `dev` / `dev:client` / `dev:server` | vite / workspace `dev` | Yes | No auto tool install |
| `build` / `typecheck` / `start` / `test` | present tools | Yes | `test` fails partial suites if fixtures missing |
| **`test:audit`** | `scripts/audit/tests/*.test.mjs` | **No** | **Hard fail** (empty/missing glob / ENOENT) |
| **`audit:backend`** | `scripts/audit/backend.mjs` | **No** | **Hard fail** |
| `test:maint` | `scripts/maint/tests/*.test.mjs` | Yes | **Logic fail** on missing `predev`/`prebuild`/`prestart` |
| `fixtures:pdf` / `fixtures:pdf:verify` | `scripts/test/*` + `fixtures/pdf` | Yes | OK if tracked fixtures intact |
| `db:repair` | `scripts/maint/db-repair.mjs` | Yes | Partial fallback if no `server/dist` (see §7) |
| `setup:tools` | `scripts/setup-tools.mjs` | Yes | Present |
| `check:tools` / `repair:tools` | maint tools | Yes | Aliases to full profile |
| `benchmark:*` | root `scripts/benchmark-*.mjs` | Yes | Optional |

---

## 5. Findings (P0–P4)

Severity: **P0** blocks claimed gates / immediate clean-clone honesty · **P1** clean-clone test or docs contract break · **P2** repair/ops partial · **P3** doc drift · **P4** polish.

### CC-01 — P0: Broken audit npm entrypoints

**Evidence**

- Root `package.json`:
  - `"test:audit": "node --test scripts/audit/tests/*.test.mjs"`
  - `"audit:backend": "node scripts/audit/backend.mjs"`
- `scripts/` listing: `maint/`, `test/`, benchmarks, `setup-tools.mjs`, `check-tools.mjs`, `repair-tools.mjs` — **no `audit/`**.
- Cross-confirmed in audits 04/05/08, `TOPOLOGY.md`, `STATE.md` CP1.

**Impact**

Any operator or future CI job that runs the pre-prod checklist fails immediately. Cannot re-validate historical “audit green” claims.

**Repair direction (scope only — not implemented)**

Prefer **remove/replace** scripts with honest commands (`doctor`, focused tests) unless history recovery of `scripts/audit/` is trivial and still wanted.

---

### CC-02 — P0: Docs claim broken gates as green / required

**Evidence**

| Doc | Claim | Reality |
|-----|-------|---------|
| `RUNTIME_VALIDATION.md` | `test:audit` 4/4; `audit:backend` 0 issues; evidence under `audit/logs/*.json` | Scripts + logs path under gitignored `audit/` — **not re-runnable from clone** |
| `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` §6 | Pre-prod list includes `test:audit` + `audit:backend`; read `audit/backend-audit.json` | Targets missing |
| `docs/CONVERTER_PHASE_1_PLAN.md` | Mentions `npm run test:audit` | Same |

**Impact**

False confidence; stabilize process already marks these claims invalid (`MASTER_PLAN` XR-01). Clean-clone “release validation” cannot match the document.

**Repair direction**

Strip or rewrite claims to “historical, not re-verified”; remove broken steps from BUILD §6 until scripts exist.

---

### CC-03 — P1: `audit/fixtures` required by tests but entire `audit/` is gitignored

**Evidence**

- `.gitignore` contains `audit/`.
- `server/tests/detect.test.ts`:

```text
const fixtures = path.join(root, 'audit', 'fixtures');
// sample.png | sample.pdf | sample.txt | sample.wav
```

- `server/tests/helpers.test.ts`:

```text
const samplePng = path.join(root, 'audit', 'fixtures', 'sample.png');
assert.ok(fs.existsSync(samplePng), 'fixture sample.png required');
```

- Local workspace currently has five sample files under `audit/fixtures/`; a pure clone after ignore rules does **not** ship them.
- Also referenced by `scripts/maint/bench-startup.mjs` (`defaultUploadFixture` looks under `audit/fixtures/`).

**Contrast (healthy):** `fixtures/pdf/**` and `server/tests/fixtures/**` are committed and used by PDF/e2e/converter-engine tests.

**Impact**

Clean clone → `npm test` fails detect/fingerprint suites even when product code is fine. Fixtures are “developer laptop state.”

**Repair direction**

1. Relocate samples to e.g. `fixtures/sample/` (tracked), **or**
2. Change `.gitignore` to ignore only generated audit outputs (`audit/logs/`, `audit/*.json`) while tracking `audit/fixtures/**`, **and**
3. Point tests + bench-startup at the tracked path.

---

### CC-04 — P1: `test:maint` contract asserts missing lifecycle scripts

**Evidence**

`scripts/maint/tests/maint-core.test.mjs`:

```js
for (const name of ['predev', 'prebuild', 'prestart']) {
  assert.equal(pkg.scripts[name], 'npm run runtime:prepare');
}
```

Root `package.json` **has no** `predev` / `prebuild` / `prestart`. Only:

```text
bootstrap → npm ci && runtime:prepare
runtime:prepare → tools.mjs install --profile full
```

`dev` / `build` / `start` do not install tools (README agrees; BUILD does not — see CC-05).

**Impact**

`npm run test:maint` is **red on current tree** regardless of fixtures. Clean-clone “maintenance suite green” is false.

**Repair direction**

Either restore the three `pre*` scripts **or** update the maint test + BUILD docs to match intentional “tools are opt-in after `npm ci`” contract (README’s model). Prefer **one** honest contract.

---

### CC-05 — P1: BUILD_AND_RUN runtime-prepare claim vs package.json / README

**Evidence**

- BUILD §2: claims `bootstrap`, **`dev`, `build`, and `start`** all call full runtime prepare.
- `package.json`: only `bootstrap` chains `runtime:prepare`.
- `README.md`: explicitly states `dev`/`build`/`start` do **not** auto-install tools; use `runtime:prepare` separately.

**Impact**

Operators following BUILD expect multi-GB tool install on every `npm run build`; operators following README get a lighter path. Clean-clone mental model is split; maintenance tests encode the BUILD side while scripts encode the README side.

---

### CC-06 — P2: `db:repair` without `server/dist` is a partial heal, not full migrations

**Evidence**

`scripts/maint/db-repair.mjs`:

1. Prefers `server/dist/db/index.js` → `repairDb`.
2. Skips `.ts` without tsx.
3. **Standalone fallback** creates only `schema_migrations`, `detect_cache`, `job_result_cache` (and a thinner `job_result_cache` without `result_json` in the fallback DDL snippet).
4. Does **not** run `LEGACY_SCHEMA` + full `runMigrations` v1–… from `server/src/db/migrations.ts`.

**Contrast — real first boot**

`server/src/index.ts` → `ensureDataDirs()` → `initDb()`:

- Creates parent of `DB_PATH` (`config.dbPath` default `./data/alphastudio.db`)
- `LEGACY_SCHEMA` (jobs, activity, profile, settings, uploads)
- `runMigrations(db)` (workspaces/files/caches/leases/upload sessions/…)
- `ensureRequiredTables(db)` heal
- Profile/settings seeds + interrupted job/upload recovery

**Impact**

Fresh clone that runs **only** `npm run db:repair` before any server build/start does **not** produce a fully migrated production schema. Safe path remains: build (optional for `tsx`/`dist`) then **start server once** or use `reset`’s tsx-based init path.

---

### CC-07 — P2: `reset` DB init soft-fails without `tsx`

**Evidence**

`scripts/maint/reset.mjs` prefers `server/node_modules/tsx/...` (workspace hoist may place tsx under root `node_modules` instead — path is `server/node_modules/tsx`). On miss: creates empty data dirs only and prints “Start server once to fully init DB.”

**Impact**

After `npm ci` under modern workspaces, nested `server/node_modules/tsx` may be absent; reset may skip real `initDb` even though `tsx` exists at root. Clean-clone `reset` is not fully reliable as a one-shot DB bootstrap without starting the server.

---

### CC-08 — P3: Core startup does not need `.runtime` (positive finding)

**Evidence**

- `config.ts`: `dataDir` / `dbPath` from env or `./data`; loads optional root `.env` via dotenv.
- `index.ts`: `assertSafeBindHost` → `ensureDataDirs` → `initDb` → listen → `startWorkerPool` → deferred `detectCapabilities`.
- `app.ts`: serves `../../dist/` only if `SERVE_FRONTEND` and `index.html` exist; else API JSON root.
- Tool registry uses `.runtime` for **portable binaries**; missing tools degrade to unavailable capabilities, not crash-on-start (product design; README “App only” path).

**Impact (positive)**

Clean clone + `npm ci` + `build` + `start` is enough for API + SQLite + native Node features (Sharp, pdf-lib, QR). External converters optional.

**Caveat**

Production UI needs client `dist/` (`npm run build:client`). Default loopback bind works without `API_AUTH_TOKEN`.

---

### CC-09 — P3: Lockfile static consistency looks coherent; full `npm ci` not re-proven

**Evidence**

- `package-lock.json`: `lockfileVersion: 3`, root name/version `alphastudio@3.6.0`, `workspaces: ["server"]`.
- Workspace link: `node_modules/alphastudio-server` → `"resolved": "server", "link": true`.
- Nested `packages["server"]` lists server deps matching `server/package.json` (fastify, better-sqlite3, sharp, tsx, typescript, …).
- Root deps: `react`, `react-dom`, `pdfjs-dist`; dev: `vite@6.4.3`, `concurrently`, `@playwright/test`.
- `.gitignore` intentionally ignores nested `server/package-lock.json`.

**Not proven here**

- Integrity of every resolved tarball / native prebuild on a virgin OS image.
- That root `allowScripts` for better-sqlite3/esbuild/sharp matches current install policy on all npm versions.

**Impact**

No static lockfile split detected; clean-clone risk is **runtime native compile** and network, not dual-lockfile conflict.

---

### CC-10 — P3: What `npm ci` + `typecheck` + `build` need from the tracked tree

| Step | Needs from git | Needs local/generated | Does **not** need |
|------|----------------|----------------------|-------------------|
| `npm ci --no-audit --no-fund` | root + server package manifests + root lockfile | network, Node ≥20, writable `node_modules` | `.runtime`, `data/`, `.env`, `audit/` |
| `npm run typecheck` | `server/tsconfig.json`, `server/src/**` | typescript + `@types/*` from ci | `.runtime`, client build, fixtures |
| `npm run build:client` | `index.html`, `src/**`, `public/**`, `vite.config.js` | vite | server dist, tools |
| `npm run build:server` | `server/src/**`, tsconfig | tsc from workspace | `.runtime`, `data/` |
| `npm start` | (after build) `server/dist/**` | creates `data/`; optional `.env` | **not** `.runtime` for core listen |

**Tracked extras for fuller test surface**

- `fixtures/pdf/**` + `scripts/test/*` for PDF fixture verify / e2e prep
- `server/tests/**` + `server/tests/fixtures/**` for `npm test`
- `e2e/**`, `playwright.config.js` + `npx playwright install chromium` for e2e (browsers not in git)

---

### CC-11 — P4: Legacy check/repair tool scripts vs `.runtime` canonical root

**Evidence**

`scripts/check-tools.mjs` / `repair-tools.mjs` still probe **`.tools/config.json`** (legacy). Canonical install writes `.runtime/` (`setup-tools.mjs`, maint tools). Package scripts prefer `scripts/maint/tools.mjs`.

**Impact**

Low for clean clone if operators use `tools:check` / `doctor`; confusing if someone runs legacy scripts expecting modern layout.

---

## 6. Fresh DB init paths (operator map)

```text
Path A — first production/dev start (canonical full schema)
  npm run dev:server   OR   npm run build && npm start
  → ensureDataDirs()
  → initDb(config.dbPath)
       LEGACY_SCHEMA
       runMigrations (versioned)
       ensureRequiredTables
       seed profile/settings
       recover interrupted jobs/uploads

Path B — reset script
  npm run reset
  → clean + npm ci + (tsx initDb if found) + tools:install
  → may degrade to empty dirs only (CC-07)

Path C — db:repair
  npm run db:repair
  → prefers compiled repairDb
  → else standalone partial heal (CC-06)
  → never a substitute for Path A on empty machine

Env defaults (.env.example / config.ts)
  DATA_DIR=./data
  DB_PATH=./data/alphastudio.db
  SERVE_FRONTEND=1
  HOST=127.0.0.1 PORT=8787
```

`data/` is gitignored — correct for clean clone (no committed user DB).

---

## 7. Ordered repair steps (THIS SCOPE ONLY)

Do not implement in this audit; proposed order for CP1-style work:

1. **Honesty: kill or restore broken entrypoints (P0)**  
   - Remove `test:audit` + `audit:backend` from `package.json`, **or** restore `scripts/audit/` that fails closed with a clear message.  
   - Prefer remove unless recovery is trivial.

2. **Docs scrub (P0/P1)**  
   - `RUNTIME_VALIDATION.md`: mark historical / invalidate broken commands.  
   - `BUILD_AND_RUN_WINDOWS_LINUX.md` §2 and §6: align with real scripts (README contract).  
   - Grep and fix remaining `test:audit` / `audit:backend` / `audit/backend-audit.json` references.

3. **Fixtures for clean clone (P1)**  
   - Commit samples under tracked tree (`fixtures/sample/` recommended).  
   - Update `detect.test.ts`, `helpers.test.ts`, `bench-startup.mjs`.  
   - Narrow `.gitignore` so only ephemeral audit outputs stay ignored.

4. **Maint contract single source of truth (P1)**  
   - Either add `predev`/`prebuild`/`prestart` → `runtime:prepare`, **or** change `maint-core.test.mjs` to assert the README model (`bootstrap` only).  
   - Do not leave test asserting scripts that package.json omits.

5. **DB bootstrap reliability (P2)**  
   - Make `reset` resolve `tsx` from root workspace hoist.  
   - Document: first `npm start` / `dev:server` is the supported schema path; `db:repair` is non-destructive heal for existing DBs, not full migrate-from-zero without dist.

6. **Verify on a virgin directory (proof)**  
   ```text
   git clone <url> AlphaStudio-clean
   cd AlphaStudio-clean
   npm ci --no-audit --no-fund
   npm run typecheck
   npm run build
   npm test                 # after fixtures fix
   npm run test:maint       # after contract fix
   npm start                # smoke: /api/health, DB file created under data/
   ```
   Optional second pass: `npm run bootstrap` for full tools (disk/network heavy).

7. **Out of this scope but adjacent**  
   - Minimal CI without full tool bootstrap (audit 08).  
   - Do not wire broken scripts into CI until step 1 is done.

---

## 8. Dependencies / risks / unknowns

### Dependencies between fixes

- Fixture path change must land **before** trusting `npm test` green on CI.  
- Doc scrub depends on final choice: restore audit scripts vs delete.  
- Maint test vs `pre*` scripts must match BUILD/README after edit (single contract).  
- `db:repair` completeness depends on whether reset/start paths remain primary.

### Risks

| Risk | Note |
|------|------|
| Restoring full historical `scripts/audit/` | May pull stale harness that assumes old layout / secrets / ports |
| Un-ignoring entire `audit/` | Could re-track logs, DBs, large benchmarks — prefer narrow allowlist |
| Adding automatic `prebuild` tool install | Slows every build; multi-GB; breaks offline/CI without cache |
| Partial `db:repair` “green” | Operators may think schema is complete when workspaces/files tables missing |

### Unknowns (not re-executed)

- Exact `npm test` fail count on a pure clone without local `audit/fixtures` (expected ≥ detect + helpers failures).  
- Whether Windows shell expands `scripts/audit/tests/*.test.mjs` to zero files (exit non-zero) vs other platforms.  
- Cold `npm ci` native build time for `better-sqlite3` / `sharp` on this host’s Node version.  
- Whether any other untracked local files (outside `audit/`) currently green-wash the suite on this workstation.

---

## 9. Cross-links

| Related | Path |
|---------|------|
| Git ignore / hygiene | [01-git-hygiene.md](./01-git-hygiene.md) |
| Tests / fixtures | [04-tests-coverage.md](./04-tests-coverage.md) |
| Runtime / bootstrap | [05-runtime-tools.md](./05-runtime-tools.md) |
| CI / release gates | [08-ci-release.md](./08-ci-release.md) |
| Program next step CP1 | [MASTER_PLAN.md](../MASTER_PLAN.md), [STATE.md](../STATE.md) |

---

## 10. Non-claims

- This audit did **not** declare the repository stable.  
- This audit did **not** re-run full suites as a green stamp.  
- This audit did **not** implement CP1 fixes.  
- Prior `RUNTIME_VALIDATION.md` numbers are **not** accepted as current evidence.
