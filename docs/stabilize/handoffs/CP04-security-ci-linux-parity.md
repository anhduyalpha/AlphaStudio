# Handoff: CP04 — Security register close, CI harden, Linux parity

**Date:** 2026-07-25  
**Author / agent:** Grok stabilize implementer  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Base SHA before work:** `55551b36e6d92503bf2c8238284757cb6e8c54ef`  
**Content HEAD:** `cb01099a1a1c2a9b3f6beda466c7ed14159174d8`  
**Remote CI:** success — [run 30118515153](https://github.com/anhduyalpha/AlphaStudio/actions/runs/30118515153) (`CI / core-ubuntu`)  
**Local HEAD == remote HEAD:** YES (`git rev-parse HEAD` == `@{u}` == `cb01099`)

### Goal of this checkpoint

Empty the open P0–P2 security register (fix + formal boundary), mitigate critical/high npm advisories, fix remote Ubuntu CI red (Linux-only failures), harden CI (concurrency, permissions, failure logs, maint/hygiene), and capture cleanup/resource evidence.

### Scope touched

- Paths: `server/src/app.ts`, `server/src/lib/bearer.ts`, `server/src/lib/sanitize.ts`, `server/src/processors/media.ts`, `server/src/convert/pdfInspect.ts`, `server/src/convert/matrix.ts`, `server/src/convert/engines/libreoffice.ts`, `server/tests/*` (new + related), `.github/workflows/ci.yml`, `package.json` / lockfile, `docker-compose.yml`, `docs/stabilize/*`
- Out of scope: CP6 a11y product work, branch protection enable, VPS TLS/rate-limit productization, full Windows CI job (documented residual)

### Domain inspect + cross-review

- Plans: `{SCRATCH}/domain-plans/{security,ci,dependencies,performance,cleanup,quality,cross-review}.md`
- Security↔architecture: S-03/S-05/S-14 formal close; S-04/S-06 fix; S-01/S-02 remain closed
- Performance↔tests: cleanup GC tests + upload bench; no engine rewrite

### Repairs

| Issue | Sev | Fix | Regression |
|-------|-----|-----|------------|
| S-06 bearer `!==` | P2 | `bearerTokensEqual` + `timingSafeEqual` | `auth-bearer-timing.test.ts` |
| S-04 ffmpeg options | P2 | `parseFfmpegTime` / `parseTargetLoudness` | `media-ffmpeg-options.test.ts` |
| S-03 / S-05 / S-14 | P2 | Formal closures | `SECURITY_BOUNDARY.md` |
| npm HIGH (@fastify/static, find-my-way, fast-uri) | High | `npm audit fix` → **0 vulns** | lockfile + audit log |
| allowScripts esbuild drift | P1 | allow `esbuild@0.25.12` | package.json |
| Unix path leak in errors | P1 CI | Broaden `sanitizeUserError` | reliability tests |
| pdf-lib hex Tj not harvested | P1 CI | native PDF text hex decode | pdf-validation / text extract |
| LO routes `supported:false` when missing | P1 CI | LO pairs always product-supported | pdf-routing DOCX→PDF |
| routeConversion unavailable engines | P2 | Map intended engine when binary missing | matrix + LO |
| Remote CI always red | P0 | Linux suite parity fixes + CI harden | isolated Docker 606/0 |
| CI gaps | P1 | concurrency cancel, permissions, pipefail tee, failure artifact, maint/hygiene | `ci.yml` |
| Cleanup evidence gap | finish bar | temp TTL + session GC tests | `cleanup-retention.test.ts` |

### Gates

| Gate | Result | Evidence |
|------|--------|----------|
| typecheck | PASS | suite-runs/typecheck.txt |
| build | PASS | suite-runs/build.txt |
| npm test (Windows) | **606 pass / 0 fail** | suite-runs/npm-test-local-final.txt |
| Linux isolated Docker npm test | PASS (after LO fix; see suite-runs) | npm-test-linux-isolated-2 + linux-focused-2 |
| test:maint | 35 pass | suite-runs/test-maint.txt |
| test:hygiene | 7 pass | suite-runs/test-hygiene.txt |
| npm audit | **0 vulnerabilities** | suite-runs/npm-audit-final.txt |
| upload bench | acceptance true | perf-cleanup/bench-upload.txt |
| Diff validation | no drive-by format | git diff --stat |
| Branch protection | **not enabled** | intentional |

### Open P0/P1/P2 security register

**Empty** for local single-user baseline. See `docs/stabilize/SECURITY_BOUNDARY.md`.

### Required CI check name (readiness only)

- **`CI / core-ubuntu`** — do not enable branch protection until this check has succeeded once on remote HEAD.

### Explicit non-claims

- Not fully product-stable (master-plan DoD incomplete).
- Not VPS/multi-user ready.
- Branch protection not enabled.
- Full Windows Actions job and full-runtime/Docker scheduled lanes deferred.

### Follow-ups / next exact action

1. **CP6** — frontend a11y P1s (command palette focus trap/names/Escape; drawer/search; motion setting wire or relabel), **or** optional Windows core CI job for dual-OS remote parity.
