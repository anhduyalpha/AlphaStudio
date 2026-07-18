# AlphaStudio

Local-first multi-workspace utility suite: **React 18 + Vite** frontend and a **Node.js 20+ TypeScript / Fastify** backend with SQLite, secure uploads, background jobs, and capability detection.

Current release: **3.6.0**.

## Requirements

- **Node.js 20+** (Windows, macOS, or Linux)
- A standard build/run prepares the complete Converter Phase 1 runtime. Tools
  are resolved from the system first, then downloaded into
  `.runtime/tools/<platform>-<arch>/` when missing:

```powershell
npm run tools:check      # full: 7-Zip, FFmpeg/ffprobe, LibreOffice, Pandoc, Calibre
npm run tools:install    # download/install every missing Phase 1 tool
npm run tools:repair     # checksum/path fix + re-scan
npm run tools:update     # refresh project-managed tools
npm run doctor           # full environment diagnostics
```

Without a tool, related formats report **Unavailable** with one actionable
install message (never fake success). For the complete Windows/Linux build,
full-runtime, low-memory, cleanup, LAN, and troubleshooting guide, see
[`docs/BUILD_AND_RUN_WINDOWS_LINUX.md`](docs/BUILD_AND_RUN_WINDOWS_LINUX.md).

## Setup (Windows and Linux)

```powershell
# Windows PowerShell, from the project root
npm run bootstrap
copy .env.example .env
npm run build
npm start
```

```bash
# Linux x64, from the project root (install prerequisites from the full guide)
npm run bootstrap
cp .env.example .env
npm run build
npm start
```

`npm run bootstrap` installs every root/workspace Node dependency from the
lockfile and every Phase 1 external converter tool. `dev`, `build`, and `start`
also run the full tool preparation step and reuse healthy installations.

## Scripts

| Script | Description |
|--------|-------------|
| `npm run bootstrap` | `npm ci` for all workspaces + complete Phase 1 tool installation |
| `npm run runtime:prepare` | Resolve/download every missing Phase 1 external tool |
| `npm run dev` | Client + server together (`concurrently`) |
| `npm run dev:client` | Vite on http://localhost:5173 |
| `npm run dev:server` | Fastify API on http://127.0.0.1:8787 |
| `npm run build` | Build client and server |
| `npm run start` | Serve the production UI and API together at http://127.0.0.1:8787 |
| `npm run test` | Server integration/security tests |
| `npm run test:maint` | Maintenance helper unit tests |
| `npm run test:audit` | Audit harness regression tests |
| `npm run benchmark:workers` | Production benchmark: idle vs health latency during real worker jobs |
| `npm run benchmark:upload` | Real small/large upload response and quick/deep detect benchmark |
| `npm run clear` | Preview + remove disposable artifacts (`--dry-run`, `--all`, `--keep-workspaces`, `--keep-tools`) |
| `npm run clean` | Build/cache/logs/coverage/temp only |
| `npm run reset` | clean + reinstall all workspace deps/tools + init DB |
| `npm run tools:check` / `install` / `repair` / `update` | Full Phase 1 tool lifecycle + `.runtime/manifest.json` |
| `npm run deps:check` / `deps:prune` | Dependency audit / prune+dedupe |
| `npm run doctor` | Env, deps, DB, storage, ports, tools |

## API surface

- `GET /api/health` — liveness
- `GET /api/version` — package/version
- `GET /api/capabilities` — tools + binary detection
- `GET /api/diagnostics` — process-worker health, category limits, active jobs, and queue depth
- `POST /api/uploads` — multipart upload (magic/MIME/ext validation)
- `POST /api/upload-sessions/init` — create a durable resumable upload
- `PUT /api/upload-sessions/:id/chunks/:index` — idempotent ranged chunk with SHA-256
- `GET /api/upload-sessions/:id` — persisted ranges/bytes/status for resume
- `POST /api/upload-sessions/:id/pause|resume|finalize` — lifecycle controls
- `DELETE /api/upload-sessions/:id` — cancel and safely remove staged chunks
- `POST /api/jobs` — create job `{ type, uploadIds?, options }`
- `GET /api/jobs/:id` — status
- `GET /api/jobs/:id/events` — SSE progress
- `GET /api/jobs/:id/ws` — WebSocket progress
- `POST /api/jobs/:id/cancel` — cancel
- `GET /api/jobs/:id/download` — secure artifact download
- `GET/DELETE /api/activity`, `GET /api/stats`
- `GET/PUT /api/profile`, `GET/PUT /api/settings`

Data lives under `./data` (uploads, outputs, temp, SQLite). Temp cleanup runs on a timer.

## Resumable large uploads

Version 3.6 keeps `POST /api/uploads` for small files and compatibility, while
files of 8 MiB or more use durable sessions in the Converter UI. Each bounded
chunk is streamed to disk, validated against its exact `Content-Range`, byte
count, index, and SHA-256, then committed idempotently to SQLite. Pause, resume,
retry, cancel, real transferred bytes, speed, and ETA remain accurate without
buffering the complete file in RAM. Up to three dropped files upload at once.

After a browser reload, reselect the same local file to reconnect to the saved
session (browsers do not persist raw file handles). Server restarts retain all
committed chunks. Finalize immediately creates an `Inspecting` file with bounded
header detection; full SHA-256 and deep detection continue in the background and
publish `Ready`/`Failed` over workspace SSE. Exact duplicates are identified only
after size and full checksum match; head/tail fingerprints are hints, never file
identity. See [`docs/resumable-upload.md`](docs/resumable-upload.md).

## Process worker job engine

Version 3.5 runs conversion processors in dedicated child processes. Fastify
owns API state, atomic SQLite claims, SSE/WebSocket events, and output
registration; process workers own Sharp, PDF, FFmpeg, archive, and
LibreOffice work. A worker crash cannot terminate the API process.

The pool derives a conservative size from CPU and available RAM. Override it
with `WORKER_POOL_SIZE`, then optionally cap categories with
`IMAGE_WORKER_CONCURRENCY`, `PDF_WORKER_CONCURRENCY`,
`MEDIA_WORKER_CONCURRENCY`, `OFFICE_WORKER_CONCURRENCY`, and
`GENERAL_WORKER_CONCURRENCY`. `MAX_CONCURRENT_JOBS` remains a legacy alias.
Cancellation and timeout requests terminate reported FFmpeg/LibreOffice
process trees without a shell on Windows and Linux. See
[`docs/job-engine.md`](docs/job-engine.md) for the IPC, lease, recovery, and
operations contract.

## Security

- Extension + MIME + magic-byte checks
- Random server-side filenames
- Path traversal / zip-slip rejection
- CORS restricted to local frontend origins
- Upload/output size, job-timeout, and concurrency limits
- Chunk range/index/size/SHA-256 validation, expiry cleanup, and UUID-confined staging paths
- No unrestricted filesystem access; no shell from user input
- Sensitive log fields redacted
- Corrupt/oversized/unsupported files rejected safely
- Non-loopback binds are refused unless `API_AUTH_TOKEN` is configured (or explicitly overridden)

**Not implemented (by design):** password cracking, malware execution, arbitrary command execution.

## Production hosting

```bash
npm run bootstrap
npm run build
npm start
```

The compiled Fastify server serves both `dist/` and `/api` from one origin, so
conversion, QR previews, SSE progress, and downloads work without a separate
frontend server. Keep `HOST=127.0.0.1` for a personal machine. For LAN/container
hosting set `HOST=0.0.0.0`, choose a long `API_AUTH_TOKEN`, set the same value as
`VITE_API_TOKEN` before `npm run build`, and configure `CORS_ORIGIN` to the public
frontend origin.

## AlphaStudio design system

Version 3.4 introduces the original **Studio Nodes** identity: responsive brand
lockups, a shared 24 × 24 SVG icon sprite, semantic job-status icons, adaptive
tool illustrations, six contextual empty states, app icons, and subtle SVG
surface patterns. All runtime paths are centralized in
[`src/assets/registry.js`](src/assets/registry.js); reusable React components
live in `src/components/Icon.jsx`, `Brand.jsx`, `StatusIcon.jsx`, and
`EmptyState.jsx`.

Run `npm run dev`, then open `http://localhost:5173/#/assets` to inspect the
development-only asset gallery. The gallery is excluded from production routing
and the production bundle. See [`docs/assets.md`](docs/assets.md) for the asset
catalog, accessibility contract, and extension guidelines.

## Development notes

- Frontend API base: `VITE_API_URL` (default: same origin)
- Vite proxies `/api` to the backend in dev
- `npm run dev` stops both processes if either side fails and ignores generated/data folders for faster reloads
- Running jobs recover as explicit `failed`/`retryable` records after restart;
  queued jobs resume and completed outputs remain intact
- Upload tuning: `UPLOAD_CHUNK_BYTES` (256 KiB–16 MiB),
  `UPLOAD_SESSION_TTL_MS`, and `UPLOAD_CHUNK_TIMEOUT_MS`
