# Handoff: CP03 — Security, job honesty, multi-domain verify, Docker/CI

**Date:** 2026-07-24  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Base before work:** `77c2601` (CP02 tip)  
**HEAD after push:** *(filled after push)*  
**Local HEAD == remote:** *(filled after push)*

## Goal

Continue multi-domain stabilization from CP02: independent scope verification; Core/Full modes; Windows/Linux/Docker evidence; repair P0–P2 with tests; push green checkpoint.

## Explicit non-claims

- **Not fully product-stable** (master-plan DoD incomplete: a11y CP6, VPS, branch protection ops, full Linux host matrix residual).
- Color UI stubs and dual OCR capability ids remain residual (documented).
- Heavy Python profiles/models not installed (honest gates).

## Scope verification (independent agents)

| Scope | Result | Evidence |
|-------|--------|----------|
| Converter / engine | green primary paths | scopes/converter/REPORT.md |
| PDF + PDF.js | green; optional rasterizer absent honest | scopes/pdf/REPORT.md |
| Image / Media / Archive | green; 7z extract P1 fixed | scopes/image|media-audio|archive |
| Text / OCR / Color / Security tools / Dev utils | text/security OK; format-json P0 fixed; color stubs residual | scopes/* |
| Lifecycle / uploads / SSE / restart | green + retry honesty | scopes/lifecycle |
| Runtime / Python / Platforms | full tools OK; Docker added | scopes/runtime|python|platforms |
| Cross-review | mismatches recorded | cross-review.md |

## Repairs this checkpoint

| Issue | Sev | Fix | Regression |
|-------|-----|-----|------------|
| S-01 download/preview path trust | P1 | `assertDownloadablePath` on job/file/output/zip routes | `download-path-confinement.test.ts` |
| S-02 HTML/SVG inline preview | P1 | attachment + nosniff + CSP sandbox for active types | same |
| F-B01/F-B02 retry + password vault | P1 | `POST /api/jobs/:id/retry` + `PASSWORD_REQUIRED` when vault empty | `job-retry-honesty.test.ts` |
| F-B03 converter create honesty | P1 | create-time matrix gate for unavailable engines | existing converter tests |
| Windows 7z extract absolute Path= | P1 | `parse7zEntries` filter | `archive-7z-list-filter.test.ts` |
| format-json MIME `.json` vs `text/plain` | P0 | emit `application/json` | `text-format-json.test.ts` |
| No CI | P1 | `.github/workflows/ci.yml` typecheck+build+test | workflow file |
| No Docker packaging | P2 | `Dockerfile` + `docker-compose.yml` (no socket) | platforms evidence |

## Suite results (fresh)

| Suite | Result |
|-------|--------|
| typecheck | PASS |
| build | PASS |
| npm test | **587 pass / 0 fail / 0 skip** |
| test:maint | 35 pass |
| test:hygiene | 7 pass |
| test:pdf | 144 pass |
| fixtures:pdf:verify | 8 records |
| test:python | 15 OK |

## Core / Full modes

- **Core:** optional tools absent → capabilities `available:false` + reason; no crash; create returns 503 for gated ops.
- **Full (host):** tools:check 6/6; doctor pass (2 warnings); python core; representative conversions.

## Platforms

| Platform | Evidence |
|----------|----------|
| Windows | path spaces/Unicode + confinement; process tests green |
| Linux host | residual — WSL only `docker-desktop`, no user distro |
| Docker | clean build **999MB**; health healthy; restart OK; volume `/data`; temp ~5.1M; text hash conversion completed; **no docker.sock** |
| VPS / home multi-user | residual threat model (not claimed ready) |

## Next action

**CP6 / residual product honesty** — frontend a11y P1s (command palette / drawer / motion), or wire dual OCR cap ids / color tool honesty, or expand CI with E2E optional job. Prefer a11y CP6 if keyboard users are next priority; else close residual capability dualisms.

*Do not declare product-stable until master-plan DoD is met.*
