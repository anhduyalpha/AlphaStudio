# AlphaStudio changelog

## v3.6.0 — Resumable chunk upload and fast detection

- Added SQLite-backed upload sessions with init, ranged chunk upload, status,
  pause, resume, finalize, and cancel endpoints while preserving multipart upload.
- Streams each chunk and final assembly without whole-file buffering; validates
  index, `Content-Range`, exact byte count, per-chunk SHA-256, size, MIME, magic,
  path confinement, and timeouts.
- Made repeated chunks idempotent and restart recovery deterministic; missing or
  conflicting chunks fail explicitly and expired/orphan staging is cleaned safely.
- Added Converter pause/resume/retry/cancel controls, actual bytes, throughput,
  ETA, multi-file drag/drop, and a three-file upload concurrency limit.
- Persists resumable status across browser/server reloads; reselecting the same
  browser file reconnects to its session without treating head/tail fingerprints
  as proof of identity.
- Finalize returns a file immediately with bounded quick header detection, while
  full checksum/deep detection runs in the existing background/SSE pipeline and
  always reaches a terminal Ready/Failed state.
- Marks exact duplicates only after size plus full SHA-256 equality and exposes
  the verified original id as `duplicateOf`.
- Added restart/network-loss, repeated/missing chunk, pause/resume, cancel,
  range/checksum, oversize regression tests and a real upload/detect benchmark.
- Added no runtime dependency.

## v3.5.0 — Process worker job engine

- Moved every conversion processor out of Fastify into persistent, isolated
  Node child processes with versioned, validated JSON IPC and no shell.
- Added adaptive CPU/RAM pool sizing plus independent image, PDF, media,
  office, and general category ceilings with environment overrides.
- Added atomic SQLite job leases, attempt/retry metadata, heartbeats, timeout
  ownership, and deterministic restart recovery for queued, running, and
  completed jobs.
- Mirrored external process PIDs to the API parent so cancellation, timeout,
  shutdown, and worker crashes terminate FFmpeg/LibreOffice process trees on
  Windows and Linux.
- Added idempotent IPC shutdown, idle-connection draining, and a final SQLite
  WAL truncate checkpoint so process supervisors can restart cleanly on both
  Windows and Linux without losing persisted workspace state.
- Preserved the existing REST/SSE/WebSocket contract while extending job DTOs
  with category, attempts, retryability, and stable error codes.
- Added `/api/diagnostics` with worker health, category activity, queue depth,
  crash count, CPU, and free-memory metrics; `/api/health` remains in-memory.
- Removed large-file checksum work from API scheduling and bounded text output
  validation to keep the API event loop responsive.
- Added regression tests for duplicate claims, worker crash isolation,
  cancellation, restart recovery, timeout, and output validation, plus a real
  production idle-vs-heavy-job health latency benchmark.
- Added `docs/job-engine.md`, worker environment examples, release validation,
  and cross-platform operational guidance. No runtime dependency was added.

## v3.4.0 — Studio Nodes design system

- Added an original AlphaStudio identity with adaptive mark, wordmark,
  horizontal and monochrome lockups, favicon, 192/512 app icons, and a maskable
  app icon.
- Replaced scattered JSX icon strings with a shared, currentColor SVG sprite and
  accessible `Icon` registry covering all workspaces, utilities, and nine
  semantic processing states.
- Rebuilt workspace artwork as transparent SVG illustrations that remain
  readable in light and dark themes without fixed-background text.
- Added shared upload, Converted Files, no-results, missing-tool, failed, and
  backend-offline empty states connected to real application conditions.
- Integrated the brand and assets into the sidebar, Dashboard, tool cards,
  modular workspaces, job output cards, file picker, and Converted Files list.
- Added subtle vector dashboard/onboarding patterns and a development-only asset
  gallery for theme, size, hover, disabled, and responsive checks.
- Added `docs/assets.md` and structural regression coverage for registry
  completeness, SVG safety, PNG dimensions, accessibility, production gating,
  and responsive CSS.
- Added no runtime dependency; app PNGs are derived with the already-bundled
  Sharp pipeline.

## v3.3.0

- Unified production hosting: Fastify now serves the compiled React app and API
  from one origin on Windows and Linux.
- Fixed job progress at 0% by showing a real indeterminate state until the first
  backend progress event, with SSE plus polling/reconnect recovery.
- Fixed QR generation, authenticated preview/download helpers, logo composition,
  preview URL lifecycle, and bounded QR decode memory use.
- Converted outputs now remain in **Converted Files** with source name, status,
  progress, preview, manual download, ZIP download, retry, and remove controls.
- Upload acceptance now uses quick bounded detection, then performs full checksum
  and deep detection asynchronously with workspace events.
- Added workspace output hydration and reliable persistence across server restart.
- Replaced vulnerable general-purpose file sniffing with a bounded built-in magic
  detector for supported formats; dependency audits report zero vulnerabilities.
- Improved startup and development speed through lazy processors, capability
  warm-up after listen, cached detection, job-result caching, batched progress
  writes, a bounded worker pool, and lean Vite watch settings.
- Updated native/runtime packages and cross-platform maintenance, tool-install,
  audit, build, development, and shutdown scripts.
- Expanded regression coverage for hosted API paths, QR, manual outputs,
  indeterminate progress, dependency safety, and restart restoration.
