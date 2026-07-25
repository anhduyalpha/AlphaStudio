# Audit 07 — Security, dependencies, filesystem safety, command execution

**Date:** 2026-07-24  
**Scope tag:** (g) Security only  
**Auditor role:** independent (read-only product code; this file is the sole write)  
**Repo root:** `C:\Users\Duy\Code\Project\AlphaStudio`  
**Baseline context:** `docs/stabilize/STATE.md` / `TOPOLOGY.md` @ program start  

## Declaration

This audit does **not** declare the product stable. It classifies security posture for the stabilize program and feeds the master plan risk register.

---

## 1. Scope

### In scope

| Area | Primary paths |
|------|----------------|
| Upload validation / magic | `server/src/security/validation.ts`, `server/src/routes/uploads.ts`, `server/src/routes/upload-sessions.ts`, `server/src/services/upload-session.ts`, `server/src/services/workspace.ts` (`acceptUploadedFile`) |
| Jobs / files / outputs | `server/src/routes/jobs.ts`, `server/src/routes/workspaces.ts`, `server/src/services/job-deletion.ts`, `server/src/workers/jobs.ts`, `server/src/workers/worker-process.ts` |
| Path joins / traversal | `server/src/lib/paths.ts` (`safeJoin`, `assertInsideRoot`, `sanitizeFilename`), archive zip-slip |
| External tool spawn | `server/src/lib/child-registry.ts`, media/office/python/archive engines |
| PDF password handling | `server/src/pdf/operation-options.ts`, `server/src/workers/jobs.ts` vault, tests |
| Auth / bind / CORS | `server/src/app.ts`, `server/src/lib/bind-guard.ts`, `server/src/lib/cors-origin.ts`, `server/src/config.ts` |
| Env / secrets hygiene | `.env.example`, `.gitignore` (`.env` listed) — **contents of `.env` not inspected/printed** |
| Dependencies / scripts | root + `server/package.json`, `package-lock.json`, `allowScripts`, `scripts/maint/deps.mjs` |
| Rate limiting policy | `server/src/app.ts` comments, `server/tests/rate-limit-absent.test.ts` |
| Related tests | `hardening.test.ts`, `api.test.ts` (zip-slip), `pdf-password-redaction.test.ts`, `job-delete-history.test.ts` |

### Out of scope

- Frontend UX/a11y (audit 03)
- CI/release pipelines (audit 08)
- Full dependency CVE inventory via live `npm audit` network run (tooling exists; not re-run as proof here)
- Product code changes / remediations in this pass

---

## 2. Threat model (assumed)

AlphaStudio is a **local-first personal studio**:

1. **Default deploy:** `HOST=127.0.0.1`, optional empty `API_AUTH_TOKEN`, same-machine browser + API.
2. **Expanded deploy:** non-loopback bind only with `API_AUTH_TOKEN` / `ALPHASTUDIO_AUTH_TOKEN` or explicit `ALLOW_INSECURE_BIND=1` (`server/src/lib/bind-guard.ts`).
3. **Attacker classes:**
   - A. Local unprivileged process on same host that can open loopback ports.
   - B. LAN peer when bind is non-loopback (with or without token).
   - C. Malicious **file content** (PDF, media, archives, Office, SVG/HTML) processed by optional binaries / Python bridge.
   - D. Supply-chain (npm install scripts, lockfile drift, optional Python profiles).

Impact focus: RCE via command injection, arbitrary filesystem read/write, zip-slip, secret leakage (PDF passwords, tokens), DoS (archive bombs, unbounded jobs), stored XSS when SPA and API share origin.

---

## 3. Executive summary

**Overall posture:** Strong for a single-user local tool. Command execution is consistently `spawn`/`execFile` **without shell**; archive extraction fails closed on traversal/symlinks; PDF passwords are vaulted in memory and redacted from SQLite/public job JSON; job output deletion has rigorous ownership checks; CORS and bind-guard are intentional and tested.

**No P0 (default-config remote RCE / shell injection) identified** under `HOST=127.0.0.1` and current argv-only tool wrappers.

Residual risk concentrates on: (1) **unauthenticated full API** on loopback by design, (2) **download/preview routes trusting DB paths** without re-asserting containment, (3) **inline preview of HTML/SVG** on the app origin when `SERVE_FRONTEND=1`, (4) **insufficient validation of ffmpeg time/filter option strings**, (5) intentional **absence of request rate limiting**, (6) auth token compare not constant-time.

---

## 4. Findings

Severity scale:

| Sev | Meaning |
|-----|---------|
| **P0** | Exploitable in default/recommended config for high impact (RCE, auth bypass, secret dump) |
| **P1** | High impact under realistic expanded threat (LAN + token, malicious upload pipeline) |
| **P2** | Medium; defense-in-depth gap or partial control |
| **P3** | Low; hardening / hygiene |
| **P4** | Informational or accepted product decision |

### 4.1 Positive controls (working as designed)

| Control | Evidence |
|---------|----------|
| No shell interpolation for tools | `execFileTracked` → `spawn(file, args, …)` (`server/src/lib/child-registry.ts`); `runProbeCommand` uses `shell: false` (`server/src/convert/engines/probe.ts`); office comment documents fixed argv (`server/src/convert/office.ts`) |
| Zip-slip / symlink fail-closed | `assertSafeArchiveEntry` (`server/src/security/validation.ts`); ZIP `onEntry` + symlink mode reject; `assertExtractTreeSafe`; 7z list-then-extract + `-snl -snh` (`server/src/processors/archive.ts`); tests in `server/tests/api.test.ts`, `hardening.test.ts` |
| Upload size + magic validation | Multipart limits (`app.ts`); streaming size cap (`uploads.ts` / workspace upload); `validateStoredFileQuick` extension + magic (`validation.ts`); random on-disk names via `randomServerName` |
| Resumable upload path safety | UUID session id regex + `safeJoin` for session/chunk paths (`upload-session.ts`) |
| Worker path confinement | Worker rejects inputs outside `uploadsDir`, work/output dirs must match `tempDir`/`outputsDir` + jobId (`worker-process.ts`); API settles only outputs inside job output dir (`jobs.ts` `isPathInside`) |
| Job delete ownership | `job-deletion.ts` `assertOwnedPath` / reparse/symlink walk; tested in `job-delete-history.test.ts` |
| PDF password handling | Capture → `jobPasswordVault`; `redactSensitiveOptions` before DB; re-inject only on worker payload; `SENSITIVE_OPTION_KEYS`; tests `pdf-password-redaction.test.ts` |
| CORS allowlist (incl. SSE) | `@fastify/cors` + `cors-origin.ts`; SSE refuses evil `Origin` (`jobs.ts`, `workspaces.ts`); hardening tests |
| Bind guard | `assertSafeBindHost` in `index.ts`; refuses `0.0.0.0` without token/opt-in |
| Optional API bearer | When `config.apiToken` set, all `/api/*` except health require `Authorization: Bearer` (`app.ts`) |
| Child kill / timeout | Job-scoped registry, `taskkill /T` / process-group kill, timeouts on tool runs |
| Log / meta redaction | pino redact paths (`logger.ts`); `sanitizeUserError`; `sanitizeResultMeta` strips path/password keys |
| Network-restricted LO/Python env | Proxy sinkhole to `127.0.0.1:9` in office + python engine |
| Python bridge confinement | Output realpath check in `python/bridge.py`; Node re-validates outputs |
| `.env` gitignored | `.gitignore` line `.env` |
| `allowScripts` allowlist | Root `package.json`: only `better-sqlite3`, `esbuild` (two pins), `sharp` |
| Rate-limit policy explicit | Comment in `app.ts`; `rate-limit-absent.test.ts` asserts no `@fastify/rate-limit` |
| Archive bomb quotas | `MAX_ARCHIVE_ENTRIES` / `MAX_EXTRACTED_BYTES` (`config.ts`, `ExtractionQuota`) |

### 4.2 Findings table

| ID | Sev | Title | Location | Notes |
|----|-----|-------|----------|-------|
| S-01 | **P1** | Download/preview trust DB paths without runtime root check | `routes/jobs.ts` `/api/jobs/:id/download`; `routes/workspaces.ts` `/api/files/:id/download`, `/preview`, `/api/outputs/:id/download`, ZIP builder via `listOutputsForZip` | Streams `row.path` / `job.output_path` if `existsSync`. **No** `assertInsideRoot(config.uploadsDir\|outputsDir, …)`. Deletion path is strict; read path is not. Requires poisoned DB path or prior write to SQLite (local attacker). |
| S-02 | **P1** | Inline file preview can serve active content (HTML/SVG) on app origin | `validation.ts` allows `.html`/`.htm`/`.svg`; `workspaces.ts` preview sets `Content-Type` only (no `Content-Disposition: attachment`, no CSP) | With `SERVE_FRONTEND=1`, same-origin preview may execute scripts in SVG/HTML under AlphaStudio origin. Full API access already implies high privilege on loopback; severity elevates when bearer auth is used for multi-device LAN. |
| S-03 | **P2** | Unauthenticated API surface on loopback (by design) | `app.ts` auth hook returns early if `!config.apiToken`; default `HOST=127.0.0.1` | Any local process can upload, create jobs, download all files/jobs, mutate settings. Acceptable for single-user; document risk for multi-user machines. |
| S-04 | **P2** | ffmpeg option strings not strictly validated | `processors/media.ts` `start`/`duration`/`end` via `String(...)`; `targetLoudness` interpolated into `loudnorm=I=${target}:…` | Args passed as separate argv (not shell), and `-protocol_whitelist file,pipe` reduces SSRF. Filter/arg abuse, DoS, or unexpected demuxer behavior still possible. |
| S-05 | **P2** | No application-level rate limiting | `app.ts` explicit; tests require absence | Resource exhaustion via rapid jobs/uploads when API is reachable (esp. insecure LAN bind). Mitigations: upload size, job pool, timeouts, archive quotas. |
| S-06 | **P2** | Bearer compare is not constant-time | `app.ts` `supplied !== config.apiToken` | Practical risk low for long random tokens on localhost; fix if LAN-auth becomes primary. |
| S-07 | **P3** | CORS allows any `http://localhost\|127.0.0.1:<port>` | `app.ts`, `cors-origin.ts` | Intentional for Vite ports; any local HTTP origin can call API with credentials from a browser on the same machine. |
| S-08 | **P3** | Dependency versions use caret ranges in package.json | `package.json`, `server/package.json` | Lockfile pins resolved versions + integrity. Risk is `npm install` without lock / drift. `vite` is exact `6.4.3` (good). |
| S-09 | **P3** | Password present in worker IPC payload (memory only) | `jobs.ts` vault re-inject into `options.password` | Not persisted to SQLite. Local process memory / crash dumps could hold secrets briefly. |
| S-10 | **P3** | Settings store arbitrary key/values (bounded) | `routes/settings.ts` | Keys regex-limited; values ≤2000 chars; no auth on loopback → local UI settings spoof. Low impact unless settings later drive security policy. |
| S-11 | **P4** | Rate limit intentionally removed | `rate-limit-absent.test.ts`, `.env.example` has no `RATE_LIMIT_*` | Product decision for personal app; re-evaluate for shared host. |
| S-12 | **P4** | Optional tool supply chain (ffmpeg, LO, 7z, Python profiles) | `tools/registry.ts`, `scripts/setup-tools.mjs`, `python/requirements-*.txt` | Core Python profile is empty (stdlib). Heavier profiles and binary installers expand attack surface; out of core runtime until installed. |
| S-13 | **P4** | No CSP / security headers on SPA | `app.ts` static + SPA fallback | Common gap; pairs with S-02. |

### 4.3 Command-injection surface review

| Invoker | Shell? | User-influenced args | Assessment |
|---------|--------|----------------------|------------|
| `execFileTracked` (ffmpeg, ffprobe, LO, 7z, pandoc, calibre, python) | No | Paths from server-chosen uploads/outputs; some options (time, format) | **No classic shell injection.** Prefer allowlist parsers for times/filters (S-04). |
| `execFile` taskkill | No | PID from internal registry only | Safe |
| `fork` worker | N/A | Job payload validated in worker | Good |
| `execFileSync` capability probes | No | Fixed tool paths/args | Safe |
| Scripts under `scripts/` | Mixed maint tooling | Not request path | Out of runtime API threat model |

**LibreOffice:** Fixed flags + isolated profile + isolated input basename; input path is copied into job outdir (`office.ts`).  
**7z create:** `['a', '-y', outputPath, ...ctx.inputPaths]` — paths from prior upload validation/worker checks.  
**Python:** Operation id + JSON options; no shell; outputs confined.

### 4.4 Filesystem safety review

| Flow | Mechanism | Gap |
|------|-----------|-----|
| Upload store | `path.join(uploadsDir, randomServerName(ext))` after `sanitizeFilename` on original only | Good |
| Chunk store | `safeJoin(uploadSessionsDir, uuid)` + `N.chunk` | Good |
| Archive extract | assert + realpath tree walk + quotas | Good |
| Worker I/O | Dir equality + `isInside(uploadsDir)` | Good |
| Job complete | `isPathInside(outputDir, result.outputPath)` | Good |
| Job delete | Ownership + no reparse escape | Good |
| **HTTP download** | existsSync + stream | **Missing root assert (S-01)** |
| ZIP multi-download | DB path existence only | **Same (S-01)** |

`safeJoin` / `assertInsideRoot` correctly reject `..` and absolute escape (`paths.ts`).

### 4.5 Secrets & password handling

| Secret | Handling | Verdict |
|--------|----------|---------|
| PDF password | Stripped from options before INSERT; vault `Map`; re-inject for worker only; public DTO uses `redactSensitiveOptions` | **Sound design** |
| API token | Env only; not logged via pino redact paths | OK; compare not constant-time (S-06) |
| Generated password job | `processors/security.ts` crypto `randomInt`; written to **output file** `password.json` (user-requested feature) | Expected; treat output as sensitive |
| `.env` | gitignored; example has commented token placeholders only | Good |
| Settings table | Not for tokens today | Monitor |

### 4.6 Dependencies & install scripts

| Item | Status |
|------|--------|
| Lockfile | `package-lock.json` lockfileVersion 3 with integrity hashes |
| Native allowScripts | Explicit allowlist (not blanket install scripts) |
| Audit tooling | `npm run deps:check` → `scripts/maint/deps.mjs` runs `npm audit` |
| Server deps | fastify 5.x, better-sqlite3, sharp, pdf-lib, archiver, tar, extract-zip, etc. — all via lock |
| Python core | No pip packages required |
| Unknown (this pass) | Live CVE counts not frozen into this document |

### 4.7 CORS, auth, rate limit (summary)

```
Default: loopback + no token → open to local callers
Optional: API_AUTH_TOKEN → Bearer on all /api except /api/health
CORS: configured origin OR http://localhost|127.0.0.1:any-port
Rate limit: intentionally absent (tested)
```

---

## 5. Plan (remediation order)

### P0

- None required for default loopback posture.

### P1 (stabilize before any “network multi-user” claim)

1. **S-01 — Path containment on every download/stream**
   - Before `createReadStream`, `assertInsideRoot(config.uploadsDir, path)` or `outputsDir` as appropriate; for jobs, require `isPathInside(path.join(outputsDir, jobId), output_path)`.
   - Apply same check in `listOutputsForZip` (skip/reject escaping paths).
   - Add regression tests (DB row with `../` or absolute path → 400/404, no file body).

2. **S-02 — Active content preview**
   - Force `Content-Disposition: attachment` for non-preview-safe types, **or**
   - Serve preview under `Content-Type: application/octet-stream` / sandbox, **or**
   - Disallow `.html`/`.htm` uploads if product does not need them; strip scripts from SVG / refuse SVG with `<script` / external refs.
   - Prefer adding baseline CSP headers when static SPA is served.

### P2

3. **S-04 — FFmpeg option allowlists**
   - Parse `start`/`duration`/`end` as numeric seconds or `HH:MM:SS(.ms)` regex only.
   - Parse `targetLoudness` as finite float in a closed range (e.g. -70..-5).
   - Reject any option containing filter separators if ever user-controlled in `-vf`/`-af`.

4. **S-05 / S-03 — Exposure policy**
   - Document clearly: “no auth on loopback; enable `API_AUTH_TOKEN` before non-loopback.”
   - Optional soft rate limits (per-IP job create / upload) when `apiToken` set or host non-loopback.
   - Consider refusing `ALLOW_INSECURE_BIND` without token (today token **or** insecure flag).

5. **S-06** — `crypto.timingSafeEqual` on equal-length buffers for bearer token.

### P3 / P4

6. Pin critical runtime deps more tightly if release trains require bit-identical installs without lock (prefer always shipping lock).
7. Periodic `npm run deps:check` in CI (audit 08).
8. Optional CSP + `X-Content-Type-Options: nosniff` on API file responses.
9. Clear vault entry on job terminal states (verify all cancel/fail/success paths call `clearJobPassword`).

---

## 6. Dependencies of this audit

| Depends on | Why |
|------------|-----|
| Default config remains local-first | Severity of S-03/S-05 |
| Worker always validates output paths | Download path gap is residual, not primary write vector |
| Optional binaries installed only via trusted setup | Supply-chain residual (S-12) |
| No product changes in this pass | Findings are observational |

---

## 7. Risks if deferred

| Risk | If deferred |
|------|-------------|
| DB path poison → arbitrary file read via download APIs | Local attacker or future multi-tenant misuse (S-01) |
| Stored XSS via HTML/SVG preview + shared origin | Session/token theft if cookie-based auth added later; scripted API abuse with user browser (S-02) |
| Unbounded job spam on exposed bind | Disk/CPU exhaustion (S-05) |
| Filter string abuse in ffmpeg | Worker DoS / unexpected processing (S-04) |

---

## 8. Unknowns / not fully proven this pass

1. **Live `npm audit` vulnerability set** — tooling present; not re-executed here; treat as continuous.
2. **Every cancel/fail path clears `jobPasswordVault`** — design intent clear; full call-graph not exhaustively proven in this audit.
3. **extract-zip library edge cases** vs custom `onEntry` guards — tests cover classic `../`; exotic zip64/symlink attribute variants need ongoing fixtures.
4. **Windows reparse points** outside job-delete walk (downloads don’t use the same reparse guards).
5. **Frontend** sending password only over HTTP body to loopback — assumed same-host; not re-audited client store.
6. **Playwright/e2e** security coverage beyond unit hardening tests — limited.

---

## 9. Test coverage relevant to security

| Test file | What it locks |
|-----------|----------------|
| `server/tests/rate-limit-absent.test.ts` | No rate-limit middleware; rapid health ≠ 429 |
| `server/tests/hardening.test.ts` | CORS, bind guard, archive safety, LO isolation, child tracking |
| `server/tests/api.test.ts` | Zip-slip extract job fails closed |
| `server/tests/pdf-password-redaction.test.ts` | Password redaction helpers / no secret in stored options shape |
| `server/tests/job-delete-history.test.ts` | Output ownership on delete |
| `server/tests/resumable-upload*.test.ts` | Session/chunk behavior (path safety indirect) |

**Missing tests (recommended):** download path escape (S-01); HTML/SVG preview disposition (S-02); ffmpeg time/loudness reject (S-04); timing-safe auth (S-06).

---

## 10. Concrete code citations (anchors)

### Validation & zip-slip

```197:209:server/src/security/validation.ts
/** Zip-slip safe path check for archive members */
export function assertSafeArchiveEntry(destRoot: string, entryName: string): string {
  const normalized = entryName.replace(/\\/g, '/');
  if (normalized.includes('\0') || path.isAbsolute(normalized) || normalized.split('/').includes('..')) {
    throw badRequest(`Unsafe archive entry rejected: ${entryName}`);
  }
  // ...
}
```

### Path helpers

```19:41:server/src/lib/paths.ts
export function safeJoin(root: string, ...segments: string[]): string {
  const joined = path.resolve(root, ...segments);
  const normalizedRoot = path.resolve(root) + path.sep;
  if (joined !== path.resolve(root) && !joined.startsWith(normalizedRoot)) {
    throw badRequest('Path traversal rejected');
  }
  return joined;
}
```

### Auth + no rate limit + CORS

```43:70:server/src/app.ts
  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin === config.corsOrigin || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) {
        cb(null, true);
        return;
      }
      cb(new Error('CORS blocked'), false);
    },
    credentials: true,
  });
  // ...
  // No application-level request rate limiting (single-user personal app).
```

### Password vault

```54:63:server/src/workers/jobs.ts
/**
 * Ephemeral password vault: passwords exist only for the job duration in the
 * API process memory, never written to SQLite options/result JSON.
 */
const jobPasswordVault = new Map<string, string>();
```

```249:251:server/src/workers/jobs.ts
  const capturedPassword = extractPassword(incoming);
  const options: Record<string, unknown> = redactSensitiveOptions(incoming);
```

### Download without containment

```65:76:server/src/routes/jobs.ts
  app.get('/api/jobs/:id/download', async (req, reply) => {
    // ...
    if (!fs.existsSync(job.output_path)) throw notFound('Output file missing');
    // streams job.output_path — no assertInsideRoot
    return reply.send(fs.createReadStream(job.output_path));
  });
```

```276:294:server/src/routes/workspaces.ts
  app.get('/api/files/:id/download', /* ... createReadStream(row.path) */);
  app.get('/api/files/:id/preview', /* Content-Type only; inline */);
```

### FFmpeg args

```509:518:server/src/processors/media.ts
function safeFfmpegInputArgs(): string[] {
  return [
    '-y', '-nostdin', '-hide_banner', '-loglevel', 'error',
    '-protocol_whitelist', 'file,pipe',
  ];
}
```

```111:125:server/src/processors/media.ts
  // start/duration/end taken as raw strings into argv
  args.push('-ss', start, '-i', ctx.inputPaths[0]);
```

### Bind guard

```1:26:server/src/lib/bind-guard.ts
// Refuse non-loopback bind unless auth is configured or ALLOW_INSECURE_BIND=1
```

### allowScripts

```64:69:package.json
  "allowScripts": {
    "better-sqlite3@12.11.1": true,
    "esbuild@0.21.5": true,
    "esbuild@0.28.1": true,
    "sharp@0.35.3": true
  }
```

### Env hygiene

- `.gitignore` includes `.env`
- `.env.example` documents `HOST`, `API_AUTH_TOKEN`, limits, worker knobs — **no live secrets**

---

## 11. Severity rollup

| Sev | Count | IDs |
|-----|-------|-----|
| P0 | 0 | — |
| P1 | 2 | S-01, S-02 |
| P2 | 4 | S-03, S-04, S-05, S-06 |
| P3 | 4 | S-07, S-08, S-09, S-10 |
| P4 | 3 | S-11, S-12, S-13 |

**Gate recommendation for stabilize program:** Do not claim “network-hardened multi-user secure” until S-01 and S-02 are fixed. Default **single-user loopback** personal use is consistent with current architecture, with residual local-trust assumptions documented.

---

## 12. Follow-ups for master plan

1. Track S-01/S-02 as must-fix checkpoints before any HOST≠loopback default change.
2. Wire `deps:check` into CI (audit 08).
3. Cross-link runtime/tools audit (05) for binary installer trust.
4. Keep rate-limit absence as explicit product decision, not an accidental regression (already tested).

---

## 13. Explicit non-claims

- Did not modify product source.
- Did not print or open `.env` secret values.
- Did not run a full live vulnerability database audit as frozen evidence.
- Did not pen-test multi-user auth models beyond code review.
- Repository remains **not declared stable**.
