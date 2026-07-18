# Runtime validation

Release validation for AlphaStudio 3.6.0 on 2026-07-17:

- `npm ci --cache <isolated temp cache>` — passed from the root lockfile.
- `npm run build` — Vite production client and TypeScript server passed.
- `npm test` — 401/401 passed across 133 suites, including all prior phases.
- Phase-3 focused regressions — 5/5 passed: simulated network loss, server
  restart/resume, missing/repeated/conflicting chunks, checksum/range checks,
  pause/resume, cancel, size limit, and equal-head/tail false-dedup prevention.
- `npm run test:maint` — 24/24 passed.
- `npm run test:audit` — 4/4 passed.
- `npm run audit:backend` — 0 issues across 21 real conversion rows; restart
  restoration, SQLite quick-check, state hydration, and security checks passed.
- `npm audit` and `npm audit --omit=dev` — 0 vulnerabilities.
- Development smoke — Vite returned 200 and proxied `/api/health`; the backend
  reported healthy and `/api/version` returned 3.6.0.
- Production smoke — compiled same-origin UI/API passed; four real 80 MiB
  SHA-256/SHA-512 jobs completed in a one-process worker pool with 80/80 health
  samples and no failures. Idle p95 was 1.909 ms; loaded p95 was 0.835 ms.
- Upload/detect benchmark — legacy 64 KiB response 28.356 ms; 12 MiB resumable
  init 4.844 ms, 12 chunk responses averaged 6.064 ms (max 9.882 ms), finalize
  plus bounded quick detect 25.111 ms, and background checksum/deep detect
  reached Ready in 27.799 ms on this host.
- Exact evidence is in `audit/logs/worker-latency-benchmark-v3.6.0.json` and
  `audit/logs/upload-detect-benchmark.json`.
- Production output remains registered in Converted Files and is never
  automatically downloaded.
- Packaged-archive verification — extracted `grok-v3.6.0.zip` into a clean
  directory, then `npm ci`, `npm run build`, and the 5 focused phase-3 tests all
  passed using only files contained in the archive.

The release archive excludes dependencies, user data, databases, caches, local
tools, audit temporary databases, and secrets. Run `npm ci` after extracting it.
All project process spawning continues to use argument arrays with `shell: false`
and the shipped npm scripts support Windows and Linux.

No Chromium/Firefox binary is installed on the validation host, so frontend
coverage uses a real Vite HTTP smoke plus production build and structural tests,
not browser screenshots. Optional 7-Zip is unavailable on this host and remains
reported as **Unavailable**; no conversion result is fabricated.
