# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AlphaStudio is a **local-first, single-user** utility suite (converters, PDF tools, media/archive/QR/text tools): a React 18 + Vite SPA (plain `.jsx`, untyped) in `src/`, and a Fastify 5 + better-sqlite3 TypeScript server in the `server/` npm workspace, with a process-based background job engine, external tool runtime (FFmpeg, 7-Zip, LibreOffice, Pandoc, Calibre), and an optional Python bridge.

npm workspaces with a single root lockfile — **never run `npm install` inside `server/`**; install from the root (`npm ci` or `npm run bootstrap`).

## Commands

```bash
npm ci --no-audit --no-fund   # app only (external tools show as unavailable but nothing breaks)
npm run bootstrap             # npm ci + download the multi-GiB external tool runtime
npm run dev                   # Vite :5173 (proxies /api) + Fastify :8787
npm run build                 # vite build → dist/ + tsc → server/dist/
npm start                     # production: one Fastify process serves dist/ + API on :8787
npm run typecheck             # tsc on server/ only — the client is untyped JSX; there is no linter
```

Tests (server harness is `node:test` + tsx, deliberately serial):

```bash
npm test                                                  # all server tests (workspace, --test-concurrency=1)
node --import tsx --test server/tests/api.test.ts         # single server test file (from repo root)
npm run test:pdf                                          # PDF-focused subset
npm run test:e2e                                          # Playwright (regenerates+verifies fixtures/pdf first)
npm run test:e2e -- e2e/pdf-tools.spec.js                 # single e2e spec (args pass through)
npm run test:maint && npm run test:hygiene                # maint-script tests
npm run test:python                                       # python/tests via unittest (needs Python 3.10+)
```

Runtime/tool maintenance: `npm run doctor` (diagnose, never downloads), `npm run tools:check` / `tools:install` / `tools:repair`, `npm run runtime:verify`. CI (`.github/workflows/ci.yml`, ubuntu-only, Node 22) runs typecheck → build → `npm test` → maint/hygiene; it does **not** run e2e or install external tools.

**Destructive-command scope:** `npm run clean` removes builds/caches/logs only. `npm run clear` additionally wipes `data/uploads`, `data/outputs`, `data/temp`, test data dirs, and `dist/` (rebuild after) — the SQLite DB survives unless you pass `--all`, which deletes all of `data/` **and** `.runtime/` (installed tools + Python venv). `npm run reset` = clean + `npm ci` + DB init + tools install (does not touch `data/`). All support `--dry-run`; use it first.

## Architecture

### Two processes, one origin

Dev: Vite on :5173 proxies `/api` → Fastify :8787. Prod: `server/src/app.ts` serves the **repo-root** `dist/` (not `server/dist/`) via @fastify/static with an SPA fallback, same process as the API. Config comes from repo-root `.env` read at import time by `server/src/config.ts`; all runtime state lives under `data/` (`alphastudio.db`, `uploads/`, `outputs/`, `temp/`).

### Job engine (the heart — `server/src/workers/jobs.ts`)

The Fastify API process **never runs a processor** and is the **only** process that opens SQLite (single connection in `server/src/db/index.ts`; workers get everything over IPC — never open a second `Database`). Flow:

- `POST /api/jobs` → `createJob` validates capability (`processors/index.ts` → `capabilities.ts`), gates converter jobs against the live engine matrix (503 if no engine), dedupes via `clientRequestId`, and moves passwords into an in-memory vault — **secrets are never written to SQLite**.
- Forked Node worker processes (`workers/worker-process.ts`, JSON IPC protocol in `workers/ipc.ts`) claim jobs with a single atomic `UPDATE…RETURNING` carrying a UUID `worker_lease`. **Every terminal/progress write is lease-guarded** (`AND worker_lease = ?`) — preserve this pattern.
- Adaptive pool (RAM-budgeted, hard cap 4) with per-category ceilings; **office (LibreOffice) is always concurrency 1**, and `classifyJobCategory` checks input extension first so DOCX→PDF can't bypass it.
- Cancellation/timeout: IPC cancel + kill of externally reported child PIDs (FFmpeg/LibreOffice trees) via `lib/child-registry.ts`, then force-kill after grace. User cancellation beats a racing result; a cancelled job can never become `completed`.
- Outputs are confined to `data/outputs/<jobId>` and validated (magic bytes, ZIP CRC walk, deep reparse via pdf-lib/sharp) before `completed`; results are cached in `job_result_cache` by content hash. Workers reject input paths outside `data/uploads`.
- On restart: queued rows resume, orphaned running rows fail with `SERVER_RESTART` (retryable while attempts remain).

`GET /api/health` must stay SQLite-free (in-memory counters only). Authoritative doc: `docs/job-engine.md`.

### Converter and external tools

`processors/converter.ts`: detect input (`convert/detect.ts`, cached) → `convert/matrix.ts` routes to an engine + fallbacks → per-engine output validation. Engine adapters live in `server/src/convert/engines/` (builtin sharp/pdf-lib, ffmpeg with live demuxer/encoder probing, pandoc, libreoffice, calibre, pdf rasterizer, 7z, python). Standing rules (see `docs/converter/FORMAT_ENGINE_MATRIX.md`):

- Advertised format pairs = **policy allowlist ∩ probed capability** — never an N×M cross-product. Changing `SAFE_PAIRS`/probe policy requires updating that doc in the same PR and bumping `matrixRevision` in `.converter-complete-state.json`.
- PDF input is never routed through LibreOffice; DRM ebooks fail closed; missing tools surface as honest "unavailable" capabilities — never fake success or substitute a copy.
- **No shell, ever**: every external binary goes through `execFileTracked` in `server/src/lib/child-registry.ts` (argv arrays, jobId-registered, tree-killable). Binaries resolve via `server/src/tools/registry.ts` from `.runtime/manifest.json`/`config.json` (system installs win over project-local) — never hardcode tool paths.
- Jobs never download or install tools at runtime; installs happen only via `scripts/maint/tools.mjs`.

### PDF subsystem

`server/src/pdf/operation-contract.ts` is the **authoritative** source of operation ids, cardinality, options, and engine policy — published via `/api/capabilities`; the UI supplies labels/grouping only. Operations are lazy-loaded from `pdf/operations/`. Progress is monotonic, 0–99 until output validation, then 100. Adding an operation touches: the operation module, the loader in `pdf/index.ts`, `processors/index.ts` + `capabilities.ts`, `PdfView.jsx`, tests, and `docs/PDF_TOOLS_ARCHITECTURE.md`.

### Python bridge (opt-in)

Node spawns `python/bridge.py` as a one-shot child per job (same `execFileTracked` path): argv in, single-line JSON result on **stdout**, `ALPHA_PROGRESS:<pct>:<msg>` lines on **stderr**. Printing anything else to stdout from an operation breaks the protocol. `bridge.py` must stay stdlib-only (heavy imports live inside operation modules so `--selfcheck` gating works). Operations self-register via `@register_operation` in `python/operations/` and must also be imported in `_load_builtin_operations` and advertised in `server/src/convert/engines/python.ts`. Venv lives at `.runtime/python/<platform>-<arch>/venv`; profiles (core/data/documents/vision/ocr/ai) and AI models are **never auto-installed** — bootstrap doesn't touch Python; jobs fail with install hints instead of downloading.

### Frontend

No router and no state library: hash routing through the `viewMap` in `src/App.jsx` — adding a view means editing `viewMap` **and** the nav metadata in `src/data/tools.js`. State is React hooks only; the server is the source of truth (the client persists just an opaque workspace id and hydrates via `/api/workspaces/recover`). Conventions:

- `src/api/client.js` is the single API wrapper. Uploads use XHR deliberately (fetch has no upload progress) — don't "modernize". Resumable chunked uploads (`src/api/resumableUpload.js` ↔ `routes/upload-sessions.ts`) kick in at 8 MiB; protocol in `docs/resumable-upload.md`.
- Job progress: SSE with automatic polling fallback; when `VITE_API_TOKEN` is set the client uses a fetch-stream SSE parser (EventSource can't send headers). `src/hooks/useJobRunner.js` maps upload → 0–30%, job → 30–99%, 100 only on completion. Job resume-after-reload is opt-in and only PdfView uses it, guarded by `expectedJobType` — don't enable elsewhere without a type guard.
- Styling is vanilla CSS design tokens in `src/styles.css` + per-domain `src/animations/*.css`, keyed off `html[data-theme]` / `html[data-motion]` (resolved pre-paint by an inline script in `index.html`). No Tailwind/CSS-in-JS.
- Assets: consume `src/assets/registry.js` and the shared `Icon` component — never hard-code `/assets/...` URLs, inline scattered SVG, or use emoji as product icons (`docs/assets.md`; enforced by structural tests).

### Tests — how they're wired

Server HTTP-integration tests set `process.env` (PORT, `DATA_DIR`/`DB_PATH` → `data-test/`) **before** dynamically importing src modules (config reads env at import time), bind hardcoded per-file ports, and hit a real `listen`ing app with fetch — which is why the suite runs with `--test-concurrency=1`; don't parallelize it. Converter engine tests use recorded probe fixtures in `server/tests/fixtures/converter/` so real binaries aren't needed. `ui-*-struct.test.ts` files assert client-source structure from the server suite. E2E specs must import `{ test, expect }` from `e2e/support/browser-audit.js` (not `@playwright/test`) to get console/network-error auditing; they run serially on ports 15173/18787 — a stale dev server on those ports breaks the run. `fixtures/pdf/` is deterministic and sha256-pinned — never hand-edit; change `scripts/test/generate-pdf-fixtures.mjs` and run `npm run fixtures:pdf`.

## Security boundary (intentional — do not "fix")

The accepted threat model (`docs/stabilize/SECURITY_BOUNDARY.md`) is a single-user loopback studio: the unauthenticated loopback API and the **absence of rate limiting** are formal closures locked by tests (`rate-limit-absent.test.ts`) — do not add auth walls or rate limiters unprompted. Conversely, do not weaken the tested guards: download path confinement, FFmpeg option allowlisting, constant-time bearer comparison. Non-loopback `HOST` requires `API_AUTH_TOKEN` (+ matching build-time `VITE_API_TOKEN`).

## Docs authority

Current/authoritative: `docs/job-engine.md`, `docs/resumable-upload.md`, `docs/PDF_TOOLS_ARCHITECTURE.md`, `docs/converter/FORMAT_ENGINE_MATRIX.md`, `docs/BUILD_AND_RUN_WINDOWS_LINUX.md`, `docs/assets.md`, `docs/stabilize/SECURITY_BOUNDARY.md`. Historical audit trails (don't treat their claims as verified): `docs/stabilize/` process records, `docs/ux-ui-redesign/`, `V3_CHANGELOG.md`, `RUNTIME_VALIDATION.md` (note: `npm run test:audit` / `audit:backend` no longer exist).
