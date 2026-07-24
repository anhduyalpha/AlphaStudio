# Security boundary — local stable baseline

**Status:** product-boundary register for stabilize finish bar  
**Threat model:** single-user loopback personal studio (not multi-tenant VPS)

## Closed by code + tests (CP03 / CP04)

| ID | Sev | Status | Evidence |
|----|-----|--------|----------|
| S-01 | was P1 | **CLOSED** | `assertDownloadablePath` on download/preview/ZIP; `download-path-confinement.test.ts` |
| S-02 | was P1 | **CLOSED** | Active HTML/SVG → attachment + nosniff + CSP sandbox; same tests |
| S-04 | was P2 | **CLOSED** | `parseFfmpegTime` / `parseTargetLoudness` allowlists; `media-ffmpeg-options.test.ts` |
| S-06 | was P2 | **CLOSED** | `bearerTokensEqual` via `timingSafeEqual`; `auth-bearer-timing.test.ts` |

## Formal closures (accepted product boundary — not open P0–P2 defects)

### FC-S-03 — Unauthenticated loopback API

AlphaStudio’s **stable baseline** is a **single-user, loopback-bound** personal studio (`HOST=127.0.0.1`, optional empty `API_AUTH_TOKEN`). In this configuration the API is intentionally reachable by any process on the same host. This is an accepted trust boundary, not a defect. Operators on multi-user machines must set a long random `API_AUTH_TOKEN` (and matching frontend build token if applicable) or isolate the host user.

### FC-S-05 / S-11 — No application-level rate limits

Application-level HTTP rate limiting is **intentionally absent** for the personal single-user app (locked by `rate-limit-absent.test.ts`). Resource ceilings remain: max upload/output bytes, archive entry/byte quotas, worker pool/category concurrency, job/Python timeouts, and child process kill-on-cancel. **Shared-host / public / multi-tenant** deployments must add rate limiting (and TLS) at a reverse proxy or edge; this is **out of scope** for the local stable baseline (deploy epic).

### FC-S-14 — Docker / compose LAN exposure defaults

The published `Dockerfile` / `docker-compose.yml` are a **convenience local/home-server packaging** path. Defaults use `HOST=0.0.0.0` and `ALLOW_INSECURE_BIND=1` so the container listens on all interfaces **without** auth unless the operator sets `API_AUTH_TOKEN`. This is **not** a hardened multi-user or Internet-facing stack: no TLS termination, no non-root USER, no app rate limits. Operators must set a bearer token (and prefer binding only on a trusted network or behind a reverse proxy) before exposing port 8787 beyond a trusted host. **VPS multi-user readiness remains a separate deploy epic.**

### FC-XR-06 / S-16 — SPA token is not public auth

Embedding `VITE_API_TOKEN` in the SPA is suitable only for low-threat LAN/local use. Public Internet deployments require edge TLS, reverse-proxy auth, and must not treat the SPA bundle as a secret store.

## Open after this register (P3/P4 or later epics only)

- S-07 CORS localhost any-port (intentional for Vite)
- S-08 caret ranges (lockfile pins installs)
- S-09 password in worker IPC memory
- S-10 settings store on loopback
- S-12 optional tool supply-chain / SHA integrity (CP5 residual)
- S-13 SPA CSP headers (optional hardening)
- S-15 download realpath/symlink defense-in-depth
- S-17 temp file modes on multi-user UNIX

## Open P0/P1/P2 security register

**Empty** for the local single-user stabilize baseline after CP04 (fix + formal closures above).
