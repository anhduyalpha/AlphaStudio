# AUDIT-arch — Architecture & Boundary Audit (AlphaStudio)

> **Phase-0 pain-point files received priority attention in this audit:**
> `src/views/ConverterView.jsx` (1972 LOC), `server/src/workers/jobs.ts` (2442 LOC), `server/src/services/workspace.ts` (1063 LOC), `src/api/client.js` (533 LOC), `server/src/capabilities.ts` (453 LOC), `server/src/tools/registry.ts` (759 LOC) + `scripts/maint/lib/tools-probe.mjs` (699 LOC), `server/src/convert/detect.ts`, `src/views/PdfView.jsx` (689 LOC), `src/hooks/useJobRunner.js` (334 LOC), `src/lib/converterGroups.js` (608 LOC). LOC verified via `wc -l`. All line references below were verified against source during this audit; conflicting investigator claims were re-read and reconciled (noted inline where corrected).

---

## 1. Module/directory dependency map & circular dependencies

### 1.1 Client `src/` adjacency (from import statements)

| From | Imports from | Representative edge |
|---|---|---|
| `main.jsx` | App, styles.css, animations | `src/main.jsx:3-5` |
| `App.jsx` | components, views, data, hooks, api | `src/App.jsx:3-23`; dev-only lazy view `src/App.jsx:25-26` (`import('./views/AssetGalleryView')`) |
| `views/` | components | `src/views/ActivityView.jsx:2-5` |
| `views/` | hooks | `src/views/ArchiveView.jsx:9-10` |
| `views/` | api | `src/views/ArchiveView.jsx:11` |
| `views/` | lib | `src/views/TextView.jsx:17`, `src/views/PdfView.jsx:23`, `src/views/ConverterView.jsx:37,49` |
| `views/` | data | `src/views/DashboardView.jsx:6` |
| `views/` | assets | `src/views/AssetGalleryView.jsx:15`, `src/views/extraToolConfigs.js:1` |
| `components/` | components (intra) | `src/components/Common.jsx:4` (Common → Workbench; Workbench imports only Icon at `src/components/Workbench.jsx:2` — no back-edge) |
| `components/` | assets | `src/components/Icon.jsx:2`, `Brand.jsx:2`, `EmptyState.jsx:2`, `FilePicker.jsx:3` |
| `components/` | lib | `src/components/JobOutputCard.jsx:5,7`, `archive/ArchiveTree.jsx:3`, `pdf/PdfPageOrganizer.jsx:14`, `results/JobResultBody.jsx:8` |
| `components/` | api | `src/components/JobOutputCard.jsx:2`, `results/JobResultBody.jsx:2` |
| `components/` | hooks | `src/components/AgentFanOut.jsx:3`, `results/JobResultBody.jsx:9` |
| `hooks/` | api | `src/hooks/useCapabilities.js:2`, `useJobRunner.js:2`, `useWorkspace.js:2`, `useWorkspaceEvents.js:2` |
| `hooks/` | lib | `src/hooks/useJobPreviewUrl.js:3` |
| `api/` | lib | `src/api/client.js:1` (`computeUploadMetrics` from `../lib/liveState.js`); intra-api `src/api/client.js:2` |
| `data/` | assets | `src/data/tools.js:1` |
| `lib/` | (nothing internal) | only external dep: `src/lib/pdfPreview.js:1` (`pdfjs-dist`) |
| `assets/` | (nothing) | `src/assets/registry.js` has no relative imports |
| `animations/` | CSS-only siblings | `src/animations/index.css:4-10` |

Client layering is a strict DAG: views → components → hooks → api → lib → (leaf); assets and data are leaves except data→assets. No lib file imports views/components; api imports only lib.

**Orphans (verified by grep this audit):** `src/views/ModularWorkspaceView.jsx` and `src/views/extraToolConfigs.js` are imported by nothing in `src/` — a grep for both names across `src/` matched only `ModularWorkspaceView`'s own definition at `src/views/ModularWorkspaceView.jsx:29`; `src/App.jsx:29-45` `viewMap` excludes both. They are pinned only by server structural tests (`server/tests/ui-capability-honesty-struct.test.ts:12-14`).

### 1.2 Server `server/src/` adjacency (from 419 relative-import lines)

| From | Imports from | Representative edge |
|---|---|---|
| `index.ts` | config, lib, db, capabilities, app, workers, services | `server/src/index.ts:1-16` |
| `app.ts` | config, lib, routes (9 modules), workers, services | `server/src/app.ts:9-23` |
| `capabilities.ts` | lib, tools, convert/engines | `server/src/capabilities.ts:2-12` |
| `config.ts` | (no relative imports) | `server/src/config.ts:1-4` |
| `routes/` | db | `server/src/routes/activity.ts:2` |
| `routes/` | lib | `server/src/routes/jobs.ts:14-15` |
| `routes/` | convert | `server/src/routes/inspect.ts:4-11`, `system.ts:5` |
| `routes/` | workers | `server/src/routes/jobs.ts:13`, `system.ts:4` |
| `routes/` | pdf | `server/src/routes/jobs.ts:16`, `system.ts:6`, `workspaces.ts:15` |
| `routes/` | services | `server/src/routes/uploads.ts:14`, `upload-sessions.ts:13`, `workspaces.ts:34` |
| `routes/` | config, capabilities | `server/src/routes/system.ts:2-3` |
| `services/` | config, db, lib | `server/src/services/job-deletion.ts:3-5` |
| `services/` | convert, security | `server/src/services/workspace.ts:22-23` |
| `services/` | services (intra) | `server/src/services/upload-session.ts:18` |
| `workers/` | processors | `server/src/workers/ipc.ts:1`, `jobs.ts:28-29`, `worker-process.ts:4-5` |
| `workers/` | services | `server/src/workers/jobs.ts:27` (`deleteTerminalJob`) — one-way; services never import workers |
| `workers/` | db, lib, config | `server/src/workers/jobs.ts:24-26` |
| `workers/` | convert | `server/src/workers/jobs.ts:30-31` |
| `workers/` | pdf | `server/src/workers/jobs.ts:38-43` |
| `processors/` | lib, config, security | `server/src/processors/archive.ts:10-15` |
| `processors/` | capabilities | `server/src/processors/index.ts:2`, `archive.ts:13`, `media.ts:4` |
| `processors/` | convert | `server/src/processors/converter.ts:7-22`, `index.ts:4`, `pyop.ts:6` |
| `processors/` | pdf | `server/src/processors/pdf.ts:9-13` (getPdfOperation, PDF_OPERATION_DESCRIPTORS, normalizePdfOptions, ProgressTracker, pdfError/throwIfCancelled), re-export at `:17` |
| `convert/` | lib, tools, config | `server/src/convert/detect.ts:4-9`, `office.ts:7-10` |
| `convert/engines/` | tools, config, lib, convert parent | `server/src/convert/engines/calibre.ts:4-8`, `registry.ts:2-3` |
| `convert/` | db (dynamic) | `server/src/convert/detect.ts:308` (`await import('../db/index.js')` inside try/catch `:305-313`) |
| `pdf/` | lib | `server/src/pdf/errors.ts:5-6` |
| `pdf/` | convert | `server/src/pdf/load.ts:6`, `operation-options.ts:6`, `save.ts:7` |
| `pdf/` | processors (type-only) | `server/src/pdf/types.ts:1` (`import type { ProcessContext, ProcessResult } from '../processors/types.js'`), `save.ts:9` |
| `pdf/operations/` | lib, convert, tools | `server/src/pdf/operations/ocr.ts:6-13` |
| `pdf/index.ts` | pdf/operations (dynamic) | `server/src/pdf/index.ts:24-52` (lazy loader table) |
| `db/` | config, lib | `server/src/db/index.ts:4-5`, `migrations.ts:2` |
| `lib/` | config | `server/src/lib/cors-origin.ts:1`, `logger.ts:2`, `paths.ts:4` |
| `security/` | lib, config | `server/src/security/validation.ts:3-6` |
| `tools/` | (no relative imports) | `server/src/tools/registry.ts:1-4`, `optional-binaries.ts:5-7` |

**Client↔server source:** no client file imports server code and vice versa (grep for `server` specifiers in `src/` and `/src/` in `server/src/` matched only comments: `server/src/app.ts:39`, `processors/pdf.ts:3`, `tools/registry.ts:7`). `vite.config.js` defines no aliases. Cross-tree references exist only in `server/tests/` — 14 test files directly ESM-import `src/lib/*` (e.g. `server/tests/archive-tree.test.ts:3`, `job-result-kind.test.ts:7`, `media-job-options.test.ts:7`, `pdf-webui-options.test.ts:11`) and ~30 `ui-*-struct` tests pin client files by reading their source text (e.g. `server/tests/ui-capability-honesty-struct.test.ts:12-14`, `release-regressions.test.ts:14-64`, `rate-limit-absent.test.ts:16,23`).

### 1.3 Circular dependencies

- **Directory level: exactly one two-directory cycle** — `processors ↔ pdf`. Forward: `server/src/processors/pdf.ts:9-13` imports five `../pdf/*` modules. Backward: `server/src/pdf/types.ts:1` and `server/src/pdf/save.ts:9` import `import type { ProcessContext, ProcessResult } from '../processors/types.js'` (type-only; verified by read this audit). No file-level cycle results because `server/src/processors/types.ts` has zero imports.
- **File level: none found.** Method: (a) enumeration of all relative-import lines via grep over `src/` (`*.js`,`*.jsx`) and `server/src/` (`*.ts`) — 419 server + ~200 client lines; (b) a Tarjan-SCC script run inline via node stdin (no files written) parsing static `import`/`export … from`, dynamic `import()`, and `require()` specifiers (including the `?url` suffix at `src/lib/pdfPreview.js:1`), resolving `.js→.ts`, extensionless, and `/index.*` candidates. Result: 157 files, 633 resolved internal edges, 0 SCCs of size >1, 0 self-loops. Dynamic edges (`server/src/pdf/index.ts:24-52`, `server/src/convert/detect.ts:308`) were included.

---

## 2. Business logic vs UI layer

An extraction layer exists and is consumed (`src/api/client.js`, `src/api/resumableUpload.js`, `src/hooks/useJobRunner.js` — used by 10 views: ArchiveView.jsx:24, AudioView.jsx:44, ColorView.jsx:39, ImageView.jsx:34, MediaView.jsx:46, ModularWorkspaceView.jsx:37, PdfView.jsx:112, QrView.jsx:103, SecurityView.jsx:26, TextView.jsx:37 — count verified by grep this audit; one investigator report said 11, actual is 10 — plus `src/hooks/useWorkspace.js`, `useWorkspaceEvents.js`, `useCapabilities.js`, `useJobPreviewUrl.js`, and 11 `src/lib/*` modules). Alongside it, substantial protocol/business logic is embedded directly in component bodies.

### 2.1 Worst offenders (logic LOC / total LOC)

**`src/views/ConverterView.jsx` — 1972 LOC, ~1000 LOC (~50%) non-presentation logic; largest concentration in the frontend.** Inside the component body:
- 114-166 — SSE event application, terminal-status detection, authoritative-refresh orchestration (ref/state dual-write, `terminalRefreshPendingRef` dedupe).
- 168-188 — SSE reconnect snapshot merge.
- 198-223 — hydrate-once orchestration (job→file linking, toolSettings/ui restore, active-job map).
- 227-263 — resumable-upload session recovery protocol (`listUploadSessions` → `pauseUploadSession`/`getUploadSession`, progress math at 248).
- 354-389 — workspace PATCH payload construction incl. legacy single-format compatibility fields (367-372).
- 392-464 — hand-rolled 500 ms job polling loop (`api.getJob` at 403, `setInterval(tick, 500)` at 458 — verified this audit), progress reflection via `options._uploadIds` (410-426), terminal handling + full workspace refresh (427-451). Parallel to `api.waitForJob` (`src/api/client.js:285-301`) and `useJobRunner`.
- 468-477 — stuck-busy-state release heuristic.
- 483-666 — `uploadOne`: full upload protocol — optimistic rows, XHR-vs-resumable branch at 8 MB (552-575), progress-metric normalization (523-550), post-upload `inspect` + `waitForFileReady` polling with timestamp-regression guard (601-639), PAUSED/CANCELLED code handling (643-648).
- 668-700 — pause/restart/cancel upload controller management.
- 707-744 — `startUploads`: manual worker-pool concurrency limiter (cursor loop 716-724).
- 762-840 — `queueConvertJob`: submit-guard keys, duplicate detection, job payload construction (794-807; `api.createJob` at 794 verified), optimistic status writes.
- 842-922 — group/selected/all convert flows with plan inference (880-884).
- 924-959 — `cancelGroupJobs`.
- 1008-1041 — result-row assembly memos.
- 1052-1094 — download orchestration (single-vs-ZIP branch, 1084-1087).
- 1100-1201 — `clearCompleted`/`removeResultRow` persistence + `retryFailed` job-payload reconstruction from prior options (1165-1185; second `api.createJob` at 1175 verified).
- 1848-1877 — `FileInputCard` status-classification ladder.
- 1954-1959, 1962-1972 — module-local `formatBytes` and `unsupportedFileMessage`.
Pure grouping/planning math is delegated to `src/lib/converterGroups.js` and `src/lib/liveState.js`; every protocol concern (SSE application, polling, upload chunk control, retry, dedupe, persistence payloads) is in the component.

**`src/components/pdf/PdfPageOrganizer.jsx` — 420 LOC, ~250 LOC (~60%) logic:** PDF.js document lifecycle with byte/page-count gates and generation-counter invalidation (84-167, gates at 104 and 140-147); thumbnail render engine with bounded worker pool, render-task cancellation registry, canvas→JPEG data-URL conversion (184-254, conversion at 220); edit-plan derivation and reorder move algorithm (257-311, 1-based conversion at 276). Constants/pdfjs init are in `src/lib/pdfPreview.js`; the engine is in the component.

**`src/components/QrPasteModal.jsx` — 421 LOC, ~200 LOC (~48%) logic:** phase state machine (59-65); clipboard ingestion protocol — paste-item scanning (147-155), async Clipboard API read with permission-error mapping (192-196); hand-rolled focus trap + Tab wrap + Escape (100-179); file-input/drop MIME validation (202-227).

**`src/views/PdfView.jsx` — 689 LOC, ~215 LOC (~31%) logic:** module-scope operation catalog `GROUPS`/`ALL_OPS` with capability ids/engine strings/cardinality (26-76); `expectedEngine` capability→engine resolution (78-83); completion side-effect with once-per-job guard (123-135); 16-field form reset fan-out (138-157); capability-contract interpretation merging backend descriptors into UI op metadata (161-189); engine-label precedence chain (191-197); `jobSummary` per-operation option semantics (211-245). Heavy option building/validation IS extracted (`src/lib/pdfJobOptions.js:56-238`, called from `start` at 247-291).

**`src/views/QrView.jsx` — 642 LOC, ~150 LOC (~23%) logic:** module-level `detectContentType` (URL/mailto/tel/WIFI/VCARD/sms regex classification, 26-42) and `isSafeHttpUrl` (44-51); object-URL lifecycle via ref mirrors (111-136); `generate` inline job payload + `fetchJobBlob`→object-URL preview (157-193, payload 164-176, preview 180-184 — re-implements `src/hooks/useJobPreviewUrl.js`); regenerate-per-format download (195-201); `decode` inline payload + result interpretation (221-247, `data.text || JSON.stringify(data)` at 236).

**`src/views/ArchiveView.jsx` — 172 LOC, ~47 LOC (~27%) logic:** capability-key ternary chain (28); `start` with inline payload (44-46), `fetchJobText`→`JSON.parse`→shape fallback `parsed.entries || parsed.files || parsed.contents` (53), and a recursive `walk` flattener for arbitrary JSON shapes (56-68) — response-format normalization inside the view.

**`src/views/SettingsView.jsx` — 193 LOC, ~50 LOC (~26%) logic:** `applyTheme` direct DOM dataset mutation + localStorage write + custom event dispatch (42-52); dirty-diff vs baseline (54-56) and save flow deriving persisted `animations` flag from motion mode (58-81, derivation 63-66).

**`src/views/ActivityView.jsx` — 172 LOC, ~45 LOC (~26%) logic:** optimistic delete with rollback, in-flight dedupe ref, conditional full reload on cascading job delete (49-77, cascade at 69).

**`src/views/DeveloperView.jsx` — 186 LOC, ~45 LOC (~24%) logic:** `UTIL_MAP` operation/payload catalog (9-18); `runUtility` bypasses `useJobRunner` — direct `api.runJob` with inline option assembly (32-65, options 38-45), output-shape interpretation (`parsed.digest` / `parsed.uuids`, 50-53).

**`src/views/ModularWorkspaceView.jsx` — 238 LOC, ~55 LOC (~23%) logic (orphaned, see §1.1):** `resolveJob` feature→job-type/capability mapping (21-27); `start` with inline hex-checksum regex (72-77), extract-mode format override (78-79), layered option-merge payload (83-95).

**`src/views/ColorView.jsx` — 265 LOC, ~55 LOC (~21%) orchestration (math in lib):** identical `extractPaletteFromFile` orchestration written twice inside the component — effect (52-70) and button handler (232-240); inline image-job payload (72-86).

**`src/views/SecurityView.jsx` — 182 LOC, ~35 LOC (~19%) logic:** inline hex digest regex `/^[a-fA-F0-9]{32,128}$/` (43); per-mode option construction (49-60).

**`src/components/results/JobResultBody.jsx` — 289 LOC, ~60 LOC logic:** `JsonBody` (208-250) and `TextLoader` (266-279) fetch+parse job payloads inside render components; `ArchiveListingResult` inline entry-shape normalization (149-170: `data.entries || data.files || data.contents`, `e.name || e.path || e.entry`).

**`src/components/JobOutputCard.jsx` — 132 LOC:** MIME/kind→title-hint ladder inline (19-42, JPEG/PNG regex at 38); download/delete orchestration (44-69).

**`src/components/CommandPalette.jsx` — 155 LOC:** second hand-rolled focus trap + roving keyboard nav (24-100); `getFocusable` selector string at 37-39 is identical to `QrPasteModal.jsx:109-111`.

### 2.2 Thin views (extraction actually used)

AudioView.jsx (79-107 delegates to `buildMediaJobOptions` + `useJobRunner`; only media-element metadata handlers 66-77 inline); MediaView.jsx (81-107; only format-defaulting effect 65-71 inline); ImageView.jsx (70-96 delegates to `buildCropJobOptions`/`clampCropRect`; only natural-size probe 39-53 inline); TextView.jsx (diff/stats via lib; inline `applyCase` 45-50 and inline payload 81-89); ArchiveTree.jsx component (50-53 delegates to `lib/archiveTree.js`).

### 2.3 Views bypassing the extraction layer

ConverterView.jsx uses none of `useJobRunner`/`api.runJob` (own upload/poll/create/cancel stack, §2.1); DeveloperView.jsx uses direct `api.runJob` (36); DashboardView.jsx (26-49) and ActivityView.jsx (15-77) do direct `api.*` orchestration with no shared data hook.

---

## 3. Module boundaries: bypassed vs not bypassed

### 3.1 Not bypassed (interface holds as of this audit)

- **Worker IPC / ProcessContext boundary** — the cleanest typed seam. `ProcessContext`/`ProcessResult`/`Processor` at `server/src/processors/types.ts:3-26`; dispatch only via `getProcessor(type)` (`server/src/processors/index.ts:11-25,93-101`); the API process never calls processors directly (only `assertJobCapable`, `workers/jobs.ts:28,316`); execution crosses a versioned typed IPC protocol with runtime guards both directions (`server/src/workers/ipc.ts:4-131`, guards at 99-131); worker-side payload/path validation (`worker-process.ts:65-99`), output confinement worker-side (`worker-process.ts:112-122`) and API-side (`workers/jobs.ts:1673-1678`). Grep for `getProcessor` shows only `processors/index.ts` and `worker-process.ts:4,161`.
- **PDF operation contract** — `PDF_OPERATION_DESCRIPTORS` (`server/src/pdf/operation-contract.ts:39-184`, self-declared "Authoritative public contract" at 1-7) consumed by create-gate (`workers/jobs.ts:334-347` — verified `processors/pdf.ts:21-31` enforces descriptor lookup + cardinality), and published verbatim at `/api/capabilities` (`routes/system.ts:6,48-50`). No route calls `getPdfOperation` directly.
- **SQLite connection ownership** — only `server/src/db/index.ts:1` imports `better-sqlite3` at runtime (`migrations.ts:1` is type-only); single connection enforced (`db/index.ts:9-10,129-133`); second instance only inside `repairDb` in the same file (`db/index.ts:327`).
- **Frontend HTTP transport** — grep `fetch(` across `src/` hits only `src/api/client.js` (7 hits); `XMLHttpRequest` only in `client.js` and `resumableUpload.js:30` (which receives `request/apiUrl/apiToken` injected from `client.js:108-110`); zero `new WebSocket` in client (server WS endpoint `routes/jobs.ts:139` has no client consumer). URL-scheme knowledge leaks once: `src/lib/converterGroups.js:329` builds a raw `/api/outputs/${id}/download` path, though transport still goes through `api.downloadPath` (`src/views/ConverterView.jsx:1061`).
- **Capability gating enforcement** — server enforces at job-create via `assertJobCapable` → `isToolAvailable` (`processors/index.ts:103-114`, `capabilities.ts:439-445` — verified), so client-side gating cannot bypass server truth. Client consumption is via one hook (`src/hooks/useCapabilities.js:16,41-50`), used by 7 views; ImageView/QrView/ColorView/ConverterView do not consult it at all (grep: absent).

### 3.2 Bypassed (with evidence)

- **Job-engine API surface (`workers/jobs.ts` exports) bypassed via raw SQL:**
  - `server/src/routes/activity.ts:59-64` — `/api/stats` runs `SELECT COUNT(*) as c FROM jobs` (and status-filtered variants) directly against the jobs table (verified this audit).
  - `server/src/services/workspace.ts:818-830` — `hardPurgeWorkspace` deletes job rows with raw `DELETE FROM jobs WHERE id = ?` at `:830` plus `DELETE FROM job_files` at `:829` (verified), bypassing both `deleteJob` (`workers/jobs.ts:458-472`) and `services/job-deletion.ts:151`.
  - The engine itself contains a third copy: `workers/jobs.ts:2340-2357` (`orphanFileGc`), `DELETE FROM jobs WHERE id = ?` at `:2356` (verified).
- **Reverse leak: generic job engine imports PDF-module internals for all job types** — `extractPassword`/`redactSensitiveOptions` from `../pdf/operation-options.js` (`workers/jobs.ts:35-38`, used at 295-296, 589-594), `pdfError` (`:39`, used at 1227), `PDF_MAX_INPUT_FILES`/`PDF_OPERATION_DESCRIPTORS` (`:40-43`, used at 336, 1419); `routes/jobs.ts:16` and `routes/workspaces.ts:15` import `contentDispositionAttachment` from `pdf/output-names.js` for non-PDF downloads.
- **Routes reach converter internals directly** — `server/src/routes/inspect.ts:4-11` (convert/detect, matrix, engines, formats); `routes/system.ts:5-6` (engine snapshot, pdf/operation-contract).
- **`convert` reaches into `db`** — `server/src/convert/detect.ts:308` dynamic `import('../db/index.js')` for the detect cache (verified; wrapped in try/catch 305-313). All other db importers are routes/services/workers/index.
- **SQL ownership does not hold** — `db/index.ts` exposes raw `getDb()` (`db/index.ts:124-127`); raw `.prepare(` counts elsewhere: `workers/jobs.ts` 41, `services/workspace.ts` 53, `services/upload-session.ts` 20, `routes/activity.ts` 8, `services/job-deletion.ts` 6, `routes/profile.ts` 4, `routes/settings.ts` 3, `routes/inspect.ts` 3 (`inspect.ts:31-32,43,60`), `routes/uploads.ts` 1 (`uploads.ts:91-92`), `convert/detect.ts` 1. Centralized helpers (`dbGetJob/dbGetFile/dbUpdateJobProgress`, caches, `db/index.ts:245-379`) are a small fraction of total SQL. Out-of-band openers: `scripts/maint/doctor.mjs:116-117` opens the DB directly; `scripts/maint/db-repair.mjs:32-57` carries standalone fallback DDL whose `job_result_cache` (`db-repair.mjs:49-55`) lacks the `result_json` column that server SQL uses (`db/index.ts:95-104`); server heals via `ALTER TABLE` (`db/migrations.ts:64-71`).
- **Engine adapter contract does not cover execution** — `ConversionEngineAdapter` (`server/src/convert/engines/types.ts:46-60`) has probe/discovery only, no execute method; all 8 engines conform for discovery and register via `ConversionEngineRegistry` (`registry.ts:18-115`, `engines/index.ts:15-26`). Execution dispatch is a string-keyed table on `route.engineId` in `processors/converter.ts:224-267` covering only pandoc/calibre/libreoffice/python; other families use hardcoded branches ignoring the route object except as metadata — image via sharp/pdf-lib inline (`converter.ts:311-348`), media via `processMedia` (`converter.ts:350-379`; ffmpeg invoked directly in `processors/media.ts:60-76` using `detectCapabilities().binaries`, not the ffmpeg adapter), archives via `processArchive` (`converter.ts:381-427`), PDF via `convertPdfFamily` (`converter.ts:452-454,523-598`). LibreOffice execution lives in `convert/office.ts` (imported at `converter.ts:17`), not in `engines/libreoffice.ts` (probe-only, 25-37).
- **Client job-loop ownership bypassed** — `src/views/ConverterView.jsx` runs a full parallel job loop (direct `api.createJob` at 794 and 1175, custom poll loop 392-464, own cancel paths 939/1812, own submit guard + `hasActiveDuplicateJob` 772-787) and writes the server-internal options field `_uploadIds` client-side (`ConverterView.jsx:803`) mirroring `workers/jobs.ts:321`; `src/views/DeveloperView.jsx:36-48` uses direct `api.runJob` + `fetchJobText`.
- **Untyped side-band data across the ProcessContext boundary** — `ProcessContext.options` is `Record<string, unknown>` (`processors/types.ts:7`); crossing untyped: `_uploadIds` (written `workers/jobs.ts:321-323`, read back 171-185), `clientRequestId`/`dedupeKey` mirrored into options (309-314), vaulted password re-injected (1461-1465), `_detectByPath` (`workers/jobs.ts:1453-1465` → `processors/converter.ts:179-182`), `_detect`/`detectMeta` (`converter.ts:68-69,185`), an entire `EngineRoute` object as `_engineRoute` (`converter.ts:333,361,374` → `processors/media.ts:598-601`); `route.metadata?.operation` plucked untyped at `converter.ts:261` (`EngineRouteMetadata` has `[key: string]: unknown`, `engines/types.ts:22`).
- **Misc cross-module facts:** `services/workspace.ts:1054` re-exports `streamChecksum, quickFingerprint` from `../lib/fingerprint.js`; `pdf/operation-options.ts`'s `redactSensitiveOptions` is the de-facto global secret-redaction utility for all job types (`workers/jobs.ts:35-38,296,589`); `capabilities.ts:450` uses CommonJS `require('./lib/errors.js')` inside an otherwise-ESM module (verified this audit); `processors/index.ts:116` re-exports the whole types module.

---

## 4. Single responsibilities implemented in more than one place

### 4.1 Upload→createJob→waitForJob pipeline — 3 client implementations
- `src/api/client.js:303-342` `api.runJob()` (upload loop 317-323, createJob 326-329). Sole consumer: `src/views/DeveloperView.jsx:36`.
- `src/hooks/useJobRunner.js:211-318` `run()` (upload 231-248, createJob 250-259, waitForJob 266-274) — 10 views.
- `src/views/ConverterView.jsx` — own stack (`uploadOne` 483-609, createJob 794/1175, poll loop 392-464).
- Drift: `runJob` has no progress banding; `useJobRunner.run` maps upload→0-30% and job→30-99% (`useJobRunner.js:239,270`); ConverterView shows raw server progress (`ConverterView.jsx:1774,1793`). Inside `useJobRunner` itself, resume (`applyJobUpdate`, `useJobRunner.js:54-57`) uses raw 0-99 while `run()` uses `30 + p*0.7` (`:270`) for the same job progress.

### 4.2 Upload transports — copied XHR wiring
- XHR open/auth/responseType/onprogress/onload/onerror/onabort/error-body parse duplicated: `src/api/client.js:204-248` vs `src/api/resumableUpload.js:27-54`; ApiError construction from `xhr.response.error` verbatim: `client.js:231-238` vs `resumableUpload.js:41-47`.
- Drift: multipart abort → code `ABORTED` (`client.js:226,244`); resumable abort → `PAUSED` (`resumableUpload.js:50`).
- Progress metrics computed three ways: `computeUploadMetrics` (`src/lib/liveState.js:404-418`, used by `client.js:213`); inline re-implementation with different speed semantics (`resumableUpload.js:164-175`); percent from `session.receivedBytes` (`ConverterView.jsx:248`).

### 4.3 SSE — 3 client implementations + reconnect in a 4th place; 2 server handlers + WS
- Client: `subscribeWorkspaceEvents` (`src/api/client.js:119-170`), `subscribeViaFetch` with hand-rolled `data:` frame parser (`client.js:451-505`, parser 482-492), `waitViaSse` (`client.js:416-449`). Reconnect/backoff exists only in `src/hooks/useWorkspaceEvents.js:23-77` (1s→15s). Drift: workspace subscribe has a token fetch-SSE fallback (`client.js:127-134`); `waitForJob` skips SSE entirely when `API_TOKEN` is set and polls (`client.js:287`).
- Server: SSE handler (CORS check, headers, `reply.hijack()`, `data:` framing) duplicated in `server/src/routes/jobs.ts:96-135` and `routes/workspaces.ts:171-223`. Drift: workspace handler has a 25s keepalive (`workspaces.ts:208-215`) and try/catch around writes (189-195); jobs handler has neither (`jobs.ts:114-116`). Jobs adds a WebSocket variant of the same fan-out (`jobs.ts:139-160`).

### 4.4 Duplicate-job detection — client vs server disagree
- Client `hasActiveDuplicateJob` (`src/lib/converterGroups.js:413-429`): key = sorted uploadIds + format only.
- Server `findActiveDuplicateJob` (`server/src/workers/jobs.ts:191-260`): workspace-scoped SQL + sorted uploads + full normalized options JSON + `dedupeKey`/`clientRequestId` (218-228). The two disagree on what counts as a duplicate (client ignores quality/preserveMetadata/other options).

### 4.5 Format/extension/MIME classification — 7 server + 4 client copies
- Canonical: `server/src/convert/formats.ts:21-99` (`DEFINITIONS` + accessors 109-146).
- (2) `server/src/convert/detect.ts:25-92` `EXT_FAMILY` + `:94-153` `MIME_TO_FORMAT`; `detect.ts:625-630` `mimeFromKind` reverse-scans `MIME_TO_FORMAT` instead of using `formatMime`.
- (3) `server/src/processors/converter.ts:647-679` `mimeFromName` — missing `.heic/.tiff/.odt/.ods/.odp/.epub/.opus/.wma/.mov/.avi` present in formats.ts; includes `.parquet`.
- (4) `server/src/security/validation.ts:8-66` `EXT_MIME` — with variants absent elsewhere (`image/x-ms-bmp`, `audio/mp3`, `application/x-zip-compressed`).
- (5) `server/src/processors/image.ts:15-25` `FORMAT_MIME` (image-only; lacks heic/heif/svg).
- (6) `server/src/processors/security.ts:171-180` `mimeMap`.
- (7) `server/src/workers/jobs.ts:90-94` `IMAGE_FORMATS`/`MEDIA_FORMATS`/`OFFICE_FORMATS` for `classifyJobCategory` (136-163). Drift: `MEDIA_FORMATS` (91) omits `wma, mpeg, mpg, wmv, m4v, flv` (all in `detect.ts:46,52-56`); `IMAGE_FORMATS` (90) omits `heif, ico` (`detect.ts:35,38`) — such jobs classify as `general` instead of `media`/`image`.
- Client: `src/lib/converterGroups.js:197-217` `engineForFamily` (no `ebook` case; `document→LibreOffice` even when server routes pandoc/calibre); three different image-extension lists — `src/lib/pdfJobOptions.js:84` (`png|jpe?g|webp|tiff?|gif|bmp`), `src/lib/jobResultKind.js:18` (`png|jpe?g|webp|gif|avif|bmp|tiff?|ico`), server `EXT_FAMILY`; previewability decided twice with conflicting answers — `converterGroups.js:379-386` says PDF previewable, `jobResultKind.js:29` classifies PDF as `binary`; accept-list strings duplicated with drift — audio `'audio/*,.mp3,.wav,.flac,.ogg,.m4a,.aac'` verbatim at `src/views/AudioView.jsx:146` and `src/views/extraToolConfigs.js:70` (both omit `.opus/.wma`, accepted per `formats.ts:39-40`); text accept at `TextView.jsx:157` and `extraToolConfigs.js:43`; archive accept `ArchiveView.jsx:102` vs `extraToolConfigs.js:17` (`*/*`), both omitting `.bz2/.xz` (`detect.ts:74-75`).

### 4.6 Audio quality preset tables — client copy with alias drift
- Server: `server/src/convert/quality.ts:344-379` `AUDIO_TABLE` + alias map with `max→'high'` at `quality.ts:29` (verified this audit).
- Client: `src/lib/mediaJobOptions.js:6-10` same table without aliases; `describeAudioQuality('max')` falls back to **balanced** (`mediaJobOptions.js:12-14`, verified) while server resolves `max`→**high**. `extraToolConfigs.js:78` ships `quality: 'max'`; `ModularWorkspaceView.jsx:180-182` offers presets `balanced|max|small` while all other surfaces use `fast|balanced|high`.
- Media option construction: shared `buildMediaJobOptions` (`mediaJobOptions.js:28-78`, trim omits format/quality for stream-copy 47-58, used by MediaView.jsx:90, AudioView.jsx:88) vs inline generic builder in `ModularWorkspaceView.jsx:81-95` that always sends `quality` and merges `{start:'0',duration:'30'}` for the audio trim feature (`extraToolConfigs.js:74`), contradicting the stream-copy contract.

### 4.7 Orphaned parallel tool implementations
`src/views/ModularWorkspaceView.jsx` + `src/views/extraToolConfigs.js` (config-driven archive/text/audio/color/security tools) vs the routed dedicated views (`src/App.jsx:36-40`). The dedicated views re-encode the configs' content: `ArchiveView.jsx:14-17,28` re-encodes mode→capability mapping present in `extraToolConfigs.js:20-25`; `SecurityView.jsx:51-53` re-encodes `['md5','sha1','sha256','sha512']` from `extraToolConfigs.js:178`; vocal-separation stub messaging exists in `extraToolConfigs.js:77` and server capability `audio.extract-vocals` (`server/src/capabilities.ts:408`, different wording), with `clientOnly:true` short-circuiting before server truth (`ModularWorkspaceView.jsx:57-60`).

### 4.8 Capability/contract knowledge maintained on both sides
- PDF op-id union maintained twice server-side (`PdfOpId` `server/src/pdf/index.ts:6-21` vs `PdfOperation` `pdf/types.ts:7-22`) parallel to the descriptor id list, plus a third hardcoded client catalog (`src/views/PdfView.jsx:26-76`) used as fallback until `caps?.pdf?.operations` loads (`PdfView.jsx:162-188`).
- Client hardcodes gated-op knowledge: `GATED_OP_IDS = {'to-images','ocr','compress-advanced','repair'}` (`src/lib/pdfJobOptions.js:8` — verified; used at `PdfView.jsx:363`) duplicating `capabilities.ts:240-318`; python-gated `pdf.ocr.searchable` is not in the set (`capabilities.ts:289-296`).
- Dual OCR ids on both sides: server `pdf.ocr.searchable` + `pdf.ocr-searchable` (`capabilities.ts:200-201,288-296`, `convert/engines/python.ts:234`); client probes both (`PdfView.jsx:515-516`).
- Client engine-name strings restate server engine chains (`PdfView.jsx:46-47,62-63` e.g. `'pdftoppm|mutool|ghostscript'` vs `capabilities.ts:258-264,271-277,313-317`).
- Server holds a second availability truth table `BUNDLED_CAPABILITIES` short-circuiting `isToolAvailable` before the published `tools[]` (`capabilities.ts:66-99,440` — verified).
- Endpoint path strings hand-mirrored in `src/api/client.js:78-107,172-187,272-279,345,388,418` and `src/api/resumableUpload.js:31,76,88,116,156,182,195` against Fastify route literals (`server/src/routes/upload-sessions.ts:16-73`, `jobs.ts:19-139`, `workspaces.ts:38-293`); error-code contract checked at `client.js:531-532` vs `server/src/lib/errors.ts:15-22`.

### 4.9 External tool resolution — 5 probe implementations, 3 discovery stacks
- Full parallel resolvers: `server/src/tools/registry.ts` (`resolveTool` 651, `resolveAllTools` 675, `probe` 181-216, precedence configured→project→well-known→PATH 572-643) vs `scripts/maint/lib/tools-probe.mjs` (`resolveTool` 471, `checkAllTools` 587, `TOOL_DEFS` 29-166, `probeExec` 267-301, precedence manifest-cache→system-first→project 473,527-541 — **inverted preference order**).
- Verbatim-duplicated helpers: `siblingFfprobe` (`registry.ts:408` vs `tools-probe.mjs:360`), `siblingFfmpeg` (`registry.ts:421` vs `:373`), `normalizeLibreOfficePath` (`registry.ts:341` vs `:386`), 7zr-avoidance (`registry.ts:257-286,447-450` vs `:395-403`), ffmpeg/ffprobe co-location (`registry.ts:690-708` vs `:603-665`), manifest fast-trust (`registry.ts:465-490,497-561` vs `:507-524` + `scripts/maint/lib/manifest.mjs:167-181` + `checksum.mjs:45-56`).
- Third stack: `scripts/setup-tools.mjs` standalone (`probe` 150-172, `findOnPath` 174-185, `walkFind` 187-205 — lacks the depth guard/skip regex of `tools-probe.mjs:303-332`).
- Fourth: `server/src/tools/optional-binaries.ts` (`whichAll` 38-103, `probeVersion` 105-127).
- Fifth (dead): `detectBinary` in `server/src/capabilities.ts:31-56` — defined, never called.
- Drift: probe timeouts 15000ms (`registry.ts:191,202`) vs 20000ms (`tools-probe.mjs:279`, `setup-tools.mjs:159`) vs 5000ms (`optional-binaries.ts:113`, `capabilities.ts:35,46`); Windows 7z candidate order `['7z.exe','7za.exe','7zz.exe']` (`registry.ts:262`) vs `['7za.exe','7z.exe','7zz.exe','7zr.exe']` (`tools-probe.mjs:128`); well-known paths registry-side cover only calibre (`registry.ts:326-338`) while tools-probe also covers LibreOffice/7-Zip (`tools-probe.mjs:69-80,129-130`); LibreOffice PATH names `['soffice.com','soffice','soffice.exe']` (`registry.ts:605`) vs `['soffice','libreoffice']` (`tools-probe.mjs:62`). `.runtime/config.json` has three writers: `registry.ts:133-179`, `manifest.mjs:156`, `setup-tools.mjs:42` ff. Shared contract is data files only (`.runtime/config.json` + `manifest.json`, `registry.ts:16-17,104-130` / `tools-probe.mjs:21,504-524`); `registry.ts:172-179` notes manifest.json is "owned by maint scripts" while registry writes config.json.
- Two same-named `requireTool` functions with different semantics: capability-id gate throwing via `unavailable()` (`capabilities.ts:447-453` — verified, incl. the CJS `require` at 450) vs tool-name gate hand-building an AppError-shaped plain `Error` (`registry.ts:735-759`), absorbed by duck-typing in `lib/errors.ts:54-64`.

### 4.10 Path confinement — 4 server copies + scripts variant
`server/src/lib/paths.ts:20-27` `safeJoin` (startsWith) and `:42-45` `isPathInside` (path.relative); `server/src/workers/worker-process.ts:57-63` `isInside` (re-implements it in a file already importing `lib/paths.js` at `:6`; adds `relative === '.'` acceptance at 61); `server/src/services/job-deletion.ts:22-25` `isStrictlyInside` (root itself excluded); `scripts/maint/lib/paths.mjs:17-38` `assertUnderRoot` (adds separator normalization + Windows-drive rejection at 23-26 that no server copy has).

### 4.11 Checksums / file-head reading
Chunked sync SHA-256 implemented 3×: `server/src/lib/fingerprint.ts:97-114` `checksumFileChunked`, `server/src/convert/detect.ts:230-247` `checksumFilePath` (identical algorithm), `scripts/maint/lib/checksum.mjs:8-22` `hashFile`. `readFileHead` + `MAGIC_HEAD_BYTES = 4100` exported twice under the same names: `fingerprint.ts:13,19-34` and `detect.ts:23,209-222`.

### 4.12 Retention / purge — 3 job-row purge sites + overlapping sweepers + scripts wipe
- Job-row purge in 3 places (all verified): `services/job-deletion.ts:151`, `services/workspace.ts:829-830`, `workers/jobs.ts:2356`.
- `workspace.ts:790-853` `hardPurgeWorkspace` and `workers/jobs.ts:2275-2360` `orphanFileGc` are near-identical expired-workspace purges: same SQL predicate `status='deleted' AND (last_seen_at < ? OR updated_at < ?)` (`workspace.ts:995-999` vs `jobs.ts:2297-2301`), same active-jobs skip (`workspace.ts:792-802` vs `jobs.ts:2305-2313`), same outputs loop incl. empty-parent rmdir (`workspace.ts:807-816` vs `jobs.ts:2318-2338`). Both run from the same 15-min timer (`server/src/index.ts:43-53`).
- `jobs.ts:2124-2184` `cleanupExpiredFiles` also deletes file/upload rows + disk, coordinated only by comment (`jobs.ts:2163-2169`), with its own protected-path collection (`jobs.ts:2191-2269`).
- `scripts/maint/lib/clear-targets.mjs:103` deletes `data/uploads`, `data/outputs`, `data/temp` wholesale with no DB reconciliation — a third deletion path over the same directories.

### 4.13 PDF option validation mirrored client/server
DPI clamp `Math.max(36, Math.min(600, Math.round(...)))` verbatim in `src/lib/pdfJobOptions.js:201` and `server/src/pdf/operation-options.ts:73-75`. Delete-all-pages guard duplicated with different message text: `pdfJobOptions.js:105-107` ("Cannot delete all pages — the result would be an empty PDF") vs `server/src/pdf/operations/delete-pages.ts:28-31` ("Cannot delete all pages: result would be an empty PDF").

### 4.14 Small utilities duplicated client-side
- `formatBytes` — 4 named copies with differing null-handling/precision: `src/lib/pdfJobOptions.js:241-247` (invalid→`null`, `toFixed(2)`), `src/lib/clipboardImage.js:235-240` (invalid→`'—'`, `toFixed(1)`), `src/views/ConverterView.jsx:1954-1959` (null→`'—'`, no finite check), `src/components/FilePicker.jsx:132-137` (falsy→`''`); plus inline KB math in `ArchiveView.jsx:112`, `AudioView.jsx:155`, `ImageView.jsx:131`, `SecurityView.jsx:95`, `PdfView.jsx:536`, `src/lib/pdfPreview.js:57`.
- `copyText` clipboard helper — 3 lib copies (`src/lib/textDiff.js:107`, `colorPalette.js:157`, `jobResultKind.js:93`) plus raw `navigator.clipboard.writeText` inline in `QrView.jsx:203-219` (two handlers) and `DeveloperView.jsx:115-122`.
- Hex checksum regex `/^[a-fA-F0-9]{32,128}$/` — inline in `SecurityView.jsx:43` and `ModularWorkspaceView.jsx:73`; not extracted anywhere.
- Focus trap / Tab-wrap / focus-restore — wholesale duplication between `QrPasteModal.jsx:100-179` and `CommandPalette.jsx:24-100` (identical `getFocusable` selector at `QrPasteModal.jsx:109-111` vs `CommandPalette.jsx:37-39`).
- Archive listing shape normalization — 4 sites: `src/lib/jobResultKind.js:61` (`entries|files|contents`), `src/lib/archiveTree.js:21-27` (`name || path || entry`), `ArchiveView.jsx:53-68` (same fallback + recursive flattener), `JobResultBody.jsx:150,157` (both chains again).
- Text case transformation — client `applyCase` in `TextView.jsx:45-50` (editor buttons 192-194) while the same 'case' operation is also submitted as a backend text job from the same component (`TextView.jsx:81-89`).
- Job-output→object-URL preview — extracted (`src/hooks/useJobPreviewUrl.js:19-61`, used by `ImageView.jsx:55`, `JobResultBody.jsx:196`) and re-implemented inline (`QrView.jsx:180-184` with manual revoke bookkeeping 111-136,151-153).
- Refresh-and-merge-running-jobs block triplicated within ConverterView itself: `ConverterView.jsx:145-158`, `173-184`, `436-451` (each rebuilds `attachJobsToFiles` + `mergeWorkspaceSnapshot` + queued/running filter).
- Palette extraction orchestration written twice in `ColorView.jsx`: 52-70 (effect) and 232-240 (button handler), around the single lib function `extractPaletteFromFile` (`src/lib/colorPalette.js`).

### 4.15 Checked and found single-sourced
PDF job option construction (`buildPdfJobOptions`, `src/lib/pdfJobOptions.js:128-238`, sole consumer PdfView); image crop options (`src/lib/imageCrop.js` via `ImageView.jsx:81-90`); client capability lookups (single `useCapabilities` hook, `useCapabilities.js:41-50`); `scripts/check-tools.mjs`/`scripts/repair-tools.mjs` are pure forwarders to `scripts/maint/tools.mjs` (lines 1-18 of each); server media/converter encode settings share one table (`processors/media.ts:10-14,147-148` importing `convert/quality.ts`); no client-side error-code→message table exists (only code checks `client.js:531-533` and generic fallbacks `useJobRunner.js:104-112,298-304`).
