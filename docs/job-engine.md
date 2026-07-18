# AlphaStudio job engine

Version 3.5 separates HTTP/API work from conversion work. The Fastify process
never invokes a processor. It owns SQLite, job scheduling, live events, output
validation, and worker supervision. Persistent child processes load Sharp,
pdf-lib, FFmpeg, LibreOffice, archive, QR, and text processors only after a job
has been assigned.

## Lifecycle

1. `POST /api/jobs` validates capabilities and inserts a `queued` row.
2. An idle worker receives an atomic SQLite claim. The same statement changes
   the row to `running`, creates a unique lease, records worker/heartbeat/timeout
   metadata, and increments `attempt_count`.
3. Fastify sends a bounded, versioned JSON payload over Node IPC. Inputs must be
   inside the upload root; work/output directories are derived from the job ID.
4. The worker sends real progress, message, external-child PID, result, error,
   cancellation, and heartbeat events. Fastify persists batched progress and
   broadcasts the same state over SSE/WebSocket/workspace events.
5. Fastify accepts a result only when its job ID and lease still match. It
   confines the path to the job output directory, validates size/signature,
   commits `completed`, and registers the artifact in Converted Files.

There is no automatic download. A completed artifact remains in SQLite and the
workspace output table until the user explicitly downloads or removes it.

## Pool and category limits

Without an override, pool size is bounded by logical CPU count, reserves 1 GiB
of free RAM, budgets about 768 MiB per slot, and has a hard maximum of four. The scheduler also
enforces category ceilings so multiple memory-heavy PDF, media, or office jobs
cannot consume every process.

| Environment variable | Default behavior |
|---|---|
| `WORKER_POOL_SIZE` | Adaptive CPU/RAM value; 1–32 when configured |
| `MAX_CONCURRENT_JOBS` | Backward-compatible alias for pool size |
| `IMAGE_WORKER_CONCURRENCY` | Up to 4 when RAM permits |
| `PDF_WORKER_CONCURRENCY` | 1, or 2 when RAM permits |
| `MEDIA_WORKER_CONCURRENCY` | 1, or 2 when RAM permits |
| `OFFICE_WORKER_CONCURRENCY` | 1 |
| `GENERAL_WORKER_CONCURRENCY` | Global pool size |
| `MAX_JOB_ATTEMPTS` | 2 |
| `WORKER_HEARTBEAT_MS` | 2000 ms |
| `WORKER_STALE_MS` | 12000 ms |
| `WORKER_CANCEL_GRACE_MS` | 2000 ms before forced worker termination |
| `JOB_TIMEOUT_MS` | 300000 ms |

Each category ceiling is clamped to the effective global pool size. A job's
category is persisted so restart and diagnostics do not depend on frontend
state.

## Failure, cancellation, and restart

- Unexpected worker exit marks its active job `failed` with
  `errorCode=WORKER_CRASH`. It is `retryable` only while attempts remain. The API
  stays alive and starts a replacement worker.
- Timeout first sends cancellation, immediately terminates reported external
  process trees, then forcibly terminates an unresponsive worker after the
  grace period. The row records `JOB_TIMEOUT`.
- User cancellation wins over a racing result. Partial output is removed and a
  cancelled job can never be committed as completed.
- On server startup, `queued` rows keep their workspace/input metadata and
  resume. Orphaned `running` rows become `failed` with `SERVER_RESTART` and an
  explicit retryable flag. Completed rows and output paths are unchanged.
- Windows uses `taskkill /T /F` through `execFile`; POSIX uses detached process
  groups and signals. User-controlled data is never interpolated into a shell.
- API shutdown is re-entrant and drains idle keep-alive connections. A private,
  structured parent/child IPC message provides the same graceful stop path on
  Windows and Linux; SQLite runs a final `wal_checkpoint(TRUNCATE)` before the
  connection closes so a replacement process sees a self-contained database.

Unavailable external tools are rejected by capability gating and remain
non-retryable. AlphaStudio never substitutes a copy operation or fabricated
success for a missing converter.

## Diagnostics and operations

`GET /api/health` reads only in-memory counters, so it does not wait for SQLite,
capability probes, or a conversion process. `GET /api/diagnostics` adds:

- effective/configured process counts and worker heartbeat age;
- active and queued jobs per category;
- category limits and total queue depth;
- crash count, CPU count, and currently free memory.

Run `npm run benchmark:workers` after `npm run build`. It starts the compiled
same-origin server, streams a real large upload, queues real SHA-256/SHA-512
jobs, and compares health latency while idle with latency while the worker is
active. The command exits non-zero if health fails, no active-worker sample is
captured, or a conversion fails.

## Source map

- `server/src/workers/jobs.ts` — atomic claims, scheduler, supervisor, state/events
- `server/src/workers/worker-process.ts` — isolated processor execution
- `server/src/workers/ipc.ts` — protocol and message guards
- `server/src/lib/child-registry.ts` — cross-platform child-tree tracking/kill
- `server/src/db/migrations.ts` — v5 lease/retry schema
- `server/src/index.ts` — cross-platform graceful shutdown and restart ownership
- `server/tests/worker-process-pool.test.ts` — lifecycle regressions
- `scripts/benchmark-worker-latency.mjs` — production latency/acceptance benchmark
