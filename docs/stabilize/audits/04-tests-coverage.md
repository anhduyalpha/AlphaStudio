# Audit 04 — Tests, fixtures, flakiness, and missing coverage

**Program:** AlphaStudio stable baseline  
**Scope lane:** (d) Tests / fixtures / flakiness / coverage only  
**Date:** 2026-07-24  
**Auditor role:** independent static inventory (no product-code changes)  
**Repo root:** `C:\Users\Duy\Code\Project\AlphaStudio`

---

## Scope

In scope:

- Root and workspace `package.json` test-related scripts
- `server/tests/**/*.test.ts` (52 files) and `server/tests/fixtures/`
- `scripts/maint/tests/`, `scripts/test/`, `e2e/`, root `fixtures/`, `audit/fixtures/`
- `playwright.config.js` and E2E runner wiring
- Python bridge tests under `python/tests/` (inventory only as related harness)
- Flaky patterns: sleeps, order dependence, network, shared DB/data dirs, cleanup, concurrency
- Coverage measurement posture (presence/absence of tooling, gates, gaps)

Out of scope (explicit):

- Product/runtime code changes
- Full suite execution and green claims
- CI/release design beyond how tests would gate (see audit 08)
- Security correctness of assertions (see audit 07)
- Runtime tool installation correctness (see audit 05)

---

## Method

1. Inventory scripts from root `package.json` and `server/package.json`.
2. List and sample-read test files under `server/tests/`, `e2e/`, `scripts/maint/tests/`, `scripts/test/`, `python/tests/`.
3. Cross-check fixture trees: `fixtures/pdf/`, `server/tests/fixtures/`, `audit/fixtures/`.
4. Grep for flaky/order/cleanup patterns (`setTimeout`, `waitForTimeout`, fixed `PORT`/`DATA_DIR`, `t.skip`, `rmSync`, shared `data-test*`).
5. Verify presence/absence of `scripts/audit/` relative to npm scripts.
6. Check coverage tooling (`c8`/`nyc`/`vitest`/`jest`/coverage scripts) and `.gitignore` interactions with fixtures.
7. Optional sample test run: **not executed** in this auditor environment (no shell execution path available to the subagent). Prior docs claiming green results are treated as **non-proof**.

---

## Evidence

### 1. npm scripts (root `package.json`)

| Script | Command | Role |
|--------|---------|------|
| `test` | `npm run test -w alphastudio-server` | Main Node test suite |
| `test:pdf` | `node --import tsx --test --test-concurrency=1 server/tests/pdf-*.test.ts server/tests/ui-pdf-struct.test.ts` | PDF-focused subset |
| `test:e2e` | `node scripts/test/run-playwright.mjs` | Playwright E2E |
| `test:e2e:install` | `playwright install chromium` | Browser install |
| `fixtures:pdf` / `fixtures:pdf:verify` | generate / verify PDF fixtures | Deterministic PDF corpus |
| `test:maint` | `node --test scripts/maint/tests/*.test.mjs` | Maint helpers |
| `test:audit` | `node --test scripts/audit/tests/*.test.mjs` | **Broken path** (see Findings) |
| `audit:backend` | `node scripts/audit/backend.mjs` | **Broken path** (see Findings) |
| `test:python` | `node scripts/maint/python.mjs test` | Python bridge suite via maint |
| `typecheck` | `tsc -p server/tsconfig.json --noEmit` | Types (not tests) |
| `benchmark:*` | worker/upload benches | Perf, not CI gates |

Workspace `server/package.json`:

```text
"test": "node --import tsx --test --test-concurrency=1 tests/**/*.test.ts"
```

Notes:

- Runner is **Node.js built-in test** (`node:test`), not Jest/Vitest.
- Concurrency is **forced to 1** for the main and PDF suites (serial file execution intent).
- No `test:coverage`, `coverage`, `c8`, or similar script exists.

### 2. `server/tests/` inventory (52 `*.test.ts` files)

Counted on disk under `server/tests/` (excluding `fixtures/` content files):

| Cluster | Files (representative) | Style |
|---------|------------------------|--------|
| HTTP/API + jobs | `api`, `converter`, `detect`, `hardening`, `job-delete-history`, `pdf-api-jobs`, `pdf-jobs-reliability`, `resumable-upload`, `upload-fastpath`, `workspace-persist`, `workspace-sse-http`, `rate-limit-absent`, `workers`, `worker-process-pool` | Live Fastify listen + `fetch` to `127.0.0.1` |
| PDF pure/integration | `pdf-pipeline`, `pdf-ops-extended`, `pdf-page-selection`, `pdf-output-names`, `pdf-password-redaction`, `pdf-validation`, `pdf-routing`, `pdf-to-images-selection`, `pdf-capabilities`, `pdf-webui-options` | Processor/unit + some HTTP |
| Converter engines | `converter-engines`, `converter-groups`, `office-routing`, `libreoffice-isolation`, `quality`, `python-engine`, `python-pyop` | Mock runners + optional live tools |
| Detect/cache/workspace | `detect-cache-db`, `e2e-goal-verify`, `workspace-events`, `live-state`, `stage-placement` | DB + events; some pure |
| UI “structural” | `ui-*-struct`, `ui-contrast`, `ui-assets-design-system`, `ui-job-resume`, `ui-converter-results-behavior`, `ui-qr-*`, `release-regressions`, `resumable-upload-ui` | **Source `readFileSync` + regex**, not browser |
| Client pure units in suite | `clipboard-image` (imports `src/lib/clipboardImage.js`), `live-state` helpers | No DOM |

**Fixtures inside suite:** `server/tests/fixtures/converter/` — 7 text dumps (`ffmpeg-*`, `pandoc-*`, `calibre-help.txt`) for parser/probe unit tests.

### 3. Fixed ports and data directories (HTTP integration)

| Test file | PORT | DATA_DIR (repo-relative unless noted) |
|-----------|------|----------------------------------------|
| `rate-limit-absent` | 8791 | `data-test-ratelimit` |
| `workspace-sse-http` | 8793 | `data-test-workspace-sse` (pattern) |
| `workspace-persist` | `8795 + pid%100` | `data-test-ws-*` / pid-scoped |
| `detect` | 8797 | `data-test-detect` |
| `converter` | 8798 | `data-test-converter` |
| `api` | 8799 | `data-test` |
| `pdf-api-jobs` | 8801 | `data-test-pdf-api` |
| `job-delete-history` | 8809 | `data-test-job-delete` |
| `upload-fastpath` | `8810 + pid%80` | pid-scoped |
| `hardening` | 8811 | `data-test-hardening` |
| `workers` | 8819 | `data-test-workers` |
| `pdf-jobs-reliability` | 8827 | reliability data dir |
| `resumable-upload` | `8890 + pid%70` | pid-scoped |
| `detect-cache-db` | `19000 + pid%1000` | pid-scoped |

`.gitignore` ignores `data-test/` and `data-test-*/` (good).  
**On-disk residue observed during audit:** `data-test-ratelimit/` with `t.db`, `outputs/`, `temp/upload-sessions/`, `uploads/` — consistent with incomplete cleanup (see Findings).

### 4. E2E / Playwright

| Path | Role |
|------|------|
| `playwright.config.js` | Chromium, `workers: 1`, `fullyParallel: false`, 90s test timeout, CI retry=1 |
| `e2e/pdf-tools.spec.js` | One serial describe, **4 browser tests** (preview, cancel upload, idempotent job+delete, responsive) |
| `e2e/support/browser-audit.js` | Console/network failure soft asserts; attaches JSON audit |
| `scripts/test/run-playwright.mjs` | Generates+verifies PDF fixtures, runs Playwright with temp `ALPHASTUDIO_E2E_DATA_DIR`, preserves dir on failure |
| `scripts/test/start-e2e-client.mjs` | **Full Vite `build` then `preview`** (not `vite dev`) for E2E client |
| `scripts/test/generate-pdf-fixtures.mjs` / `verify-pdf-fixtures.mjs` | Manifest-backed fixture pipeline |

E2E ports default: client `15173`, server `18787`; server env sets isolated `DATA_DIR`/`DB_PATH` under temp.  
E2E sleeps: intentional upload delay `1200ms` + `page.waitForTimeout(1500)` in cancel test.

### 5. Other test surfaces

| Surface | Path | Notes |
|---------|------|-------|
| Maint unit | `scripts/maint/tests/maint-core.test.mjs` | Real maint modules; Unicode/space fixture under `tmp/` |
| PDF fixtures | `fixtures/pdf/` + `manifest.json` | 8 PDFs: text, unicode name, multi-dot, organizer 8p, large 205p, scanned, corrupt, encrypted |
| Audit fixtures | `audit/fixtures/` (`sample.jpg/pdf/png/txt/wav`) | Present locally; **`audit/` is gitignored** |
| Python | `python/tests/test_bridge.py` | `unittest`; driven by `npm run test:python` |
| CI workflows | `.github/` | **Absent** (no automated test gate in-tree) |

### 6. Broken script targets (missing tree)

Under `scripts/` on disk: `maint/`, `test/`, benchmarks, setup/check/repair tools.  

**There is no `scripts/audit/` directory.**

Yet root `package.json` defines:

- `"test:audit": "node --test scripts/audit/tests/*.test.mjs"`
- `"audit:backend": "node scripts/audit/backend.mjs"`

Cross-references still document these scripts:

- `docs/BUILD_AND_RUN_WINDOWS_LINUX.md`
- `docs/CONVERTER_PHASE_1_PLAN.md`
- `RUNTIME_VALIDATION.md` (claims prior green runs — non-proof for this program)
- `docs/stabilize/STATE.md` / `TOPOLOGY.md` already flag absence

### 7. Coverage tooling

- No `c8`, `nyc`, Istanbul, Vitest, or Jest in root/server `package.json` dependencies/scripts.
- `.gitignore` includes `coverage/`, `server/coverage/`, `.nyc_output/` (legacy placeholders only).
- No coverage thresholds or “must cover X%” gate in repo scripts.
- Large fraction of “UI tests” are **string presence** checks on JSX/CSS sources; they do not execute React.

### 8. Flaky-pattern samples (static)

| Pattern | Where | Risk |
|---------|-------|------|
| Fixed `setTimeout` after close/cleanup | `api.test.ts` (100ms), `job-delete-history` (150ms), `converter` (50ms), `hardening` (100–500ms), Windows WAL comment | Fail on slow FS/AV; residue on fail |
| Polling loops (`Date.now` + sleep) | `api`, `pdf-api-jobs`, `job-delete-history`, `converter` job wait helpers | Timeout flake under load |
| `page.waitForTimeout(1500)` | `e2e/pdf-tools.spec.js` cancel path | Classic timing flake |
| Fixed ports | Many HTTP tests | Collide if concurrency >1 or external process holds port |
| Fixed `data-test-*` dirs | Several files | Parallel or interrupted runs leave shared SQLite/WAL |
| `t.skip` when tool/symlink unavailable | `libreoffice-isolation`, `job-delete-history`, conditional ffmpeg paths in `converter` | False sense of coverage on sparse machines |
| Module-top `process.env` then static `import` of config/db | HTTP test files | Order/env caching hazard if ever run multi-file **same process** |
| SSE race sleep 200ms before upload | `workspace-sse-http.test.ts` | Event miss under scheduling delay |
| E2E depends on full client **build** | `start-e2e-client.mjs` | Long, environment-sensitive; not pure unit |
| Localhost-only network | HTTP tests + Playwright | Not external internet; still OS port/bind sensitive |

Positive mitigations already present:

- `--test-concurrency=1` on main/PDF scripts
- Playwright `workers: 1`, serial describe
- Several newer tests use **pid-scoped** ports/dirs (`resumable-upload`, `upload-fastpath`, `detect-cache-db`, `e2e-goal-verify`)
- E2E isolates data under `os.tmpdir()` and cleans on success
- Converter engine tests inject fake `ProbeRunner`s (no real ffmpeg/pandoc required for core unit path)

### 9. Coverage shape (product surface vs tests)

| Product surface | Automated depth (static judgment) |
|-----------------|-------------------------------------|
| PDF pipeline / options / routing | **Strong** unit+integration + 4 browser E2E |
| Converter matrix / engines / quality | **Moderate–strong** unit; live encode optional |
| Job workers, cache keys, cancel/children | **Moderate** unit + hardening |
| Workspace SSE / persist / detect cache | **Moderate** HTTP/service tests |
| Resumable upload | **Moderate** dedicated tests |
| QR Lab | Mostly **structural source** + clipboard pure unit; thin live decode |
| Image / Media / Text / Archive jobs | Smoke via `api.test` / hardening; thinner than PDF |
| Dashboard, Settings, Profile, Security, Color, Developer, Audio, Activity UX | Structural/contrast/assets only or none |
| React runtime behavior (hooks, a11y live, motion) | **Near-absent** outside Playwright PDF slice |
| Maint scripts | One solid unit file |
| Audit backend conversion matrix | **Missing** (scripts deleted or never committed) |
| Python ops | Bridge unittest; not part of `npm test` |

---

## Findings

Severity: **P0** (blocks claimed gates / immediate fail) → **P4** (hygiene / polish).

### F1 — P0: `test:audit` and `audit:backend` point at missing `scripts/audit/`

**Evidence:**

- `package.json` lines define `test:audit` → `scripts/audit/tests/*.test.mjs` and `audit:backend` → `scripts/audit/backend.mjs`.
- `scripts/` listing contains `maint/`, `test/`, benchmarks, setup tools — **no `audit/` tree**.
- Docs still instruct operators to run these (`BUILD_AND_RUN_WINDOWS_LINUX.md`, `CONVERTER_PHASE_1_PLAN.md`).
- `RUNTIME_VALIDATION.md` records historical “4/4 passed” / “0 issues” for these commands without present code to re-run.

**Impact:** Any checklist that includes `npm run test:audit` or `audit:backend` fails hard; false confidence if skipped silently; stabilize process already lists this as a known hazard.

**Recommendation:** Either restore `scripts/audit/` from history with tests, or remove/replace scripts and scrub docs in a dedicated checkpoint (process/docs only first is fine).

---

### F2 — P1: Required `audit/fixtures` are gitignored

**Evidence:**

- `.gitignore` contains `audit/`.
- `server/tests/detect.test.ts` sets `fixtures = path.join(root, 'audit', 'fixtures')` and uses `sample.png|pdf|txt|wav`.
- `server/tests/helpers.test.ts` asserts `fs.existsSync(samplePng)` under `audit/fixtures`.
- Local workspace currently has the five sample files; a clean clone after ignore rules may not.

**Impact:** Fresh checkout / CI agent can fail core detect/fingerprint tests even when product code is fine. Fixtures are effectively “developer laptop state.”

**Recommendation:** Track a committed fixture tree (e.g. `fixtures/sample/` or un-ignore `audit/fixtures/**`) and point tests there; keep generated/ephemeral audit outputs ignored separately.

---

### F3 — P1: No coverage measurement or CI test gate

**Evidence:**

- No coverage runner/deps/scripts; no `.github/` workflows.
- Definition of “covered” is informal (many structural tests inflate count without runtime proof).
- Stabilize gates in `HANDOFF_FORMAT.md` require “focused tests” but nothing enforces suite on push.

**Impact:** Regressions can land without automated detection; cannot quantify missing lines/branches; structural tests may pass after behavior regressions.

**Recommendation:** Add minimal CI job (`npm test` serial + `typecheck` + optional `test:pdf`) once fixtures/scripts fixed; later add `c8` (or equivalent) on server pure units with a modest floor — not a vanity 100%.

---

### F4 — P2: UI confidence over-indexed on source-structure tests; browser E2E is PDF-only and thin

**Evidence:**

- ≥12 `ui-*.test.ts` / `release-regressions` files use `readFileSync` + `assert.match` / `doesNotMatch` on JSX/JS/CSS.
- Playwright: single spec file, 4 serial tests, PDF Studio only; client path builds production bundle each E2E run.
- No React Testing Library / component harness.

**Impact:** Refactors that preserve string tokens pass; real interaction bugs (state machines, SSE reconnect UI, non-PDF workspaces) are largely unguarded in browser automation.

**Recommendation:** Keep structural tests as cheap lint-like guards, but grow E2E by product critical path (converter happy path, job cancel, workspace reload) rather than more regex.

---

### F5 — P2: Shared fixed ports and fixed `data-test-*` dirs remain flaky under non-default runners

**Evidence:**

- Many files hardcode ports 8791–8827 and fixed dirs (`data-test`, `data-test-converter`, …).
- Suite relies on `--test-concurrency=1`; `test:maint` does **not** set concurrency (currently one file, low risk).
- Pid-scoped ports use small moduli (`%70`, `%80`, `%100`) — collision possible across concurrent processes.

**Impact:** Developer who runs `node --test tests/**/*.test.ts` without concurrency=1, or runs two suites together, gets `EADDRINUSE` / SQLite lock flakes.

**Recommendation:** Standardize on ephemeral port `0` or pid+random unique dirs for all HTTP tests; never share fixed repo-root data dirs.

---

### F6 — P2: Incomplete cleanup leaves SQLite/data residue (`rate-limit-absent`)

**Evidence:**

- `rate-limit-absent.test.ts` `after()` closes app and DB but **does not** `rmSync` `data-test-ratelimit`.
- Workspace audit observed leftover `data-test-ratelimit/t.db` and dirs.

**Impact:** Disk clutter; rare lock conflicts; confuses “is the suite clean?” hygiene checks.

**Recommendation:** Mirror other tests’ `before`/`after` rm of `DATA_DIR`; prefer tmpdir.

---

### F7 — P2: Timing sleeps and open-ended polls

**Evidence:** Multiple `setTimeout` delays (20–500ms) for WAL/SSE/process settle; E2E `waitForTimeout(1500)`; job wait loops with hard ceilings (e.g. SSE 40s in `pdf-api-jobs`).

**Impact:** Slow Windows antivirus/disk → intermittent fail; fast machines hide races that still exist.

**Recommendation:** Prefer condition waits (port open, file gone, event received) with bounded timeout; reserve fixed sleep only as last resort with comment + issue link.

---

### F8 — P3: Optional binary / platform skips hide real capability gaps

**Evidence:** `t.skip` when LibreOffice missing; converter media tests gate on `resolveTool('ffmpeg')`; symlink tests skip when OS blocks reparse points.

**Impact:** “All tests passed” on a minimal machine ≠ production path with tools installed; inverse: tool-rich machine may hit untested failure modes.

**Recommendation:** Split **required** (always run, mock tools) vs **optional live** suites (`test:live-tools`) that CI runs on a tools-full agent profile only.

---

### P3 — Thin automated depth outside PDF/converter core

**Evidence:** Inventory cluster table; views such as Dashboard/Settings/Security/Color/Developer lack dedicated behavioral tests; archive/image/media mostly smoke-level.

**Impact:** Stabilize work on non-PDF features has weaker safety nets.

**Recommendation:** After PDF baseline is stable, add focused API contract tests per job type before UI E2E expansion.

---

### F10 — P4: Docs claim historical green results that this program must not trust

**Evidence:** `RUNTIME_VALIDATION.md`, `PDF_TOOLS_WEBUI_FINAL_REPORT.md` cite pass counts; stabilize `STATE.md` / `TOPOLOGY.md` mark them non-proof.

**Impact:** Process risk of “already validated” shortcuts.

**Recommendation:** All stabilize checkpoints must paste fresh command output; treat old reports as hints only.

---

## Plan

Ordered for stabilize program (tests lane only):

| Step | Action | Priority | Exit criteria |
|------|--------|----------|---------------|
| T1 | Quarantine or delete broken npm scripts / docs refs to `scripts/audit`, **or** restore tree from git history | P0 | `npm run test:audit` either works or is removed from package.json + docs |
| T2 | Relocate/commit sample fixtures; fix `detect`/`helpers` paths; ensure clean clone can run pure+detect tests | P1 | Fresh tree without ignored `audit/` still has fixtures |
| T3 | Document canonical local test commands (already partial in `PDF_TOOLS_TESTING.md`) in stabilize STATE | P1 | Single source of truth for “focused tests” gate |
| T4 | Normalize HTTP test isolation (tmpdir + free port) for worst offenders; fix `rate-limit-absent` cleanup | P2 | No fixed shared `data-test-*` left behind after suite |
| T5 | Reduce E2E blind sleep; keep cancel test deterministic via request/route events | P2 | No `waitForTimeout` without condition |
| T6 | Add CI workflow (separate audit 08 may own file) that runs `npm test` + `typecheck` + fixture verify | P1–P2 | PR cannot merge red main suite |
| T7 | Optional: `c8` on pure unit files only; publish coverage artifact without blocking on UI structure files | P3 | Coverage report exists; floor applied only to pure modules |
| T8 | Expand browser E2E beyond PDF for 1–2 critical converter/workspace paths | P3 | E2E map lists covered user journeys |
| T9 | Label optional live-tool tests; never skip silently in summary without count | P3 | Suite footer reports skip reasons/counts |

---

## Dependencies

- **Fixtures commit decision** depends on git/hygiene policy (whether to un-ignore `audit/` or move assets).
- **CI job** depends on audit 08 (CI/release) and runtime tools profile (audit 05) if live converters are included.
- **Restore `scripts/audit`** may depend on git history availability (`git log -- scripts/audit`) and whether conversion matrix still matches engines.
- **E2E expansion** depends on stable Playwright install (`test:e2e:install`) and acceptable wall-clock (full Vite build per E2E).
- **Python tests** depend on `python:install` / `.runtime` (audit 05).

---

## Risks

| Risk | Notes |
|------|-------|
| Serial suite is slow | `--test-concurrency=1` + many HTTP boots → long `npm test`; pressure to re-enable parallel without isolation fixes will create flakes |
| Structural tests resist deletion | They catch some regressions cheaply; replacing them wholesale with E2E would slow feedback |
| Windows file locking | Multiple tests already special-case WAL/EPERM; aggressive cleanup can flake on Windows |
| Optional tools | Skip-heavy machines green ≠ tools-full machines green |
| E2E couples to production build | UI-only changes force rebuild cost; failures can be build errors misread as test failures |
| False confidence from volume | 52 server test files + many cases ≠ balanced coverage |

---

## Unknowns

- Whether `scripts/audit/` ever existed on `main` history or only on abandoned branches/local trees.
- Current full-suite pass/fail on this Windows host (not run this pass).
- Whether `node --test` spawns **one process per file** on the installed Node version (isolation assumption behind env mutation safety).
- Exact skip counts for LibreOffice/ffmpeg/tesseract on a minimal vs full tools profile.
- Whether `ux-ui-redesign` branch carries additional tests that never landed on `main`.
- Wall-clock of `npm test` and `npm run test:e2e` on reference hardware.
- Whether leftover `data-test-ratelimit` is solely from tests or also manual experiments.

---

## Explicit non-claims

- This audit **does not** claim the test suite is green, red, or flaky in live execution.
- This audit **does not** claim code coverage percentages (no instrumentation run).
- This audit **does not** claim Playwright E2E passes on this machine.
- This audit **does not** validate product correctness of any assertion body beyond inventory and risk patterns.
- Prior documents (`RUNTIME_VALIDATION.md`, PDF final reports) are **not** accepted as current evidence.
- Completing this audit file **does not** make the repository stable.

---

## Appendix A — Script quick reference

```bash
# Main suite (serial)
npm test

# PDF-focused
npm run fixtures:pdf:verify
npm run test:pdf

# E2E (install browsers once)
npm run test:e2e:install
npm run test:e2e

# Maint
npm run test:maint

# Python (via runtime helper)
npm run test:python

# Currently broken (missing scripts/audit/)
# npm run test:audit
# npm run audit:backend
```

## Appendix B — Severity legend (this program)

| Sev | Meaning |
|-----|---------|
| P0 | Broken entry points / impossible claimed gates |
| P1 | Clean-clone or process reliability fails without product bug |
| P2 | Flake / isolation / false-confidence patterns |
| P3 | Coverage holes and optional-tool blind spots |
| P4 | Doc hygiene and process trust issues |

---

*End of audit 04.*
