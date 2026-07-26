# AUDIT-metrics

Read-only audit, Phase 0 (shell-derived metrics only). Repo: AlphaStudio, branch `main`, clean tree at commit `d1d5ca4`. Date: 2026-07-26.

## 1. LOC per file

Definition of "source": git-tracked files with extensions `js`, `jsx`, `ts`, `tsx`, `mjs`, `py`, `css`, `html`; `package-lock.json` excluded (no other lockfiles matched). Totals: **312 files, 65,948 LOC**.

Top 30 largest source files:

| File | LOC |
|---|---:|
| src/styles.css | 5421 |
| server/src/workers/jobs.ts | 2442 |
| src/views/ConverterView.jsx | 1972 |
| server/src/services/workspace.ts | 1063 |
| scripts/setup-tools.mjs | 939 |
| server/src/convert/detect.ts | 894 |
| server/src/tools/registry.ts | 759 |
| scripts/maint/lib/tools-probe.mjs | 699 |
| src/views/PdfView.jsx | 689 |
| server/src/processors/converter.ts | 679 |
| scripts/maint/deps.mjs | 656 |
| src/views/QrView.jsx | 642 |
| server/tests/hardening.test.ts | 630 |
| server/src/processors/media.ts | 627 |
| src/lib/converterGroups.js | 608 |
| server/tests/converter-groups.test.ts | 591 |
| server/tests/converter.test.ts | 582 |
| server/src/convert/pdfInspect.ts | 574 |
| server/src/processors/archive.ts | 564 |
| src/lib/liveState.js | 561 |
| server/src/convert/quality.ts | 542 |
| src/api/client.js | 533 |
| server/tests/workspace-persist.test.ts | 515 |
| server/tests/api.test.ts | 513 |
| server/tests/workers.test.ts | 504 |
| server/tests/job-delete-history.test.ts | 498 |
| server/src/services/upload-session.ts | 494 |
| server/tests/pdf-jobs-reliability.test.ts | 491 |
| scripts/maint/tests/maint-core.test.mjs | 484 |
| server/src/convert/matrix.ts | 481 |

The single largest file (src/styles.css, 5421 LOC) is more than twice the size of the largest code file (server/src/workers/jobs.ts, 2442 LOC). Eight of the top 30 are test files.

## 2. Churn

Command: `git log --format=format: --name-only | sort | uniq -c | sort -rn | head -40` (verbatim; first line is the blank-name entry produced by the empty `--format` separator lines):

```
    100 
     25 docs/stabilize/STATE.md
     24 .ux-ui-redesign-state.json
     15 src/styles.css
     12 package.json
     10 src/views/PdfView.jsx
      9 server/src/workers/jobs.ts
      8 docs/stabilize/FINAL_STABILITY_REPORT.md
      6 src/views/ConverterView.jsx
      6 server/src/capabilities.ts
      6 docs/stabilize/handoffs/CP03-security-job-runtime-platforms.md
      6 docs/BUILD_AND_RUN_WINDOWS_LINUX.md
      5 src/views/SettingsView.jsx
      5 src/views/ModularWorkspaceView.jsx
      5 src/views/ImageView.jsx
      5 src/views/ActivityView.jsx
      5 server/src/processors/converter.ts
      5 server/src/convert/pdfRender.ts
      5 server/src/convert/matrix.ts
      5 server/src/convert/engines/python.ts
      5 scripts/maint/tests/maint-core.test.mjs
      5 python/tests/test_bridge.py
      5 python/operations/__init__.py
      5 package-lock.json
      5 docs/python-runtime.md
      4 src/views/ProfileView.jsx
      4 src/views/MediaView.jsx
      4 src/views/DeveloperView.jsx
      4 src/lib/converterGroups.js
      4 src/hooks/useJobRunner.js
      4 src/components/pdf/PdfPageOrganizer.jsx
      4 src/components/JobOutputCard.jsx
      4 src/components/Common.jsx
      4 server/tests/ui-pdf-struct.test.ts
      4 server/tests/pdf-ops-extended.test.ts
      4 server/src/services/workspace.ts
      4 server/src/routes/workspaces.ts
      4 server/src/processors/media.ts
      4 server/src/processors/index.ts
      4 server/src/pdf/operations/pdf-to-images.ts
```

The highest-churn non-doc, non-state file is src/styles.css (15 commits), followed by package.json (12) and src/views/PdfView.jsx (10).

## 3. Pain points — priority targets for Phases 1–3

Files present in BOTH the top-30 LOC list (Section 1) and the top-40 churn list (Section 2):

| File | LOC | Churn |
|---|---:|---:|
| src/styles.css | 5421 | 15 |
| src/views/PdfView.jsx | 689 | 10 |
| server/src/workers/jobs.ts | 2442 | 9 |
| src/views/ConverterView.jsx | 1972 | 6 |
| server/src/processors/converter.ts | 679 | 5 |
| server/src/convert/matrix.ts | 481 | 5 |
| scripts/maint/tests/maint-core.test.mjs | 484 | 5 |
| server/src/services/workspace.ts | 1063 | 4 |
| server/src/processors/media.ts | 627 | 4 |
| src/lib/converterGroups.js | 608 | 4 |

Near-miss (data point, not in table): server/src/capabilities.ts has churn 6 and 453 LOC, ranking 33rd by LOC (just below the top-30 cutoff). These 10 files are the priority targets for Phases 1–3, combining the largest size with the most frequent modification.

## 4. Dependencies

### 4a. Counts

| Manifest | Prod | Dev | Total |
|---|---:|---:|---:|
| package.json (root; workspaces: ["server"]) | 3 (pdfjs-dist, react, react-dom) | 3 (@playwright/test, concurrently, vite) | 6 |
| server/package.json (alphastudio-server) | 18 (@fastify/cors, @fastify/multipart, @fastify/static, @fastify/websocket, @pdf-lib/fontkit, archiver, better-sqlite3, dotenv, extract-zip, fastify, jsqr, pdf-lib, pino, pino-pretty, qrcode, sharp, tar, uuid) | 7 (@types/archiver, @types/better-sqlite3, @types/node, @types/qrcode, @types/ws, tsx, typescript) | 25 |
| **Grand total** | **21** | **10** | **31** |

### 4b. Outdated

Command: `npm outdated --workspaces --include-workspace-root` (exit 1 = outdated found; ran successfully). Verbatim:

```
Package             Current   Wanted  Latest  Location                         Depended by
@fastify/cors        10.1.0   10.1.0  11.3.0  node_modules/@fastify/cors       server@npm:alphastudio-server@3.6.0
@fastify/multipart    9.4.0    9.4.0  10.1.0  node_modules/@fastify/multipart  server@npm:alphastudio-server@3.6.0
@types/archiver       6.0.4    6.0.4   8.0.0  node_modules/@types/archiver     server@npm:alphastudio-server@3.6.0
@types/node         22.20.1  22.20.1  26.1.1  node_modules/@types/node         server@npm:alphastudio-server@3.6.0
better-sqlite3      12.11.1  12.11.1  13.0.1  node_modules/better-sqlite3      server@npm:alphastudio-server@3.6.0
dotenv               16.6.1   16.6.1  17.4.2  node_modules/dotenv              server@npm:alphastudio-server@3.6.0
pino                 9.14.0   9.14.0  10.3.1  node_modules/pino                server@npm:alphastudio-server@3.6.0
typescript            5.9.3    5.9.3   7.0.2  node_modules/typescript          server@npm:alphastudio-server@3.6.0
uuid                 11.1.1   11.1.1  14.0.1  node_modules/uuid                server@npm:alphastudio-server@3.6.0
```

9 packages outdated (all major-version behind), all in the server workspace; all root dependencies current.

### 4c. Declared-but-never-imported

Detection method (caveat): for each of the 31 declared packages, ran `git grep -lE "(from ['\"]<pkg>|require\(['\"]<pkg>|import ['\"]<pkg>|import\(['\"]<pkg>)"` across all tracked files; zero-hit packages were then re-checked with `git grep -nE "<pkg>"` against package.json scripts and all tracked files (excluding lockfiles) for CLI/config-string usage. This is textual detection only; it cannot see implicit resolution beyond what is noted below.

Import-hit file counts per package (>=1 import/require match): pdfjs-dist=1, react=45, react-dom=1, @playwright/test=6, vite=1, @fastify/cors=1, @fastify/multipart=1, @fastify/static=1, @fastify/websocket=1, @pdf-lib/fontkit=1, archiver=6, better-sqlite3=4, dotenv=1, extract-zip=1, fastify=10, jsqr=1, pdf-lib=31, pino=1, qrcode=1, sharp=17, tar=3, uuid=3.

ZERO hits anywhere (imports, scripts, config strings):

- **@types/ws** (server dev) — no `import ... from 'ws'` / `require('ws')` anywhere in tracked code; the only tracked-text matches for "ws" are unrelated substrings (screenshot filenames, test file paths). `ws` appears only as a transitive dependency of @fastify/websocket.

Used ONLY via scripts/config strings (no import/require, but referenced):

| Package | Where referenced |
|---|---|
| concurrently (root dev) | package.json:12 `"dev": "concurrently -k --kill-others-on-fail ..."` |
| tsx (server dev) | `node --import tsx` in package.json:21,44 and server/package.json:7,10 |
| typescript (server dev) | `tsc -p ...` in package.json:18 and server/package.json:8 |
| pino-pretty (server prod) | string transport target at server/src/lib/logger.ts:23 `target: 'pino-pretty'`; allowlisted in scripts/maint/deps.mjs:26-27,45 |

Used only as type packages resolved implicitly by tsc (no textual reference expected, counted as used): @types/archiver, @types/better-sqlite3, @types/node, @types/qrcode — each matches an imported runtime package (archiver, better-sqlite3, node builtins, qrcode), unlike @types/ws.

Of 31 declared packages, exactly one (@types/ws) has no detectable usage of any kind.

## 5. TODO / FIXME / HACK / XXX

Command: `git grep -nE '\b(TODO|FIXME|HACK|XXX)\b' -- ':!package-lock.json' ':!*.lock'`

Text hits (2, both [non-code]):

- mcps/codegraph/tools/codegraph_design_gaps.json:3 — "...or building a TODO list from an architecture spec." [non-code — tool description string]
- mcps/codegraph/tools/codegraph_search_by_pattern.json:22 — "Regex pattern to search for (e.g. 'unwrap\\(\\)', 'TODO', 'SELECT .* FROM')" [non-code — tool description string]

Binary-file matches (16, all [non-code] — PNG screenshots where the byte pattern happens to match; not comments):

- docs/ux-ui-redesign/screenshots/after-corrective/archive/375.png
- docs/ux-ui-redesign/screenshots/after-corrective/pdf/1024.png
- docs/ux-ui-redesign/screenshots/after-corrective/qr/375.png
- docs/ux-ui-redesign/screenshots/baseline-corrective/audio/1024.png
- docs/ux-ui-redesign/screenshots/baseline-corrective/dashboard/1024.png
- docs/ux-ui-redesign/screenshots/baseline-corrective/dashboard/1920.png
- docs/ux-ui-redesign/screenshots/baseline-corrective/pdf/1440.png
- docs/ux-ui-redesign/screenshots/baseline-corrective/qr/375.png
- docs/ux-ui-redesign/screenshots/residual-states/archive/empty-1440.png
- docs/ux-ui-redesign/screenshots/residual-states/archive/empty-375.png
- docs/ux-ui-redesign/screenshots/residual-states/media/empty-375.png
- docs/ux-ui-redesign/screenshots/residual-states/media/trim-mode-1440.png
- docs/ux-ui-redesign/screenshots/residual-states/media/trim-mode-375.png
- docs/ux-ui-redesign/screenshots/residual-states/security/password-mode-1440.png
- docs/ux-ui-redesign/screenshots/residual-states/text/compare-mode-375.png
- docs/ux-ui-redesign/screenshots/residual-states/text/empty-768.png

Counts: total hits = 18 (2 text + 16 binary), all [non-code]; per-marker (text): TODO=2, FIXME=0, HACK=0, XXX=0. There are **0** actual code comments containing TODO/FIXME/HACK/XXX in the repository.

## 6. Test inventory

Tests were NOT run; static counts only.

Test files (via `git ls-files`):

| Suite | Pattern | Files |
|---|---|---:|
| server | server/tests/*.test.ts | 90 |
| e2e | e2e/*.spec.js | 5 |
| maint scripts | scripts/maint/tests/*.test.mjs | 3 |
| python | python/tests/test_*.py | 1 |
| **Total** | | **99** |

Test cases (via `git grep -cE '^\s*(it|test)\('` summed; python: `'^\s*def test_'`):

| Suite | Cases |
|---|---:|
| server/tests | 704 |
| e2e | 13 |
| scripts/maint/tests | 36 |
| python/tests | 15 |
| **Total** | **768** |

Coverage: **NOT CONFIGURED** — no c8/nyc/istanbul/coverage tooling found in any package.json or config file. The sole grep hit for "coverage" is vite.config.js:30 (`'**/coverage/**'`), an exclude glob, not a coverage tool.

The suite is heavily server-weighted (704 of 768 cases, 91.7%) with only 13 e2e cases. Coverage is not measured anywhere in the repo.
