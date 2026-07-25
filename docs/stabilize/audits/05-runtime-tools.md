# Audit 05 — Runtime installers, Python profiles, external tools, capabilities

**Program:** AlphaStudio stable baseline  
**Scope:** (e) Runtime installers, Python profiles, external tools, and capabilities **only**  
**Auditor role:** Independent code/docs review (read-only of product code)  
**Date:** 2026-07-24  
**Base SHA context:** `ed460ee` (stabilize program start; see `docs/stabilize/STATE.md`)  
**Artifact:** `docs/stabilize/audits/05-runtime-tools.md`  
**Status:** AUDIT_COMPLETE (repository **not** declared stable)

---

## 1. Executive summary

AlphaStudio has a deliberately layered runtime model:

1. **npm workspaces** supply Node deps (including bundled **sharp** / **pdf-lib**).
2. **Portable external binaries** land under `.runtime/tools/<platform>-<arch>/` via `scripts/setup-tools.mjs`, orchestrated by `scripts/maint/tools.mjs` (`tools:*`, `runtime:prepare`, `bootstrap`).
3. **Optional Python venv** under `.runtime/python/<platform>-<arch>/venv/` via `scripts/maint/python.mjs` (never part of `bootstrap` / `runtime:prepare`).
4. **Server capability gating** in `server/src/capabilities.ts`, `server/src/tools/registry.ts`, and `server/src/tools/optional-binaries.ts`, plus converter engine probes and specialized `pyop` ops.

The architecture is mostly coherent and production-oriented (system-first resolution, atomic manifest/config, path confinement in the Python bridge, killable one-shot children). Stabilization risk is concentrated in **doc/script drift**, **integrity of downloaded tool archives**, **incomplete optional-binary install path**, **Python profile/selfcheck gaps**, and **claims in release validation docs that conflict with the current tree**.

**Severity mix (this scope):** 0×P0, 4×P1, 7×P2, 6×P3, 4×P4 (see §7).

---

## 2. Scope and method

### 2.1 In scope

| Area | Primary paths |
|------|----------------|
| npm surface | Root `package.json` scripts: `bootstrap`, `runtime:prepare`, `tools:*`, `python:*`, `doctor`, `deps:*`, `setup:tools` / `check:tools` / `repair:tools` |
| Maint installers | `scripts/maint/tools.mjs`, `python.mjs`, `doctor.mjs`, `deps.mjs` |
| Maint libs | `scripts/maint/lib/{platform,tools-probe,manifest,checksum,paths,clear-targets}.mjs` |
| Portable installer | `scripts/setup-tools.mjs` |
| Legacy shims | `scripts/check-tools.mjs`, `scripts/repair-tools.mjs`, `scripts/setup-tools.mjs` |
| Python runtime | `python/bridge.py`, `python/operations/*`, `python/requirements-*.txt`, `python/models.lock.json`, `python/tests/*` |
| Server tools/caps | `server/src/tools/registry.ts`, `optional-binaries.ts`, `server/src/capabilities.ts`, `server/src/convert/engines/python.ts` |
| Docs as claims | `docs/python-runtime.md`, `docs/BUILD_AND_RUN_WINDOWS_LINUX.md`, `RUNTIME_VALIDATION.md` |

### 2.2 Out of scope

- Product feature implementation / bug fixes (this audit **does not modify product code**).
- Full security threat model beyond runtime download integrity (see audit 07).
- CI/release pipeline (audit 08).
- Frontend UX of capability badges (audit 03), except where caps API contracts matter.
- Worker pool / job engine correctness beyond capability gate entry points (audit 02).

### 2.3 Method

- Static read of the files listed above.
- Cross-check of `package.json` scripts against maint tests and BUILD/docs claims.
- Cross-check of Python `OPTIONAL_MODULES` vs specialized op `requires[]`.
- Passive observation of this host’s `.runtime/` tree and config (existence only; **not** treated as a full validation pass).

### 2.4 Explicit non-execution (honest)

On this audit pass the following were **not** re-run end-to-end as release evidence:

| Command / action | Status |
|------------------|--------|
| `npm run bootstrap` / full cold `tools:install` download cycle | **Not executed** |
| `npm run tools:check -- --force` | **Not executed** (config/manifest read only) |
| `npm run doctor` | **Not executed** |
| `npm run python:install` for non-core profiles (data/documents/vision/ocr/ai) | **Not executed** |
| `npm run python:models` downloads | **Not executed** |
| `npm run deps:check` / `deps:prune` | **Not executed** (source reviewed; maint test may invoke deps:check in suite) |
| `npm run test:maint` | **Not executed** this pass (source reviewed; test asserts `predev`/`prebuild`/`prestart` — see RT-P1-01) |
| `npm run test:python` / full bridge unittest | **Not executed** |
| Linux/macOS portable install paths | **Not executed** (Windows host only for passive observation) |
| Live `/api/capabilities` against a running server | **Not executed** |

Passive observation (this Windows x64 host, not proof of release health):

- `.runtime/config.json` lists system ffmpeg/ffprobe/7z and project-local libreoffice/pandoc/calibre.
- `.runtime/python/fingerprint.json` shows **core** profile with Python 3.14.6 venv present.
- LibreOffice / Calibre / Pandoc trees exist under `.runtime/tools/win32-x64/`.

Treat prior docs (`RUNTIME_VALIDATION.md`, BUILD §11) as **claims**, not proof.

---

## 3. Architecture map (as implemented)

### 3.1 Tool binary lifecycle

```text
npm run bootstrap
  -> npm ci
  -> runtime:prepare
       -> scripts/maint/tools.mjs install --profile full
            -> checkAllTools (system first, then .runtime/.tools)
            -> for missing installable units:
                 scripts/setup-tools.mjs --only <unit>...
            -> mirror flat→platform layout
            -> upsert atomic .runtime/manifest.json + config.json

Server resolve (registry.ts):
  memory cache → config.json / manifest.json (identity trust)
  → project .runtime/tools/<plat-arch>/… + legacy .tools/
  → well-known system paths → PATH

Doctor / tools:check:
  same tools-probe.mjs resolution; doctor never downloads
```

**Phase 1 “full” set** (`scripts/maint/lib/tools-probe.mjs` `TOOL_PROFILES.full`):

`7z`, `ffmpeg`, `ffprobe`, `libreoffice`, `pandoc`, `calibre`

Installable units (`installableToolNames`): same minus treating ffprobe as ffmpeg unit.

### 3.2 Directory layout

| Path | Role |
|------|------|
| `.runtime/tools/<platform>-<arch>/` | Canonical portable installs |
| `.runtime/manifest.json` + `.runtime/config.json` | Atomic tool cache (server reads both) |
| `.runtime/manifests/` | Migration copies of config/manifest |
| `.runtime/cache|downloads|tmp` | Staging skeleton |
| `.runtime/python/<plat-arch>/venv/` | Managed Python |
| `.runtime/python/fingerprint.json` | Last-installed profile fingerprint |
| `.runtime/python/models/` | On-demand model weights |
| `.tools/` | Legacy discovery/migration only |

### 3.3 Python lifecycle

```text
npm run python:install [-- --profile <core|data|documents|vision|ocr|ai>]
  -> find system Python ≥3.10 (python3|python|py -3)
  -> create venv with --copies
  -> pip install -r python/requirements-<profile>.txt (core is empty)
  -> compileall python/
  -> write fingerprint.json

Job path:
  resolvePythonPath (venv first, then PATH)
  -> bridge.py --selfcheck | --operation …
  -> execFileTracked (no shell, timeout, proxy-denied env)
```

Specialized ops use job type `pyop` and `pythonOperationStatus` before queue.

### 3.4 Capability surface

| Layer | Mechanism |
|-------|-----------|
| Bundled JS tools | `BUNDLED_CAPABILITIES` short-circuit → always available |
| External Phase 1 engines | `resolveAllTools` → media/office/archive/calibre/pandoc-backed caps |
| Optional PDF binaries | `optional-binaries.ts` PATH + common Windows install dirs only |
| Converter matrix | Engine `probe` + `discoverCapabilities` (FFmpeg/LO/Pandoc/Calibre/Python) |
| Specialized Python | `listPythonSpecializedCapabilities` → `/api/capabilities` tools[] |
| Job gate | `assertJobCapable` in `processors/index.ts` |

---

## 4. Inventory of npm scripts (runtime-related)

| Script | Implementation | Notes |
|--------|----------------|-------|
| `bootstrap` | `npm ci` + `runtime:prepare` | Full tool install intent |
| `runtime:prepare` | `tools.mjs install --profile full` | No Python |
| `tools:check/install/repair/update` | `tools.mjs … --profile full` | Public scripts always full |
| `setup:tools` | `setup-tools.mjs --full` | Direct installer entry |
| `check:tools` / `repair:tools` | Alias to maint `tools.mjs` | Prefer these over legacy scripts |
| `python:install/check/repair` | `python.mjs` default **core** | Opt-in |
| `python:models` | On-demand weights | |
| `test:python` | Bridge unittests via venv/system | |
| `doctor` | Full env diagnostics, no download | No Python section |
| `deps:check` / `deps:prune` | Import scan + npm audit | Network for audit |

**Not present in `package.json` (but expected by maint test + BUILD narrative):**

- `predev`, `prebuild`, `prestart` → `npm run runtime:prepare`

---

## 5. Component findings (detailed)

### 5.1 `tools.mjs` + `tools-probe.mjs` + `manifest.mjs`

**Strengths**

- Clear commands: check / install / repair / update.
- Prefer system binaries; skip re-download of healthy tools.
- Atomic manifest writes (`tmp` + rename) with legacy `config.json` lockstep.
- Size+mtime identity cache avoids expensive re-hash/re-exec on hot path.
- FFmpeg/ffprobe co-location logic.
- Feature flags for OCR / PDF extras / ImageMagick reporting.
- Path safety helpers refuse deleting outside `.runtime`/`.tools`.

**Issues**

1. **`pandoc` dual story**  
   - `TOOL_PROFILES.full` always includes `pandoc`.  
   - `featureFlags().pandocRequired` defaults **false** and comments claim Pandoc is opt-in / unused in 3.6.  
   - `featureGate: 'pandocRequired'` on the pandoc def is **ineffective** because tier is `required`, not `feature`.  
   - Result: public `tools:* --profile full` **always requires** pandoc regardless of `ALPHA_REQUIRE_PANDOC`.

2. **Checksums on install are soft**  
   - Manifest may store SHA-256 of executables &lt; 80 MiB after install.  
   - Download archives in `setup-tools.mjs` have **no pinned checksum verification** before extract.

3. **Floating FFmpeg URLs**  
   - Windows/Linux use BtbN `…/latest/…` and macOS `evermeet.cx/ffmpeg/getrelease/zip` — non-reproducible.

4. **Legacy dual trees**  
   - Migration and multi-root search increase complexity; risk of resolving stale `.tools` copies if identity cache is weak.

### 5.2 `setup-tools.mjs`

**Strengths**

- System-first, project-local second.
- Windows LO MSI administrative extract; Linux LO AppImage extract; Calibre official dist channels.
- Staging cleanup (unless `ALPHA_KEEP_TOOL_DOWNLOADS=1`).
- Pandoc versions pinned (3.6.4); LO MSI version pinned (25.8.7).

**Issues**

1. **No archive integrity (SHA)** for any download unit — supply-chain / CDN integrity gap (RT-P1-02).
2. **Linux ARM64 LO** explicitly not portable-auto; requires distro packages (documented).
3. **macOS 7z** not auto-downloaded (brew message only).
4. Writes `.runtime/config.json` but full atomic manifest sync is owned by `tools.mjs` after spawn — direct `setup:tools` alone can leave manifest stale until `tools:repair`/`tools:check` sync path.
5. **Legacy scripts** `scripts/check-tools.mjs` / `repair-tools.mjs` still target **`.tools/config.json`**, not `.runtime` — dead footguns if invoked directly (npm aliases no longer use them).

### 5.3 `doctor.mjs`

**Strengths**

- Environment, workspace node_modules, sharp presence, SQLite/schema hint, storage writability, elevation, port bind check, tool status via cache.
- Explicitly does not download.

**Gaps**

- **No Python section** (venv, fingerprint, selfcheck).
- **No optional PDF binary section** (tesseract/pdftoppm/gs/qpdf/mutool) beyond tools-probe feature gates.
- Critical exit only on required Phase 1 tools + write permissions; optional gaps are WARN only (by design).

### 5.4 `python.mjs` + bridge + profiles

**Profiles / requirements**

| Profile | File | Contents (summary) |
|---------|------|--------------------|
| core | `requirements-core.txt` | Empty (stdlib) |
| data | `requirements-data.txt` | pandas, openpyxl, pyarrow |
| documents | `requirements-documents.txt` | weasyprint, markdown, camelot-py |
| vision | `requirements-vision.txt` | opencv, numpy, Pillow, rembg, onnxruntime |
| ocr | `requirements-ocr.txt` | ocrmypdf, pytesseract |
| ai | `requirements-ai.txt` | faster-whisper, onnxruntime, llama-cpp-python |

**Strengths**

- Truly opt-in relative to bootstrap.
- Fingerprint skip when unchanged.
- Model install separate from jobs; empty `sha256` refuses without `--allow-unverified`.
- Bridge: no shell, path confinement, progress protocol, SIGTERM cooperative cancel, best-effort `RLIMIT_AS` on POSIX.
- Node applies proxy-blocked env for bridge children.

**Issues**

1. **`camelot` missing from `OPTIONAL_MODULES`** while `PYTHON_OPERATIONS` requires `camelot` for `pdf.extract-tables` → selfcheck never reports camelot → **capability always unavailable** even after documents profile install (RT-P1-03).
2. **Single-profile fingerprint** — last profile wins; no multi-profile lock or cumulative requirements install. Switching profiles does not uninstall packages; `python:check --profile X` fails if fingerprint is for Y.
3. **`u2net` model `sha256` empty** in `models.lock.json` — verified install impossible without editing lock or using `--allow-unverified` (RT-P2).
4. **WeasyPrint native deps** (Pango/Cairo/GTK on Windows) not doctor-checked.
5. **OCR profile** needs host Tesseract/Ghostscript; not installed by Python installer and not by Phase 1 tools installer.
6. Python 3.14 observed on this host — upstream wheel support for heavy AI stacks may be fragile (unknown until profiles are installed).

### 5.5 `registry.ts` / `optional-binaries.ts` / `capabilities.ts`

**Strengths**

- Cache-first resolve with identity trust reduces startup cost.
- LibreOffice path normalization (`.com` on Windows) + install completeness heuristics.
- Optional PDF binaries have Windows well-known paths; rasterizer/OCR aggregate helpers.
- Explicit **unavailable** for unimplemented `pdf.decrypt` and hard-false `pdf.ocr.searchable` (Node PDF path) — honest about missing product features.
- Specialized Python ops merged into capabilities list.

**Issues**

1. **Optional PDF stack is discovery-only** — no portable install units for tesseract/poppler/gs/qpdf/mutool; BUILD correctly says OS packages, but doctor/tools:install cannot heal them.
2. **`pdf.ocr.searchable` (Node cap id) vs `pdf.ocr-searchable` (Python pyop)** — naming/product dual path; UI/docs often treat searchable OCR as permanently unavailable while Python path exists behind profile.
3. **`BUNDLED_CAPABILITIES` always true** — does not verify sharp/pdf-lib loadability; doctor only WARNs if sharp package missing.
4. **Dead helper** `detectBinary` in capabilities.ts appears unused (minor hygiene).
5. Capability cache is process-lifetime; refresh via query param exists on `/api/capabilities`, but optional binaries use 60s TTL separately.

### 5.6 `deps.mjs`

**Strengths**

- Conservative prune (proven unused only, NEVER_PRUNE, re-scan).
- Scope checks root vs server packages.
- npm audit invocation via `runNpm` (Windows-safe npm-cli path).

**Issues**

- Audit requires network; offline fails soft with parse notes.
- Scanner is heuristic (may miss dynamic `require(variable)`).

### 5.7 Docs claims verification

| Claim source | Claim | Verdict |
|--------------|-------|---------|
| BUILD §2 | `bootstrap`, **`dev`**, **`build`**, **`start`** all prepare full runtime | **FALSE** — only `bootstrap`/`runtime:prepare`; no `predev`/`prebuild`/`prestart` in `package.json` |
| BUILD §2 | tools scripts always `--profile full` | **TRUE** |
| BUILD §7 | missing tools re-fetched on dev/build/start | **FALSE** without prehooks |
| python-runtime.md | Python not in bootstrap/runtime:prepare | **TRUE** |
| python-runtime.md | models never auto-download during jobs | **TRUE** (code path fails with hint) |
| python-runtime.md | core is stdlib-only | **TRUE** |
| RUNTIME_VALIDATION.md | `test:audit` / `audit:backend` passed | **UNTRUSTED** — `STATE.md` notes missing `scripts/audit/`; not re-proven here |
| RUNTIME_VALIDATION.md | shell:false for process spawning | **TRUE** for reviewed tool/Python spawn paths |
| maint-core.test.mjs | `predev`/`prebuild`/`prestart` == runtime:prepare | **FAIL vs package.json** (test/product drift) |

---

## 6. Findings table (classified)

Severity guide used for this audit:

| Sev | Meaning |
|-----|---------|
| **P0** | Data loss / RCE / unusable core product with no workaround |
| **P1** | Blocks correctness of runtime/capability system or fails stated gates/tests |
| **P2** | Significant reliability, integrity, or ops friction |
| **P3** | Medium hygiene / doc drift / incomplete diagnostics |
| **P4** | Low polish, dead code, nice-to-have |

### P0

_None confirmed in this scope from static review._

### P1

| ID | Title | Evidence | Impact |
|----|-------|----------|--------|
| **RT-P1-01** | Missing `predev` / `prebuild` / `prestart` hooks vs tests + BUILD | `package.json` lacks scripts; `maint-core.test.mjs` asserts them equal to `runtime:prepare`; BUILD claims auto full runtime on dev/build/start | `npm run test:maint` expected fail; operators can `dev`/`start` without tools; doc overpromise |
| **RT-P1-02** | Portable tool downloads lack checksum verification | `setup-tools.mjs` download→extract with no SHA; only post-install `--version` probe | Compromised/corrupt CDN artifact can land in `.runtime` |
| **RT-P1-03** | `pdf.extract-tables` permanently gated off by selfcheck | `PYTHON_OPERATIONS` requires `camelot`; `OPTIONAL_MODULES` omits `camelot` | Documents profile cannot advertise/run table extraction via capability gate |
| **RT-P1-04** | Release validation doc claims untrustable in-repo audit scripts | `RUNTIME_VALIDATION.md` claims `test:audit`/`audit:backend` green; `STATE.md` says `scripts/audit/` missing | False confidence in prior “release validated” narrative |

### P2

| ID | Title | Evidence | Impact |
|----|-------|----------|--------|
| **RT-P2-01** | FFmpeg (and some LO/Calibre channels) use floating/latest URLs | `URLS.ffmpegWin/Linux` …`/latest/…`; Calibre dist redirects | Non-reproducible installs; surprise breakage |
| **RT-P2-02** | Optional PDF/OCR host binaries not installable by tools:install | `optional-binaries.ts` PATH-only; feature flags only report | Advanced PDF/OCR “available” depends on opaque OS packages |
| **RT-P2-03** | Python multi-profile model is last-write fingerprint | `fingerprint.json` single profile field | Operators cannot express “data+documents+ocr installed” cleanly; check flaky |
| **RT-P2-04** | `u2net` has empty sha256 | `python/models.lock.json` | Background-removal model install requires unverified download |
| **RT-P2-05** | Bundled capabilities ignore actual sharp install health | `BUNDLED_CAPABILITIES` always available | Jobs may queue then fail if native sharp missing |
| **RT-P2-06** | Searchable OCR dual identity | `pdf.ocr.searchable` hard false vs pyop `pdf.ocr-searchable` | Product/docs confusion; feature appears dead while alternate path exists |
| **RT-P2-07** | Direct `setup:tools` vs `tools:install` manifest parity | setup writes config; tools.mjs owns full manifest upsert | Partial installs / direct script use can desync server cache |

### P3

| ID | Title | Evidence | Impact |
|----|-------|----------|--------|
| **RT-P3-01** | Doctor omits Python and optional PDF stack | `doctor.mjs` sections | “Doctor passed” can hide missing Python/OCR |
| **RT-P3-02** | Ineffective `pandocRequired` flag vs full profile | `platform.mjs` vs `TOOL_PROFILES.full` | Confusing env knobs; always download pandoc on full |
| **RT-P3-03** | Legacy `check-tools.mjs` / `repair-tools.mjs` use `.tools` | scripts root | Footgun if called by path |
| **RT-P3-04** | LibreOffice MSI may leave large artifacts in tree | observed `LibreOffice.msi` under portable tree on host | Disk bloat (host-specific; staging cleanup intended) |
| **RT-P3-05** | ImageMagick listed optional but no Phase 1 use | tools-probe def | Noise in check output |
| **RT-P3-06** | BUILD_AND_RUN language overstates auto-heal on every command | §2, §7 | Operator false expectations |

### P4

| ID | Title | Notes |
|----|-------|-------|
| **RT-P4-01** | Unused `detectBinary` in capabilities.ts | Hygiene |
| **RT-P4-02** | `void NAMES` keep-alive in optional-binaries | Hygiene |
| **RT-P4-03** | Help text still mentions `.tools` in places | Registry requireTool hints mix `.tools` and tools:install |
| **RT-P4-04** | Size estimates are static approximations | Acceptable for UX only |

---

## 7. Severity counts

| Severity | Count |
|----------|------:|
| P0 | 0 |
| P1 | 4 |
| P2 | 7 |
| P3 | 6 |
| P4 | 4 |
| **Total** | **21** |

---

## 8. Dependencies and coupling

```text
package.json scripts
  ├─ tools.mjs ── tools-probe / platform / manifest / checksum
  │     └─ spawn → setup-tools.mjs (network downloads)
  ├─ python.mjs ── checksum / paths ── pip / models.lock
  │     └─ server convert/engines/python.ts (resolve + bridge)
  ├─ doctor.mjs ── tools-probe + platform + better-sqlite3 (optional schema)
  └─ deps.mjs ── runNpm (audit)

server runtime
  ├─ tools/registry.ts ◄── .runtime/config.json + manifest.json
  ├─ tools/optional-binaries.ts ◄── PATH / Program Files only
  ├─ capabilities.ts ◄── registry + optional + python specialized
  ├─ processors/assertJobCapable
  └─ convert engines (ffmpeg, libreoffice, pandoc, calibre, python)
```

**External runtime dependencies (not in npm lockfile):**

- System or portable: FFmpeg, ffprobe, 7-Zip, LibreOffice, Pandoc, Calibre  
- Optional OS: Tesseract, Poppler (`pdftoppm`/`pdftotext`), Ghostscript, MuPDF `mutool`, qpdf  
- Optional Python host: Python ≥3.10 + profile wheels + native libs (GTK/Pango for WeasyPrint, etc.)  
- Network: GitHub releases, Document Foundation, Calibre CDN, Hugging Face (models)

---

## 9. Risks

| Risk | Likelihood | Impact | Notes |
|------|------------|--------|-------|
| Compromised or corrupt tool archive accepted | Med | High | No download SHA (RT-P1-02) |
| Operators ship without tools after `npm install` only | High | Med | No prehooks; only bootstrap prepares |
| Capability UI lies about table OCR/extract ops | High | Med | camelot selfcheck gap; dual OCR ids |
| Non-reproducible FFmpeg builds break matrix probes | Med | Med | floating `latest` |
| Python AI wheels fail on newest CPython (e.g. 3.14) | Med | Med | Not verified this pass |
| Disk pressure from full runtime ~2+ GiB | High | Low–Med | Documented |
| Stale manifest trust after binary replace with same size/mtime rare collision | Low | Med | identity cache design tradeoff |

---

## 10. Unknowns (need execution / other audits)

1. Whether `npm run test:maint` currently fails solely due to RT-P1-01 on this tree (static assert strongly implies yes; not re-run).
2. Fresh cold install success rate for LO MSI / Calibre MSI on clean Windows without system LO.
3. Linux x64 AppImage LO + isolated Calibre under minimal glibc images.
4. Linux ARM64 system-package path quality for FFmpeg/LO.
5. Whether Pandoc is actually required for any remaining converter routes in 3.6 matrix (code still registers pandoc engine — audit 02 depth).
6. Real importability of ocrmypdf/faster-whisper/llama-cpp on managed venv for this host’s Python 3.14.
7. Whether leftover `LibreOffice.msi` inside portable tree is systematic or host-specific incomplete cleanup.
8. Interaction of capability process cache with long-lived servers after tools:repair without refresh query.
9. Supply-chain status of BtbN / evermeet / calibre-ebook.com endpoints over time.

---

## 11. Stabilization plan (runtime/tools only)

Ordered for risk reduction without expanding product scope.

### Phase A — Gate honesty (P1 docs/tests)

1. **Align package.json with tests OR align tests with product intent**  
   - Option A (matches BUILD/test): add  
     `"predev": "npm run runtime:prepare"`,  
     `"prebuild": "npm run runtime:prepare"`,  
     `"prestart": "npm run runtime:prepare"`.  
   - Option B (lighter UX): remove prehook asserts from `maint-core.test.mjs` and rewrite BUILD §2/§7 to state tools install is **bootstrap/tools:install only**.  
   - Decision needed: full auto-heal vs faster `dev` iteration.
2. Fix **`OPTIONAL_MODULES` to include `camelot`** (and any other specialized requires missing from selfcheck).
3. Quarantine or rewrite **`RUNTIME_VALIDATION.md`** claims that depend on missing audit scripts (cross-link STATE).

### Phase B — Install integrity (P1/P2)

1. Pin FFmpeg download URLs to versioned releases + record SHA-256 in a lockfile (mirror models.lock pattern).
2. Verify SHA after download, before extract, for every setup-tools unit.
3. Ensure `setup-tools.mjs` and `tools.mjs` always finish with the same atomic manifest+config write path.

### Phase C — Capability clarity (P2)

1. Unify searchable OCR story: either expose Python `pdf.ocr-searchable` under a single capability id or document Node false vs pyop true explicitly in API.
2. Soft-check sharp load in doctor (and optionally in `isToolAvailable` for image.*).
3. Extend doctor with: Python fingerprint/profile, optional PDF binaries, feature flags.

### Phase D — Python profiles (P2/P3)

1. Support multi-profile fingerprint (`profiles: string[]` or hash of union of requirement files).
2. Fill `u2net` sha256 or document mandatory `--allow-unverified`.
3. Document WeasyPrint native prerequisites per OS in doctor WARN.

### Phase E — Dead code / legacy

1. Delete or rewire `scripts/check-tools.mjs` / `repair-tools.mjs` to maint, or add hard deprecation print+exit.
2. Resolve pandocRequired vs full profile policy (either drop from full or make flag work).

### Exit criteria for “runtime tools stable enough”

- [ ] `npm run test:maint` green against real package.json contract  
- [ ] `npm run tools:check -- --force` exit 0 on reference Win x64 + Linux x64 after documented bootstrap  
- [ ] `npm run doctor` exit 0; documents optional gaps without false FAIL  
- [ ] Download lock + checksum verification for all auto-fetched tools  
- [ ] Python selfcheck modules ⊇ all specialized `requires`  
- [ ] Docs (BUILD, python-runtime, RUNTIME_VALIDATION) match scripts; no unbacked green claims  
- [ ] Evidence attached under `docs/stabilize/` for one cold install per supported OS class  

---

## 12. Recommended test / smoke matrix (for later checkpoints)

| Gate | Command | What it proves |
|------|---------|----------------|
| Maint unit | `npm run test:maint` | path safety, manifest, profile selection, script surface |
| Tools | `npm run tools:check -- --force` | live binary resolve |
| Doctor | `npm run doctor` | env + required tools |
| Python core | `npm run python:install && npm run test:python` | bridge stdlib ops |
| Python data | `python.mjs install --profile data` + focused engine tests | optional routes |
| Caps API | server up → `GET /api/capabilities?refresh=1` | gating matches binaries |
| Negative | remove ffmpeg from PATH/config → media caps unavailable, no fake success | honesty |

---

## 13. Evidence index (paths reviewed)

### Code

- `C:\Users\Duy\Code\Project\AlphaStudio\package.json`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\tools.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\python.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\doctor.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\deps.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\lib\tools-probe.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\lib\platform.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\lib\manifest.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\lib\checksum.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\lib\paths.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\maint\tests\maint-core.test.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\setup-tools.mjs`
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\check-tools.mjs` (legacy)
- `C:\Users\Duy\Code\Project\AlphaStudio\scripts\repair-tools.mjs` (legacy)
- `C:\Users\Duy\Code\Project\AlphaStudio\python\bridge.py`
- `C:\Users\Duy\Code\Project\AlphaStudio\python\operations\__init__.py`
- `C:\Users\Duy\Code\Project\AlphaStudio\python\requirements-*.txt`
- `C:\Users\Duy\Code\Project\AlphaStudio\python\models.lock.json`
- `C:\Users\Duy\Code\Project\AlphaStudio\server\src\tools\registry.ts`
- `C:\Users\Duy\Code\Project\AlphaStudio\server\src\tools\optional-binaries.ts`
- `C:\Users\Duy\Code\Project\AlphaStudio\server\src\capabilities.ts`
- `C:\Users\Duy\Code\Project\AlphaStudio\server\src\convert\engines\python.ts`
- `C:\Users\Duy\Code\Project\AlphaStudio\server\src\processors\index.ts`
- `C:\Users\Duy\Code\Project\AlphaStudio\server\src\routes\system.ts`

### Docs (claims)

- `docs/python-runtime.md`
- `docs/BUILD_AND_RUN_WINDOWS_LINUX.md`
- `RUNTIME_VALIDATION.md`
- `docs/stabilize/STATE.md`

### Passive host state (not a validation certificate)

- `.runtime/config.json` (tools resolved)
- `.runtime/python/fingerprint.json` (core profile)
- `.runtime/tools/win32-x64/{libreoffice,calibre,pandoc}/…` present

---

## 14. Bottom line

The runtime tooling stack is **ambitious and mostly well-structured**: portable installs under `.runtime`, atomic manifests, system-preferring resolution, opt-in Python with a clean one-shot bridge, and capability gating that refuses to fake missing engines.

It is **not yet audit-clean for stabilization** because:

1. **Contract drift** between `package.json`, maint tests, and BUILD (prehooks / auto full runtime).  
2. **Download integrity** is probe-only, not checksum-locked.  
3. **Python capability selfcheck** is incomplete (`camelot`).  
4. **Optional PDF/OCR** remains outside the installer story.  
5. **Prior validation docs** must not be reused as proof.

No P0 was proven from static review. Highest-priority fixes are RT-P1-01 … RT-P1-04 and checksum pinning before calling the runtime “stable.”

---

*End of audit 05. Product code unchanged; this file is the sole deliverable of the runtime/tools audit pass.*
