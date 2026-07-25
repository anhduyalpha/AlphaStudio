# Audit: Backend, workers, persistence, job lifecycle

**Date:** 2026-07-24  
**Auditor:** independent code/test review (no product code modified)  
**Tree root:** `C:\Users\Duy\Code\Project\AlphaStudio`  
**Scope package:** `server/` (API, SQLite, process workers, uploads, job lifecycle)  
**Version observed:** `config.version = 3.6.0` (`server/src/config.ts`)

## Scope

In scope (backend only):

- Job create / run / fail / cancel / delete lifecycle
- SQLite schema, migrations, recovery on restart
- Dedicated process worker pool, IPC, leases, heartbeats, timeouts
- Upload + resumable session paths and finalize recovery
- Output / temp / orphan GC and path ownership
- Error handling, capability gates, concurrency limits
- Tests under `server/tests/*` that prove or miss job lifecycle behavior

Out of scope (other audits):

- Frontend UX / a11y, Playwright browser UX
- Converter engine algorithm quality, PDF operation correctness deep-dive (except lifecycle gates)
- CI/release packaging, platform installers
- Security hardening beyond job/upload path (full security audit is `07-security.md`)

Secondary context only (not treated as proof): `docs/job-engine.md`, `docs/resumable-upload.md`.

## Method

1. Read entrypoints: `server/src/index.ts`, `server/src/app.ts`, `server/src/config.ts`.
2. Read persistence: `server/src/db/index.ts`, `server/src/db/migrations.ts` (schema versions 1–7).
3. Read job engine: `server/src/workers/jobs.ts`, `worker-process.ts`, `ipc.ts`.
4. Read routes/services: `routes/jobs.ts`, `routes/uploads.ts`, `routes/upload-sessions.ts`, `routes/system.ts`, `services/job-deletion.ts`, `services/upload-session.ts`, `services/workspace.ts` (insert/upload bridge, output registration).
5. Read gates/helpers: `capabilities.ts`, `processors/index.ts`, `lib/child-registry.ts`, `lib/paths.ts`, `lib/bind-guard.ts`, `security/validation.ts`.
6. Read lifecycle tests: `worker-process-pool.test.ts`, `workers.test.ts`, `job-delete-history.test.ts`, `pdf-jobs-reliability.test.ts`, `hardening.test.ts`, `resumable-upload.test.ts`, `rate-limit-absent.test.ts`, `pdf-password-redaction.test.ts`, `pdf-api-jobs.test.ts`.
7. Did **not** re-run the full suite in this audit pass; claims about “test coverage exists” are from reading test source, not fresh execution logs.

Severity scale:

| Sev | Meaning |
|-----|---------|
| **P0** | Data loss, stuck unrecoverable jobs, or remote exploit on default loopback config |
| **P1** | High: incorrect terminal state, unsafe path IO under normal API use, silent retry/lease bugs, lifecycle broken for common ops |
| **P2** | Medium: real user pain, capability/retry model gaps, GC/cache inconsistency, multi-instance footguns |
| **P3** | Low: defense-in-depth, maintainability, incomplete tests, docs drift |
| **P4** | Info / intentional design tradeoff to document |

## Evidence citations

### Boot and shutdown

| Concern | Location |
|---------|----------|
| Bind guard → dirs → SQLite → listen → resume file detect → start workers → resume queued | `server/src/index.ts` `main()` |
| Graceful SIGINT/SIGTERM/IPC shutdown; `stopWorkerPool` then `closeDb` | `index.ts` `shutdown` |
| App `onClose` also stops pool + file finalizers | `server/src/app.ts` `buildApp` hooks |
| WAL checkpoint on close | `server/src/db/index.ts` `closeDb` |

### Schema / recovery

| Concern | Location |
|---------|----------|
| Legacy `jobs`/`uploads`/`activity` CREATE | `db/index.ts` `LEGACY_SCHEMA` |
| Migrations v1–v7 (workspaces, caches, leases, upload sessions, result_json) | `db/migrations.ts` `runMigrations` |
| Idempotent heal of cache/session tables | `migrations.ts` `ensureRequiredTables` |
| Running → failed `SERVER_RESTART` + `retryable` when attempts remain | `db/index.ts` `initDb` interrupted UPDATE |
| Finalizing uploads → uploading after restart | `initDb` + migration v6 |
| Queued lease fields cleared; `resumeQueuedJobs(pumpQueue)` | `initDb`, `resumeQueuedJobs`, `index.ts` |

### Job lifecycle API

| Concern | Location |
|---------|----------|
| `POST/GET /api/jobs`, cancel, delete, download, SSE, WS | `routes/jobs.ts` |
| Create, classify category, dedupe, vault password, claim, pump, settle | `workers/jobs.ts` |
| Terminal delete with ownership checks | `services/job-deletion.ts` `deleteTerminalJob` |
| Public DTO (no secrets/paths) | `jobs.ts` `jobPublic`, `sanitizeResultMeta` |

### Worker pool

| Concern | Location |
|---------|----------|
| Adaptive pool + category ceilings | `config.ts` `computeDefaultMaxConcurrentJobs`, `workerCategoryLimits` |
| Atomic claim + lease + attempt_count++ | `jobs.ts` `claimNextQueuedJobRow` (SQL `UPDATE…RETURNING`) |
| fork worker, IPC protocol v1 | `jobs.ts` `spawnWorker`; `ipc.ts`; `worker-process.ts` |
| Progress batching (5% / 500ms) | `createProgressBatcher`, `shouldWriteProgress` |
| Cancel/timeout → cancel IPC + external PID kill + grace kill | `requestWorkerStop`, `child-registry.ts` |
| Success: path confine + validate + lease-matched complete | `settleWorkerSuccess`, `completeJobSuccess`, `validateJobOutput` |
| Crash → `WORKER_CRASH`, restart slot | `handleWorkerExit` |
| Idle-only stale kill (`workerStaleMs`) | `startWorkerPool` watchdog |
| Diagnostics | `getWorkerDiagnostics`; `GET /api/diagnostics` |

### Uploads / outputs

| Concern | Location |
|---------|----------|
| Streaming multipart upload + size cap | `routes/uploads.ts` |
| Dual-write `files` + legacy `uploads` | `workspace.ts` `insertFile` |
| Resumable chunks, finalize lock, restart heal | `services/upload-session.ts` |
| Job inputs resolve via `uploads` table | `createJob` |
| Outputs under `outputs/<jobId>/` | `prepareWorkerPayload`, worker `ensureOutputInside` |
| Temp/orphan GC | `cleanupExpiredFiles`, `orphanFileGc` |

### Capability gates

| Concern | Location |
|---------|----------|
| Bundled caps always available without probe | `capabilities.ts` `BUNDLED_CAPABILITIES`, `isToolAvailable` |
| Job create gate | `processors/index.ts` `assertJobCapable` → `capabilityIdFor` |
| Converter always maps to `converter.batch` (always true) | `capabilityIdFor` + `BUNDLED_CAPABILITIES` |
| Probe deferred after listen | `index.ts` `setImmediate(detectCapabilities)` |

### Tests that prove lifecycle behavior

| Behavior | Test file |
|----------|-----------|
| Atomic claim uniqueness; restart marks running failed/retryable | `server/tests/worker-process-pool.test.ts` |
| Real worker crash → `WORKER_CRASH` + retryable; cancel no complete; timeout | same |
| Progress batching, cache keys, output validation | `server/tests/workers.test.ts` |
| Converter active dedupe; clientRequestId | `server/tests/pdf-jobs-reliability.test.ts` |
| Terminal delete + output ownership | `server/tests/job-delete-history.test.ts` |
| Claim distinctness; CORS SSE; bind guard | `server/tests/hardening.test.ts` |
| Resumable upload restart + missing chunks | `server/tests/resumable-upload.test.ts` |
| No `@fastify/rate-limit` | `server/tests/rate-limit-absent.test.ts` |
| Password not persisted in options | `server/tests/pdf-password-redaction.test.ts` |
| PDF create/cancel/SSE smoke | `server/tests/pdf-api-jobs.test.ts` |

### Commands (for future validation of this scope)

```text
npm run typecheck
npm test -w alphastudio-server -- --test-concurrency=1 server/tests/worker-process-pool.test.ts
npm test -w alphastudio-server -- --test-concurrency=1 server/tests/workers.test.ts
npm test -w alphastudio-server -- --test-concurrency=1 server/tests/job-delete-history.test.ts
npm test -w alphastudio-server -- --test-concurrency=1 server/tests/pdf-jobs-reliability.test.ts
npm test -w alphastudio-server -- --test-concurrency=1 server/tests/resumable-upload.test.ts
npm test -w alphastudio-server -- --test-concurrency=1 server/tests/hardening.test.ts
npm run benchmark:workers
npm run db:repair
npm run doctor
```

## Findings (severity P0–P4, location, evidence, impact)

### P0

**No P0 findings confirmed from source for default `HOST=127.0.0.1` single-process personal use.**

Core invariants observed in code:

- Processors do not run in the Fastify process; only forked workers run them.
- Claims are lease-scoped; completion requires matching `worker_lease`.
- Restart does not silently re-run `running` jobs.
- Cancel/timeout paths clear partial outputs before terminal failure/cancel.
- Password redaction + in-memory vault (never SQLite options).

Absence of P0 is **not** a stability declaration for the whole product.

---

### P1

#### F-B01 — `retryable` / `max_attempts` do not requeue the same job row

| Field | Detail |
|-------|--------|
| **Severity** | P1 (lifecycle contract incomplete vs schema/docs surface) |
| **Location** | `workers/jobs.ts` `settleWorkerFailure`, `retryAllowed`, `finish`; `db/index.ts` restart recovery; no `POST /api/jobs/:id/retry` in `routes/jobs.ts` |
| **Evidence** | Failures set `retryable=1` and leave `status='failed'`. Scheduler only claims `status='queued'`. Nothing sets failed → queued. Client retry (`src/views/ConverterView.jsx` `retryFailed`) creates **new** jobs via `POST /api/jobs`. `attempt_count` only increments on claim of the **same** row, so `MAX_JOB_ATTEMPTS` rarely compounds for real retries. Tests assert the flag (`worker-process-pool.test.ts`) but never assert automatic requeue. |
| **Impact** | Operators/docs may believe automatic in-process retry exists (`docs/job-engine.md` describes attempt limits and retryable flags). Same-job resume after crash is not implemented. Attempt accounting is misleading. |

#### F-B02 — Password vault is process-memory only; restart drops secrets for “retryable” jobs

| Field | Detail |
|-------|--------|
| **Severity** | P1 for password-bearing PDF/ops that fail with `SERVER_RESTART` / crash mid-run |
| **Location** | `workers/jobs.ts` `jobPasswordVault`, `createJob`, `prepareWorkerPayload`; cleared in `clearJobPassword` / `finish` / `completeJobSuccess` |
| **Evidence** | Password extracted and vaulted; redacted from SQLite (`redactSensitiveOptions`). After restart, vault is empty; job may be `failed` + `retryable` but re-creating or hypothetical same-id retry cannot re-inject password without client resubmit. Covered for redaction (`pdf-password-redaction.test.ts`), **not** for post-restart password re-supply. |
| **Impact** | Encrypted/password PDF work interrupted by restart requires full user re-entry; “retryable” flag alone is insufficient. |

#### F-B03 — Capability gate for converter is always-true; heavy engines fail only after queue claim

| Field | Detail |
|-------|--------|
| **Severity** | P1 (false availability at create for common converter/office/media paths) |
| **Location** | `capabilities.ts` `BUNDLED_CAPABILITIES` includes `converter.batch`; `processors/index.ts` `capabilityIdFor('converter') → 'converter.batch'`; actual LibreOffice/FFmpeg checks inside engines at process time |
| **Evidence** | `assertJobCapable` passes for converter even if `converter.office` / ffmpeg binaries missing. Jobs occupy pool slots then fail in worker. Separate caps (`converter.office`, `media.*`) exist but are not enforced at create for `type=converter`. |
| **Impact** | Users queue doomed conversions; wasted worker capacity; poorer UX than early 503 `UNAVAILABLE`. |

---

### P2

#### F-B04 — No path confinement on download streaming routes (defense relies on trusted writers)

| Field | Detail |
|-------|--------|
| **Severity** | P2 (integrity; escalates if DB is attacker-writable or multi-tenant later) |
| **Location** | `routes/jobs.ts` `GET /api/jobs/:id/download`; `routes/workspaces.ts` `GET /api/files/:id/download`, `preview`, `outputs/:id/download` |
| **Evidence** | Streams `job.output_path` / `row.path` with existence check only. Contrast: `job-deletion.ts` `assertOwnedPath` / `assertNoReparseEscape` is strict. Complete path is confined at settle time (`isPathInside(outputDir, …)`), but **read path does not re-validate**. |
| **Impact** | Corrupted/hand-edited SQLite could serve arbitrary readable paths. Low for default local single-user; important for harden pass. |

#### F-B05 — Dual `files` + `uploads` bridge increases drift risk

| Field | Detail |
|-------|--------|
| **Severity** | P2 |
| **Location** | `workspace.ts` `insertFile` dual INSERT; finalize updates both; `createJob` only SELECTs `uploads` |
| **Evidence** | Intentional bridge comments. Jobs ignore `files.status` (`processing`/`deleted`/`failed`). Soft-deleted files remain job-eligible if disk path exists. |
| **Impact** | Jobs can run on non-ready or soft-deleted inputs; partial dual-update bugs could desync bridge tables. |

#### F-B06 — `orphanFileGc` / workspace purge does not systematically purge `job_result_cache`

| Field | Detail |
|-------|--------|
| **Severity** | P2 |
| **Location** | `jobs.ts` `orphanFileGc`; cache helpers in `db/index.ts`; cache cleanup only in `deleteTerminalJob` by `output_path` |
| **Evidence** | GC deletes jobs/outputs/files for expired soft-deleted workspaces but no `DELETE FROM job_result_cache` by path/key. Runtime self-heals missing files on next hit (`prepareWorkerPayload` deletes bad cache rows). |
| **Impact** | Stale cache rows; brief wrong cache-hit attempts; disk rows until next use. |

#### F-B07 — Single SQLite connection model is process-global; multi-instance on one DB is unsupported

| Field | Detail |
|-------|--------|
| **Severity** | P2 (ops footgun) |
| **Location** | `db/index.ts` “never create additional Database instances”; claim SQL assumes one API owner of leases |
| **Evidence** | Atomic claim is safe for concurrent claims **inside one process**. Two Node servers on one `DB_PATH` share no in-memory `workerSlots`/`cancelFlags`/`jobPasswordVault`. |
| **Impact** | Double-run risk, lease confusion, corrupt supervision if operators scale out naively. |

#### F-B08 — Create allows jobs while file finalize still `processing` (no checksum)

| Field | Detail |
|-------|--------|
| **Severity** | P2 (mostly intentional speed vs correctness tradeoff) |
| **Location** | `acceptUploadedFile` status `processing`; `createJob` only checks upload row + `existsSync`; `loadInputChecksumsFast` returns null → skips result cache |
| **Evidence** | Documented fast path. Cache miss only when checksum absent. Worker still reads disk bytes. |
| **Impact** | Cache misses; rare race if file deleted during processing; no hard gate that inputs are `ready`. |

#### F-B09 — Application-level rate limiting intentionally absent

| Field | Detail |
|-------|--------|
| **Severity** | P2 when `HOST` is non-loopback (even with token); P4 on loopback |
| **Location** | `app.ts` comment; `rate-limit-absent.test.ts` enforces absence |
| **Evidence** | Mitigations: multipart size, job pool, timeouts, bind-guard + optional bearer. No per-IP request throttle. |
| **Impact** | LAN-exposed API can be flooded with job creates/uploads by anyone holding the token (or open bind with `ALLOW_INSECURE_BIND`). |

---

### P3

#### F-B10 — Download/list APIs lack automated path-escape regression tests

| Field | Detail |
|-------|--------|
| **Evidence** | Strong tests for delete ownership and output magic validation; no test forging `jobs.output_path` outside `outputsDir` then GETting download. |
| **Impact** | Regression risk for F-B04. |

#### F-B11 — No automated test that `retryable` jobs are requeued server-side (because they are not)

| Field | Detail |
|-------|--------|
| **Impact** | Docs/schema imply richer retry than API provides; gap easy to miss in future “stabilize” work. |

#### F-B12 — Progress batching can delay terminal UI progress by up to 500ms / 5%

| Field | Detail |
|-------|--------|
| **Location** | `PROGRESS_MIN_DELTA`, `PROGRESS_MIN_INTERVAL_MS` |
| **Impact** | UX only; flush on settle. Covered by unit tests. |

#### F-B13 — Watchdog does not kill stale **active** workers by heartbeat age

| Field | Detail |
|-------|--------|
| **Location** | `startWorkerPool` watchdog comment: active workers owned by job timeout |
| **Impact** | Hung worker that still heartbeats wastes a slot until `JOB_TIMEOUT_MS` (default 5m). By design. |

#### F-B14 — Schema dual-path: `LEGACY_SCHEMA` + incremental migrations + `ensureRequiredTables`

| Field | Detail |
|-------|--------|
| **Impact** | Heal path is good for partial DBs; harder mental model; `db:repair` exists. |

#### F-B15 — `createJob` needsFile condition is redundant / hard to audit

| Field | Detail |
|-------|--------|
| **Location** | `createJob` text/qr/security exceptions duplicated |
| **Impact** | Maintainability only. |

#### F-B16 — Job SSE/WS have no auth beyond process-local CORS when token unset

| Field | Detail |
|-------|--------|
| **Location** | `routes/jobs.ts` events/ws; token only if `config.apiToken` |
| **Impact** | Acceptable for loopback; document for LAN. |

---

### P4 (intentional / documented tradeoffs)

| ID | Note |
|----|------|
| F-B17 | No request rate limit for personal single-user app (explicit). |
| F-B18 | Adaptive pool re-evaluates free RAM when env override unset (`effectiveWorkerPoolSize`). |
| F-B19 | Capability warm-up after listen so health/upload stay responsive. |
| F-B20 | Passwords never persisted (security over seamless restart). |
| F-B21 | `forceCloseConnections: 'idle'` to allow WAL checkpoint under supervisor restarts. |

---

### Positive controls (not findings)

These are **strengths** verified in source (do not treat as product-wide stability):

1. **Process isolation** — Fastify never imports processors for run; workers validate payload paths under uploads/temp/outputs.
2. **Lease-matched completion** — stale result cannot complete after cancel/timeout when settle races.
3. **Output validation** — magic bytes, ZIP structure/CRC, deep PDF/image reparse before `completed`.
4. **Delete ownership** — symlink/reparse and directory confinement before rm.
5. **Restart honesty** — running → failed `SERVER_RESTART`, not silent replay.
6. **Resumable upload** — chunk checksums, finalize lock, crash heal, expired GC.
7. **Category scheduling** — office=1 default prevents LO pile-up.
8. **Cross-platform child kill** — `taskkill /T /F` vs process groups, no shell interpolation of user data.

## Proposed implementation plan

Ordered for this scope only. Each step should add/adjust tests before claiming done.

### Phase B1 — Close lifecycle contract gaps (P1)

1. **Define and implement explicit retry semantics** (pick one; document in `docs/job-engine.md`):
   - **Option A (recommended):** `POST /api/jobs/:id/retry`  
     - Only if `status=failed` and `retryable=1` and `attempt_count < max_attempts`.  
     - Reset to `queued`, clear error/lease, keep same id/inputs; require client to re-send password if vault empty (return `PASSWORD_REQUIRED`).  
   - **Option B:** Keep client new-job retry only; then **stop advertising** same-row attempt semantics: set `retryable` as “UI may recreate”, or drop `max_attempts` from public DTO until real, or auto-requeue failed retryable rows in `pumpQueue` with backoff.
2. **Wire password re-supply** on retry: accept optional `password` on retry/create; vault only.
3. Tests: server-side retry increments `attempt_count`; refuses permanent codes; password-required path; no auto-complete after cancel.

### Phase B2 — Capability honesty at create (P1)

1. Extend `assertJobCapable` / `capabilityIdFor` for `converter` using `routeConversion` + engine availability (LibreOffice/FFmpeg/Pandoc/Calibre) when inputs/format known.
2. For `type=media|audio|archive` keep existing caps; ensure 7z/ffmpeg fail at create not mid-worker when option forces them.
3. Tests: missing LO → 503 on office pair; does not claim pool slot.

### Phase B3 — Download path confinement (P2)

1. Shared helper `assertReadableUnderRoot(root, path)` (realpath, reject symlink escape).
2. Apply on job download, file download/preview, output download, zip assembly.
3. Tests with forged DB paths outside roots → 404/400, no stream.

### Phase B4 — GC / dual-table hardening (P2)

1. When deleting outputs/jobs in `orphanFileGc` / workspace hard delete, also `DELETE FROM job_result_cache WHERE output_path = ?` (or by key if stored).
2. `createJob`: reject `files.status IN ('deleted','failed','missing')`; optional warn if still `processing`.
3. Prefer single source of truth long-term: resolve inputs from `files` with uploads fallback.

### Phase B5 — Ops / multi-instance (P2)

1. Document single-writer requirement in doctor/start logs if second process detects foreign `worker_id` heartbeats.
2. Optional: SQLite busy + advisory “instance id” row.

### Phase B6 — Test debt (P3)

1. Integration: restart with vaulted password job → failed retryable → retry with password succeeds.
2. Integration: cancel during claim/dispatch race (force delay between claim and `slot.active`).
3. Download path escape test (Phase B3).
4. Fresh execution of focused suite; attach logs under stabilize handoff (this audit did not re-run).

## Dependencies

| Dependency | Why |
|------------|-----|
| SQLite via `better-sqlite3` | Single connection, WAL, RETURNING claims |
| Node child_process `fork` + IPC | Worker isolation |
| Optional binaries (ffmpeg, LO, …) | Media/office/pdf advanced paths |
| Frontend retry UX | Today compensates for missing server retry |
| Workspace file finalizer (`scheduleFileFinalize`) | Checksums for cache keys |
| Stabilization process (`docs/stabilize/HANDOFF_FORMAT.md`) | Gates for any fix commits |

## Risks

1. **Implementing auto-requeue without password handling** re-fails encrypted PDF jobs in a loop.
2. **Stricter capability gates** may break clients that queue first and install tools later (need clear 503 + refresh capabilities).
3. **Path confinement with `realpath`** on Windows reparse points may reject legitimate junctions if misconfigured DATA_DIR.
4. **Tightening createJob on `processing` files** may race fast UI “convert immediately after upload”.
5. **Dual-table cleanup** if incomplete leaves orphans and broken FK-ish links (`job_files` uses soft FK patterns).
6. **Category limits** misconfiguration (`OFFICE_WORKER_CONCURRENCY` high) can still DOS local machine with LO.

## Unknowns

1. Fresh pass/fail of full `npm test -w alphastudio-server` on this tree (not executed in this audit).
2. Production operator habits: multi-instance, custom `DATA_DIR` on network shares, antivirus locking chunk rename on Windows.
3. Whether any external supervisor already restarts the API faster than `stopWorkerPool` grace (hard kill mid-settle).
4. Long-term plan for collapsing `uploads` vs `files` (no ADR found in scope).
5. Whether product wants same-id retry vs new-id only (product decision blocks Phase B1 Option A vs B).
6. Interaction of job result cache with intentional output deletion without cache invalidation beyond path match.

## Explicit non-claims

- This audit does **not** declare AlphaStudio stable or production-ready.
- This audit does **not** certify PDF/converter numerical correctness, OCR quality, or frontend resume UX.
- This audit does **not** re-validate prior `RUNTIME_VALIDATION.md` / PDF final reports without re-running those commands.
- Absence of P0 is limited to **code/test reading** for backend job lifecycle on default loopback assumptions.
- Docs under `docs/job-engine.md` / `docs/resumable-upload.md` were secondary context; only code/tests count as evidence.
- No product code was modified; only this file was written: `docs/stabilize/audits/02-backend-workers.md`.
