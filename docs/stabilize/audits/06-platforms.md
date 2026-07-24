# Audit 06 — Platforms (Windows, Linux, Docker, home server, VPS)

**Program:** AlphaStudio stable baseline  
**Scope:** (f) Windows, Linux, Docker, home server, and VPS **only**  
**Out of scope for this file:** macOS as a first-class target (code may mention it; no macOS claim), product feature work, live multi-OS execution  
**Date:** 2026-07-24  
**Auditor:** independent stabilize pass (static/docs/script inspection)  
**Repo base (topology):** `ed460ee763663eef3f0aae9080eeb5e15c68fe1c`  
**Method:** read-only inspection of docs, `package.json` / `server/package.json`, maint scripts, server path/bind/worker code. **No multi-OS runtime matrix was executed in this pass.**

---

## 1. Executive summary

AlphaStudio is a **local-first Node 20+ monorepo** designed to build and run on **Windows x64** and **Linux x64**, with portable external tools under `.runtime/tools/<platform>-<arch>/`, native addons (`better-sqlite3`, `sharp`), and optional Python under `.runtime/python/<platform>-<arch>/`. Platform detection and portable-tool layout are centralized in `scripts/maint/lib/platform.mjs`. Cross-process job work uses `child_process.fork` workers with Windows-aware process-tree kill (`taskkill /T /F`) vs POSIX process groups.

**Docker, CI, and VPS packaging are largely absent as first-class artifacts:**

| Artifact | Status (this pass) | Evidence |
|----------|--------------------|----------|
| Root `Dockerfile` | **Absent** | Repo inventory / path search; only narrative mentions in docs |
| `docker-compose*.yml` | **Absent** | Same |
| `.github/` workflows | **Absent** | Directory does not exist; `docs/stabilize/TOPOLOGY.md` + `STATE.md` agree |
| systemd / nssm / pm2 unit | **Absent** | No unit files under repo |
| Official container image | **Absent** | No publish pipeline in tree |

Documented LAN/home-server bind is possible (`HOST=0.0.0.0` + token), but the product **does not provide TLS, reverse-proxy config, or application rate limiting**. Public Internet / untrusted VPS exposure is **explicitly discouraged** by project docs.

**Verified-on claim (docs only, not re-run here):** `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` §11 states Phase 1 full-install was built/tested on **Windows x64, Node 24** (2026-07-19). Linux is described as container/source-level verification with capability still distro-dependent. **This audit did not re-execute those runs.**

---

## 2. Inventory of platform-relevant surfaces

### 2.1 Documentation

| Path | Role for platforms |
|------|--------------------|
| `README.md` | Node 20+, bootstrap vs app-only, Windows/Linux `.env` copy, optional Python, pointer to BUILD_AND_RUN |
| `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` | Primary Win/Linux install, prerequisites, LAN, low-RAM, backup, tool profiles, brief Docker/WSL notes |
| `docs/PDF_TOOLS_SETUP.md` | Optional PDF binaries per OS (Poppler, Ghostscript, Tesseract, qpdf) |
| `docs/python-runtime.md` | Platform-arch venv layout; POSIX-only `RLIMIT_AS` memory cap |
| `docs/job-engine.md` | Windows `taskkill` vs POSIX kill; supervisor / WAL notes |
| `docs/stabilize/TOPOLOGY.md` / `STATE.md` | Process inventory: no `.github/`, no root Docker/compose |
| `RUNTIME_VALIDATION.md` | Historical Windows-oriented release notes (not re-evidence for this pass) |

### 2.2 Engines and package metadata

| Item | Location | Observation |
|------|----------|-------------|
| Root engines | `package.json` → `"node": ">=20"` | Aligns with README |
| Server engines | `server/package.json` → `"node": ">=20"` | Same |
| Workspaces | root `workspaces: ["server"]` | Single lockfile at repo root; **do not** `npm install` inside `server/` alone (documented) |
| Native allowlist | root `allowScripts` | `better-sqlite3@12.11.1`, `sharp@0.35.3`, esbuild variants enabled for postinstall/native |
| `better-sqlite3` | `server` dependency | Native addon; prebuild-install in lockfile |
| `sharp` | `server` dependency | Platform optional deps (incl. linux musl / win32 / arm64 variants in lockfile) |

### 2.3 Platform / path / tools scripts

| Path | Role |
|------|------|
| `scripts/maint/lib/platform.mjs` | `detectPlatform`, arch labels, tools roots, `which`, elevation, `runNpm` (Windows `.cmd` avoidance), legacy `.tools` migration |
| `scripts/maint/lib/paths.mjs` | Safe delete under project root; rejects Windows drive-letter abs paths when host is non-Windows |
| `scripts/maint/lib/tools-probe.mjs` | Tool discovery, `.exe` vs bare names, well-known Windows Program Files paths |
| `scripts/maint/tools.mjs` | check/install/repair/update → delegates install to `scripts/setup-tools.mjs` |
| `scripts/setup-tools.mjs` | Portable download matrix (Win / Linux / macOS URLs); LO MSI vs AppImage; Calibre MSI/isolated installer |
| `scripts/maint/python.mjs` | venv per `process.platform-process.arch` |
| `scripts/check-tools.mjs`, `repair-tools.mjs` | Older/alternate tool helpers (still platform-aware) |

### 2.4 Server runtime platform hooks

| Path | Role |
|------|------|
| `server/src/config.ts` | `HOST` default `127.0.0.1`, `DATA_DIR`/`DB_PATH` via `path.resolve`, adaptive worker pool from `os.cpus` / `os.freemem` |
| `server/src/lib/bind-guard.ts` | Blocks non-loopback bind without `API_AUTH_TOKEN` / `ALLOW_INSECURE_BIND` |
| `server/src/app.ts` | Bearer token when configured; **no app rate limit**; CORS origin rules |
| `server/src/lib/paths.ts` | `safeJoin` / `assertInsideRoot` using `path.resolve` + `path.sep` |
| `server/src/lib/child-registry.ts` | Spawn with `windowsHide`; Windows `taskkill /T /F`; POSIX `detached` + `kill(-pid)` |
| `server/src/workers/jobs.ts` | `fork` workers; `detached: process.platform !== 'win32'`; source mode uses `tsx` |
| `server/src/convert/engines/python.ts` | venv path `Scripts/python.exe` vs `bin/python` |
| `server/src/index.ts` | SIGINT/SIGTERM + IPC shutdown for supervisors |

### 2.5 Explicit absences (verified this pass)

- **No** `.github/` directory (list_dir: path does not exist).
- **No** root or nested product `Dockerfile` / `docker-compose` (content search only hits stabilize inventory docs; no compose/Dockerfile files present as product assets).
- **No** systemd unit, Windows Service wrapper, or reverse-proxy sample configs in-tree.

---

## 3. Windows

### 3.1 Documented support

- PowerShell 7 or Windows PowerShell (`docs/BUILD_AND_RUN_WINDOWS_LINUX.md` §3).
- Node 20+ (20/24 LTS recommended).
- Bootstrap: `npm run bootstrap` → `npm ci` + `runtime:prepare` (full portable tool profile).
- Production: `npm run build` && `npm start` → `http://127.0.0.1:8787`.
- Fonts for text/Markdown→PDF: Arial/Segoe UI (system).

### 3.2 Code / script adaptations observed

| Concern | Implementation |
|---------|----------------|
| Platform id | `process.platform === 'win32'` → `os: 'windows'` |
| Tool names | `.exe` / `soffice.com` preferred over `soffice.exe` for CLI reliability |
| System well-known paths | LibreOffice, Calibre, 7-Zip under `C:\Program Files\...` |
| Portable LO/Calibre | `msiexec /a` administrative extract (no full system install) |
| npm spawn | `findNpmCli` + `node npm-cli.js` to avoid `spawnSync('npm.cmd')` → EINVAL with `shell:false` |
| Process kill | `taskkill /PID … /T /F` via `execFile` |
| Worker fork | not detached on Windows |
| Elevation detect | `net session` (informational only; portable tools do not require admin) |
| Python venv | `.runtime/python/win32-<arch>/venv/Scripts/python.exe` |

### 3.3 Native modules (Windows)

- `better-sqlite3`: requires matching prebuild or build tools for the Node ABI in use; postinstall allowed via `allowScripts`.
- `sharp`: ships `@img/sharp-win32-*` optional packages; rebuild after Node major switch is a documented failure mode (`BUILD_AND_RUN` §10: wipe `node_modules` + re-bootstrap).

### 3.4 Windows risks

| ID | Sev | Finding |
|----|-----|---------|
| PLAT-W1 | P2 | Documented “verified” matrix is historical (Win x64 Node 24); **not re-run** this pass; no CI gate to prevent regressions. |
| PLAT-W2 | P2 | `path.resolve` + `startsWith(root + sep)` guards are case-sensitive; rare Windows path case mismatches (`C:\` vs `c:\`) can theoretically reject valid paths or confuse equality checks. |
| PLAT-W3 | P3 | Large MSI downloads (LibreOffice ~300 MiB, Calibre ~220 MiB) and long `msiexec` timeouts depend on network and disk; failure modes are documented but require manual repair. |
| PLAT-W4 | P3 | Optional PDF extras (Poppler/Ghostscript/Tesseract/qpdf) are **manual** Windows installs (`PDF_TOOLS_SETUP.md`); not part of Converter Phase 1 `full` profile. |

### 3.5 Windows — not executed here

Full bootstrap, `tools:check --force`, `npm test`, production smoke on this auditor host: **not claimed**.

---

## 4. Linux

### 4.1 Documented support

- Linux **x64** primary portable path; apt-style prerequisites: `tar`, `unzip`, `xz-utils`, `python3`, `xdg-utils`, EGL/OpenGL and XCB cursor libs for portable LO/Calibre (`BUILD_AND_RUN` §1, §4).
- LibreOffice: AppImage download + `--appimage-extract` into `.runtime` (no `/usr` write).
- Calibre: official isolated binary installer; docs claim **GLIBC 2.34+** and libstdc++ from GCC 11.4+.
- Linux **ARM64**: portable FFmpeg/LibreOffice **not** fully auto-installed; install via distro packages then `tools:install` (Pandoc/7-Zip/Calibre ARM64 still handled per docs).
- WSL: use Linux tools in the distro, **not** `win32-*` trees under `.runtime`.

### 4.2 Code / script adaptations observed

| Concern | Implementation |
|---------|----------------|
| FFmpeg portable URL | **linux64 only** (`ffmpeg-master-latest-linux64-gpl.tar.xz`) — no linux-arm64 URL in `setup-tools.mjs` |
| LibreOffice portable | AppImage **x86_64** only; ARM falls through to “install distro packages” |
| 7-Zip / Pandoc | Explicit linux-arm64 vs x64 URLs |
| Executable bit | `chmod` 0o755 after extract; `isExecutableFile` checks mode bits on non-Windows |
| Elevation | `uid === 0` (informational) |
| Process kill | process group `kill(-pid, SIGKILL)` when detached |
| Fonts | DejaVu/Liberation/Noto; optional `PDF_FONT_PATH` for minimal images |

### 4.3 Native modules (Linux)

- `sharp` lockfile includes **gnu and musl** linux packages (`@img/sharp-linux*`, `@img/sharp-linuxmusl*`) — favorable for Alpine **if** npm install runs on the target libc; cross-copying `node_modules` between glibc and musl will break.
- `better-sqlite3` prebuilds are ABI/platform specific; Alpine/musl often needs compile toolchain if prebuild missing.
- Calibre/FFmpeg static vs distro: musl containers may not run glibc-linked portable trees.

### 4.4 Linux risks

| ID | Sev | Finding |
|----|-----|---------|
| PLAT-L1 | P1 | **Linux ARM64 / non-x64 portable gap:** FFmpeg installer always uses `linux64` URL; LibreOffice AppImage is x86_64-only. ARM servers (many VPS/home SBCs) need system packages; easy to mis-advertise “full” capability after a partial install. |
| PLAT-L2 | P1 | **glibc / distro floor (Calibre):** documented GLIBC 2.34+ excludes older LTS images without careful package choice; no automated preflight for glibc version in maint scripts (static observation). |
| PLAT-L3 | P2 | **Headless / server libraries:** portable LO/Calibre need XCB/EGL packages even headless; missing libs → silent tool probe failures until `tools:check --force`. |
| PLAT-L4 | P2 | **AppImage extract** needs a working AppImage runtime extract path; script uses `--appimage-extract` (good for no-FUSE), but download CDN (`appimages.libreitalia.org`) is an external SPOF. |
| PLAT-L5 | P3 | Docs lean Debian/Ubuntu apt; Fedora covered only for PDF extras; RHEL/SLES/Alpine not first-class. |

### 4.5 Linux — not executed here

No Linux host/container run in this audit. Any prior “Linux container test” language in docs is **not** re-proven.

---

## 5. Docker

### 5.1 What exists

- **Narrative only** in `BUILD_AND_RUN` §4: mount source/data separately; run `npm run bootstrap` inside the image; expect **~+2.3 GiB** for full runtime; ensure disk for layers and `.runtime/tools`.
- Converter plan docs mention optional Docker/WSL as future validation targets — not shipped packaging.

### 5.2 What is missing

| Expected for Docker-ready product | Present? |
|-----------------------------------|----------|
| `Dockerfile` (multi-stage build) | **No** |
| `docker-compose.yml` (app + volumes for `data/`, `.runtime/`) | **No** |
| `.dockerignore` | **No** |
| Documented base image pin (Node 20/24 bookworm vs alpine) | **No** |
| Non-root user, healthcheck, volume contracts | **No** |
| CI build of image | **No** (no `.github/`) |

### 5.3 Docker-oriented technical implications (static)

| Topic | Implication |
|-------|-------------|
| Image size | Full tools ≈ multi-GiB; slim “app-only” image leaves converters unavailable (by design) |
| Writable paths | Needs write to `data/` and usually `.runtime/` (or pre-baked tools layer) |
| Bind host | Container publish maps to non-loopback; **must** set `API_AUTH_TOKEN` or `ALLOW_INSECURE_BIND` or process refuses bind (`bind-guard.ts`) |
| LibreOffice | AppImage extract approach is more container-friendly than FUSE mount |
| Alpine/musl | Higher risk for native modules + glibc portable binaries; Debian/Ubuntu base is the implied path |
| Init/PID 1 | SIGTERM handled in `index.ts`; no dumb-init/tini config shipped |

### 5.4 Docker findings

| ID | Sev | Finding |
|----|-----|---------|
| PLAT-D1 | P1 | **No Dockerfile/compose** — Docker is undocumented experiment territory despite product docs mentioning it. Home-lab users must invent images; high variance and security footguns. |
| PLAT-D2 | P2 | No sample compose for persistent `data/` volume + secrets env — easy to lose workspaces or bake `.env` into layers. |
| PLAT-D3 | P3 | No `.dockerignore` guidance (would otherwise risk copying `node_modules`, `data/`, local `.runtime` into build context if a Dockerfile is added later). |

---

## 6. Home server (LAN)

### 6.1 Documented model

From `BUILD_AND_RUN` §9 and `.env.example`:

```dotenv
HOST=0.0.0.0
CORS_ORIGIN=http://192.168.1.20:8787
API_AUTH_TOKEN=replace-with-a-long-random-token
VITE_API_TOKEN=replace-with-the-same-token
```

Then rebuild frontend (`VITE_API_TOKEN` is **build-time embedded**) and `npm start`.

Default remains loopback-only (`HOST=127.0.0.1`) — safe for single-machine use.

### 6.2 Guardrails that help

- `assertSafeBindHost` refuses non-loopback without token or explicit `ALLOW_INSECURE_BIND=1`.
- Bearer check on `/api/*` except `/api/health` when token configured.
- Adaptive worker pool and documented low-RAM concurrency knobs (4–8 GiB machines).
- Data layout suitable for local backup: `data/` + `.env`; `.runtime` reinstallable.

### 6.3 Guardrails that are missing for multi-device LAN

| Gap | Detail |
|-----|--------|
| No TLS | Docs state AlphaStudio does not provide HTTPS |
| No rate limiting | `app.ts` comment: single-user personal app |
| Token in SPA bundle | Same token as API; not suitable beyond trusted LAN |
| CORS | Allows matching `CORS_ORIGIN` plus any `localhost`/`127.0.0.1` origin with a port — fine for dev, limited for multi-host LAN UI origins |
| Firewall | Windows inbound rule only if exposing; no Linux ufw/firewalld guide |
| Service management | No systemd user unit / Task Scheduler sample for reboot persistence |

### 6.4 Home server findings

| ID | Sev | Finding |
|----|-----|---------|
| PLAT-H1 | P2 | LAN mode is documented but **ops incomplete** (no service unit, no reverse-proxy sample, token-in-bundle caveat easy to miss). |
| PLAT-H2 | P2 | `ALLOW_INSECURE_BIND=1` exists as an escape hatch — powerful on a home server if copied from a blog without understanding. |
| PLAT-H3 | P3 | Resource guidance exists (workers=1 on 4–8 GiB) but no automated “small host” profile script. |

---

## 7. VPS (public or semi-public)

### 7.1 Product posture

Docs are explicit: **not** for public Internet without outer reverse proxy, TLS, authentication, and rate limiting. Frontend-embedded token is unsuitable for public defense. No app-level rate limit.

### 7.2 VPS packaging gaps

| Need | Status |
|------|--------|
| Hardened default bind | Loopback default is good; VPS users must deliberately open |
| TLS termination | External only; no Caddy/nginx samples |
| Process supervisor | SIGTERM/WAL checkpoint friendly code exists; no unit files |
| Multi-tenant isolation | Single SQLite file, shared data dirs — **single-user design** |
| CI deploy | No `.github/` |
| Secrets management | Plain `.env` file |

### 7.3 VPS findings

| ID | Sev | Finding |
|----|-----|---------|
| PLAT-V1 | P0 | **Public VPS without external hardening is unsafe by design** (no TLS, no rate limit, bearer token can leak via built SPA). Severity is “do not claim production-public readiness,” not a silent code RCE — but shipping without this clarity is a process P0 for stabilize messaging. |
| PLAT-V2 | P1 | No first-class deploy story (systemd + nginx/Caddy + certbot + fail2ban notes). Operators will improvise. |
| PLAT-V3 | P2 | SQLite + local disk model is fine for single-node VPS but needs backup/retention discipline (`TEMP_TTL_MS`, `WORKSPACE_RETENTION_MS`); concurrent multi-instance scale-out is not supported. |

---

## 8. Path handling and OS portability (cross-cutting)

### 8.1 Strengths

- Consistent `node:path` usage (`join`/`resolve`/`sep`) in server and maint libs.
- Archive extraction rejects absolute paths, drive letters, and `..` segments (`processors/archive.ts`).
- Maint `assertUnderRoot` normalizes both slash styles and rejects Windows abs paths on Unix hosts.
- Tool trees are **platform-arch segmented** (prevents WSL/Windows binary mix-ups if layout is respected).
- Spawns use argument arrays + `windowsHide`; docs claim `shell: false` discipline (`RUNTIME_VALIDATION.md`).

### 8.2 Weaknesses / edge cases

| ID | Sev | Finding |
|----|-----|---------|
| PLAT-P1 | P2 | Prefix checks via string `startsWith` are not case-normalized on Windows. |
| PLAT-P2 | P3 | Unicode path issues with external tools called out in older PDF audit docs; mitigation patterns exist for some PDF stages but not proven universal. |
| PLAT-P3 | P3 | Dual roots `.runtime` (canonical) and legacy `.tools` increase cognitive load for ops and Docker volume mounts. |

---

## 9. Native modules and optional runtimes

| Component | Platform notes | Risk |
|-----------|----------------|------|
| `better-sqlite3` | Native; single process-wide connection in `server/src/db/index.ts` | Node upgrade / OS copy of `node_modules` breaks until rebuild |
| `sharp` | Prebuilt per OS/arch/libc | Same; musl vs glibc |
| Portable FFmpeg/7z/Pandoc/LO/Calibre | Downloaded per platform; system PATH preferred | ARM / old glibc / offline install gaps |
| Optional PDF stack | Manual OS packages | Capability gating fail-closed (good) if missing |
| Python | Optional; venv per platform-arch; memory cap POSIX-only (`RLIMIT_AS` in `python/bridge.py`) | Windows lacks address-space cap; heavy AI profiles need explicit install + disk |

`package.json` `bootstrap` runs `runtime:prepare` (tools full). **Python is never part of bootstrap** (`python-runtime.md`).

---

## 10. Documentation consistency issues (platform-affecting)

| ID | Sev | Finding |
|----|-----|---------|
| PLAT-DOC1 | P2 | `BUILD_AND_RUN` §2 claims `dev` / `build` / `start` all invoke full runtime preparation. **Actual `package.json`:** only `bootstrap` → `runtime:prepare`; `dev`/`build`/`start` do not. **README is correct** (tools via `runtime:prepare` separately). Operators following BUILD_AND_RUN alone may assume tools appear without bootstrap/runtime:prepare. |
| PLAT-DOC2 | P3 | BUILD_AND_RUN is primarily Vietnamese; README English — fine, but dual sources of truth increase drift risk (already visible above). |
| PLAT-DOC3 | P3 | `RUNTIME_VALIDATION.md` and PDF “final report” docs are **historical**; stabilize topology already marks them non-proof without re-evidence. |

---

## 11. CI / release implications (platform matrix)

- **No `.github/` workflows** → no automated Windows/Linux matrix, no Docker image build, no scheduled `tools:check`.
- Platform regressions can only be caught by local maintainer discipline or external systems outside this tree.
- Cross-reference: stabilize audit **08-ci-release** should own CI design; this audit records the **platform impact** of absence as **P1 process risk**.

| ID | Sev | Finding |
|----|-----|---------|
| PLAT-CI1 | P1 | Zero in-repo multi-OS CI. Claimed Windows verification cannot be continuously enforced. |

---

## 12. Severity classification summary

| Sev | Meaning (this program) | Count (this audit) |
|-----|------------------------|--------------------|
| **P0** | Blocks honest “stable/public” claims or creates unacceptable default exposure narrative | 1 |
| **P1** | Major gap for stated platforms / deploy modes | 5 |
| **P2** | Material risk or doc/ops debt; workarounds exist | 9 |
| **P3** | Hardening, polish, secondary OS | 7 |
| **P4** | Nice-to-have | 0 listed |

### Consolidated finding table

| ID | Sev | Area | Summary |
|----|-----|------|---------|
| PLAT-V1 | **P0** | VPS/public | Not production-public ready: no TLS, no rate limit, SPA-embedded token; must remain “local/trusted LAN + external edge” |
| PLAT-L1 | **P1** | Linux ARM | Portable FFmpeg/LibreOffice not arm64; full profile misleading on ARM VPS/SBC |
| PLAT-L2 | **P1** | Linux | Calibre glibc floor; weak automated preflight |
| PLAT-D1 | **P1** | Docker | No Dockerfile/compose despite docs mentioning Docker |
| PLAT-V2 | **P1** | VPS | No deploy unit / reverse-proxy samples |
| PLAT-CI1 | **P1** | CI | No multi-OS CI in `.github/` (directory absent) |
| PLAT-W1 | **P2** | Windows | Historical verification only; not re-run this pass |
| PLAT-W2 / PLAT-P1 | **P2** | Paths | Windows path case / prefix checks |
| PLAT-L3 | **P2** | Linux | Headless shared-lib prerequisites easy to miss |
| PLAT-L4 | **P2** | Linux/Docker | LO AppImage CDN/extract dependency |
| PLAT-D2 | **P2** | Docker | No volume/secret compose pattern |
| PLAT-H1 | **P2** | Home server | LAN docs incomplete for ops persistence |
| PLAT-H2 | **P2** | Home server | `ALLOW_INSECURE_BIND` footgun |
| PLAT-V3 | **P2** | VPS | Single-node SQLite; backup discipline required |
| PLAT-DOC1 | **P2** | Docs | BUILD_AND_RUN vs package.json on when tools install |
| PLAT-W3 | **P3** | Windows | Large MSI install fragility |
| PLAT-W4 | **P3** | Windows | Optional PDF tools manual |
| PLAT-L5 | **P3** | Linux | Distro coverage thin beyond Debian/Ubuntu |
| PLAT-D3 | **P3** | Docker | No `.dockerignore` yet |
| PLAT-H3 | **P3** | Home server | No automated small-host profile |
| PLAT-P2 | **P3** | Paths | Unicode + external tools residual risk |
| PLAT-P3 | **P3** | Layout | Dual `.runtime` / `.tools` |
| PLAT-DOC2/3 | **P3** | Docs | Language dual-track / stale validation docs |

---

## 13. Stabilization plan (platforms only)

Ordered for the stabilize program. **Does not implement product features** unless a later fix checkpoint is opened.

### Phase A — Truth and messaging (process / docs)

1. Align `BUILD_AND_RUN` §2 with actual npm lifecycle (`bootstrap` / `runtime:prepare` vs `dev`/`build`/`start`).
2. Publish a clear **Supported platforms matrix** table: Windows x64 (primary), Linux x64 (primary), Linux arm64 (partial), Docker (unsupported official), VPS public (unsupported without edge).
3. Explicit **non-support** line for public VPS without reverse proxy + TLS + external rate limit.
4. Mark all historical validation docs as non-proof (already started in TOPOLOGY/STATE).

### Phase B — Evidence (re-run, not invented)

5. On a real **Windows x64** host: `npm run bootstrap`, `tools:check --force`, `npm run build`, focused tests, doctor — capture logs under stabilize evidence.
6. On a real **Linux x64** host or container: same gates; record which tools resolved system vs portable.
7. Optional ARM64 smoke: document fail/partial without claiming full.

### Phase C — Docker / home server / VPS packaging (if program expands beyond docs)

8. Add root multi-stage `Dockerfile` (Debian-based Node 20/24) + `docker-compose.yml` with named volumes for `data/` and optional `.runtime/`.
9. Sample **Caddy or nginx** reverse-proxy + TLS snippet for home server/VPS.
10. Sample **systemd** unit (`Restart=on-failure`, `WorkingDirectory=`, `EnvironmentFile=.env`, hard `HOST`/`PORT`).
11. Refuse or loudly warn if `HOST` is public and `NODE_ENV=production` without proxy headers story (design decision — future fix checkpoint).

### Phase D — Platform gaps in tooling

12. ARM64: either ship portable FFmpeg arm64 URL or make `tools:install` fail with a single clear “install distro ffmpeg/libreoffice” action (already partial).
13. Preflight: detect glibc version before Calibre download on Linux.
14. Path hardening: case-normalize roots on Windows for `safeJoin` / `assertUnderRoot`.

### Phase E — CI matrix (owned jointly with audit 08)

15. Introduce `.github/workflows` with at least: `ubuntu-latest` + `windows-latest`, Node 20, `npm ci`, typecheck, unit tests (tools install optional/cache).
16. Do **not** gate on full LibreOffice download in CI unless cached artifacts exist (time/size).

---

## 14. Dependencies

| Dependency | Why it matters for platforms |
|------------|------------------------------|
| Node ≥ 20 matching prebuilds | `better-sqlite3`, `sharp`, worker `tsx` in dev |
| npm workspaces / single lockfile | Cross-OS install consistency |
| Network to GitHub / 7-zip.org / Document Foundation / calibre-ebook / libreitalia AppImage CDN | Portable tool bootstrap |
| Linux shared libs (XCB, EGL, GLIBC floor) | LO/Calibre portable |
| `msiexec` on Windows | LO/Calibre portable extract |
| `tar`/`xz` on Linux | FFmpeg/7z archives |
| Disk ≥ ~3 GiB free | Full Phase 1 runtime |
| Optional: Python ≥ 3.10 | Only for opt-in Python profiles |
| Optional: Poppler/GS/Tesseract/qpdf | Advanced PDF features |

---

## 15. Risks

1. **Over-claiming “cross-platform production”** while Docker/CI/VPS packaging are empty.
2. **ARM and musl** users silently missing converters while UI/capability matrix still partially advertises routes until probes fail.
3. **Public bind + token-in-JS** misunderstood as adequate Internet auth.
4. **Doc drift** (BUILD_AND_RUN vs package.json) causes “tools missing” support noise.
5. **Copying `node_modules` between machines/OS** breaks native addons.
6. **WSL + Windows dual checkout** risk if someone points config at the wrong `.runtime/tools/win32-*` tree (docs warn; easy to ignore).
7. **Large tool downloads** fail mid-way on flaky home/VPS networks; repair path exists but is manual.

---

## 16. Unknowns / not executed here

| Item | Status |
|------|--------|
| Fresh Windows bootstrap + full tools install 2026-07-24 | **Not executed** |
| Fresh Linux x64 (bare metal or container) full tools install | **Not executed** |
| Linux arm64 behavior | **Not executed**; inferred from installer URLs/branches |
| Alpine/musl container | **Not executed** |
| Docker image build/run | **Impossible from first-party assets** (no Dockerfile); not improvised |
| Home server multi-day soak / reboot recovery | **Not executed** |
| VPS under real reverse proxy | **Not executed** |
| Performance of LO/FFmpeg under low-RAM env knobs | Documented only |
| Exact glibc on popular VPS images vs Calibre requirement | **Not measured** |
| Whether `allowScripts` / package manager script policies block native builds in restricted enterprise images | **Unknown** |

---

## 17. Explicit non-claims

- This audit **does not** declare AlphaStudio stable on any OS.
- This audit **does not** fabricate multi-OS test pass/fail numbers.
- macOS is **out of scope** even where installer URLs exist.
- Security deep-dive (auth crypto, upload bombs, SSRF, etc.) belongs to **audit 07**; only bind/rate-limit/TLS **surface** for deploy platforms is covered here.
- CI design details belong to **audit 08**; only absence impact is recorded.

---

## 18. Evidence index (paths inspected)

| Path | Used for |
|------|----------|
| `README.md` | Install entrypoints, engines, tool prep honesty |
| `docs/BUILD_AND_RUN_WINDOWS_LINUX.md` | Win/Linux/LAN/Docker narrative, verification claim |
| `docs/PDF_TOOLS_SETUP.md` | Optional OS packages |
| `docs/python-runtime.md` | venv layout, POSIX memory cap |
| `docs/job-engine.md` | Windows kill / supervisor notes |
| `docs/stabilize/TOPOLOGY.md`, `STATE.md` | Docker/CI absence inventory |
| `package.json`, `server/package.json` | engines, scripts, native allowlist, deps |
| `scripts/maint/lib/platform.mjs` | OS detection, tools roots, npm runner |
| `scripts/maint/lib/paths.mjs` | Safe paths cross-OS |
| `scripts/maint/lib/tools-probe.mjs` | Tool defs / profiles |
| `scripts/maint/tools.mjs` | install orchestration |
| `scripts/setup-tools.mjs` | Download matrix, ARM gaps, MSI/AppImage |
| `server/src/config.ts` | host/data/worker defaults |
| `server/src/lib/bind-guard.ts` | non-loopback policy |
| `server/src/app.ts` | token, no rate limit |
| `server/src/lib/paths.ts` | traversal guards |
| `server/src/lib/child-registry.ts` | process tree kill |
| `server/src/workers/jobs.ts` | fork workers, detached policy |
| `server/src/convert/engines/python.ts` | venv paths |
| `server/src/index.ts` | listen + signals |
| `.env.example` | LAN/auth/worker knobs |
| Directory probe | `.github/` missing; no product Dockerfile/compose |

---

## 19. Recommended next exact action

1. Keep this file as the platforms baseline for master-plan reconcile.  
2. Pair with **08-ci-release** and **07-security** before any “stable on Windows/Linux” language.  
3. Prefer a **docs-only fix checkpoint** for PLAT-DOC1 + support matrix before investing in Dockerfile work, unless Docker is declared in-scope for stabilize packaging.

---

*End of audit 06 — platforms.*
