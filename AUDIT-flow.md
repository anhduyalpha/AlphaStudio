# AUDIT: End-to-End Flow Traces

Three flows traced end to end (client → HTTP → Fastify route → service/worker → SQLite → SSE/poll → React state → DOM). Chosen because together they cover the app's ingestion path, its core value delivery, and the durability layer both depend on, and because they cross every pain-point file (ConverterView.jsx 1972 LOC, services/workspace.ts 1063 LOC, workers/jobs.ts 2442 LOC, PdfView.jsx, processors/converter.ts, convert/matrix.ts, converterGroups.js, liveState.js):

1. **Upload file into workspace** — multipart fast path (<8 MiB) + resumable chunked branch (≥8 MiB) with pause/resume/cancel and localStorage session keys.
2. **Create/run a conversion or PDF job** — through queue claim, worker pool, progress fan-out, to result download (single file and ZIP).
3. **App startup workspace recovery + live workspace SSE subscription** — recover-or-create hydrate, dual-transport SSE with backoff, versioned event merge, orphaned resumable-session recovery, debounced PATCH autosave.

Global facts referenced throughout: StrictMode is ON (`src/main.jsx:8`) — all mount effects double-invoke in dev. Server constants: chunk default 5 MiB clamped 256 KiB–16 MiB (`server/src/config.ts:74`), session TTL 24 h (`:75`), chunk timeout 2 min (`:76`), max upload 100 MiB (`:73`). Client constants: resumable threshold 8 MiB (`src/views/ConverterView.jsx:60`), 3 concurrent upload workers (`:61`).

Cross-flow hazard index (stated once, cross-referenced): version-counter restart break = F3-H2; poll-vs-SSE regression = F2-H2 (jobs) / F1-H8 (files); cross-tab force-pause = F1-H3; submitGuard mass-clear = F2-H4; dual terminal-refresh channels = F2-H6; files/uploads dual-write = F1-D1; swallowed inspect/waitForFileReady errors = F1-H9/H10.

---

## Flow 1 — Upload file into workspace (multipart fast path + resumable chunked branch)

### Ordered call path

**Entry / fan-out**
1. User drops files on the `FilePicker` dropzone (`src/components/FilePicker.jsx:47-51`) or picks via hidden inputs (`FilePicker.jsx:66-75`; header "Add files" input `src/views/ConverterView.jsx:1305-1316`) → `onChange` → `startUploads` (`ConverterView.jsx:1297-1304`, `:1310-1313`).
2. `startUploads` (`ConverterView.jsx:707-744`): gated on `workspaceId && hydratedOnce` (:709); dedupes File objects via WeakSet `startedFilesRef` (:711-713); spawns `min(3, batch.length)` async workers sharing a cursor (:715-723); each calls `uploadOne` (:721).
3. `uploadOne` (`ConverterView.jsx:483-666`): creates optimistic `local-<uuid>` card status `waiting` (:487-510), immediately flips to `uploading` (:513-520). Size branch at :552 (resumable) / :575 (multipart).

**Branch A — multipart (<8 MiB)**
4. `api.upload(file, {workspaceId, onProgress})` (`src/api/client.js:197-250`): XHR `POST /api/uploads?workspaceId=` (:207), FormData `file`+`workspaceId` (:245-248); `xhr.upload.onprogress` → `computeUploadMetrics` (:210-215; `src/lib/liveState.js:404-418`) → `onProgress` → `setServerFiles` upsert on the local id (`ConverterView.jsx:523-550`).
5. Server `POST /api/uploads` (`server/src/routes/uploads.ts:22-84`): `req.file()` (:23), sanitize + random stored name (:30-32), stream `pipeline` to disk (:45) with a running size counter destroying the stream past the cap (:37-42), post-checks (:52, :56-59); `ensureWorkspace` (:62 → `server/src/services/workspace.ts:187-196`, DB touch/insert :181-185/:168-173); `acceptUploadedFile` (:63-70).
6. `acceptUploadedFile` (`server/src/services/workspace.ts:520-586`): `validateStoredFileQuick` (:529), `quickFingerprint` (:536), fingerprint-based prior `detect_json` reuse (:543-553) else `detectFileQuick` (:558-564), `insertFile` status `processing` (:567-580).
7. `insertFile` (`workspace.ts:270-348`): SQLite tx inserting into `files` (:294-314) + legacy `uploads` mirror (:315-331) + `workspaces.updated_at` touch (:332-336); emits SSE `file.created` (:340-347) via `emitWorkspaceEvent` (`server/src/lib/workspace-events.ts:34-61`).
8. `scheduleFileFinalize(row.id)` (:583 → `setImmediate` :36-41) → `finalizeFileAsync` (:403-513): `streamChecksum` (:425), detect-cache lookup or `detectFile` deep probe (:435-443), verified-duplicate lookup (:457-463), tx promoting `processing → ready` in `files`+`uploads` (:470-483), SSE `file.updated status:ready` (:488-496), best-effort `setDetectCache` (:499-501); failures → `markFileTerminal` (:507-511 → :354-390, emits `file.updated` failed/missing).
9. Route replies 201 with `filePublic` DTO + workspaceId (`uploads.ts:72-75`).

**Branch B — resumable chunked (≥8 MiB)**
10. `api.createResumableUpload` (`client.js:108-110`) → `ResumableUploadController` (`src/api/resumableUpload.js:57-204`); registered in `uploadControllersRef` (`ConverterView.jsx:572`); `controller.start()` (:573 → `resumableUpload.js:102-111`).
11. `ensureSession` (`resumableUpload.js:72-100`): reads localStorage key `alphastudio:upload:<ws>:<name>:<size>:<lastModified>:<type>` (:1-8, :73); saved id → `GET /api/upload-sessions/:id` (:76; server `server/src/routes/upload-sessions.ts:34-37` → `getUploadSession` `server/src/services/upload-session.ts:197-199`); mismatch/completed → drop key (:80), 404 → drop key (:83); else `POST /api/upload-sessions/init` (:88-96; route `upload-sessions.ts:16-26` → `createUploadSession` `upload-session.ts:114-152`: mkdir session dir :137, INSERT `upload_sessions` :139-146, rollback rm :148) and store id in localStorage (:97).
12. `run()` (`resumableUpload.js:113-162`): session paused/failed → `POST .../resume` (:115-118; server `upload-session.ts:338-349` UPDATE status='uploading'); `onState('uploading')` (:123); loop over `totalChunks` skipping `receivedChunks` (:126-127); per chunk: `file.slice` (:132), `sha256Hex` via WebCrypto (:133 → :19-25), `PUT /api/upload-sessions/:id/chunks/:index` with `Content-Range` + `X-Chunk-SHA256` (:135-144 → :27-54).
13. Server chunk route (`upload-sessions.ts:39-55`; raw body via octet-stream parser `server/src/app.ts:82-84`) → `storeUploadChunk` (`upload-session.ts:213-325`): status check (:221-222), Content-Range vs expected range (:223-227), checksum regex (:228-229), existing-chunk idempotent return / conflict (:231-244), stream to `<idx>.<uuid>.part` with size meter + hash + 2-min destroy timer (:247-270), byte/checksum verification (:271-280), tx: re-check concurrent chunk → rename part→`<idx>.chunk` → INSERT `upload_chunks` → touch `upload_sessions` guarded `status='uploading'` (:282-315); returns fresh session DTO (:316).
14. Client updates `committedBytes` from the returned session DTO, emits progress (`resumableUpload.js:146-151`).
15. After all chunks: `onState('finalizing')` (:155) → `POST /api/upload-sessions/:id/finalize` (:156; route `upload-sessions.ts:67-71` → `finalizeUploadSession` `upload-session.ts:351-456`): already-finalized short-circuit (:356-359), crash-heal via `files.upload_session_id` (:362-374), missing-chunk + byte-total checks (:377-387), guarded lock `UPDATE status='finalizing' WHERE status='uploading'` (:389-395), stream-concatenate chunks (per-chunk path containment check :408-410) into `uploadsDir` with `wx` flag (:402-415), size assert (:416-417), `acceptUploadedFile` with `uploadSessionId` (:419-427 → steps 6-8 above incl. SSE `file.created` + `scheduleFileFinalize`), UPDATE session `completed` (:428-435), rm session dir (:436-440); on error: rm assembled file, UPDATE session `failed` + `last_error` (:442-455).
16. Client: `storageRemove` key (`resumableUpload.js:158`), `onState('completed')` (:160), resolves `finalized.file` (:161).

**Common post-upload**
17. `uploadOne` success: removes local card, upserts server row by real id with `uiStatus` `ready`/`inspecting` (`ConverterView.jsx:578-597`); deletes controller (:598).
18. Fire-and-forget `api.inspect([up.id])` (:602; `client.js:83-84` → `POST /api/inspect` `server/src/routes/inspect.ts:51-87` → `detectFile` deep probe :64).
19. Fire-and-forget `api.waitForFileReady` polling `GET /api/uploads/:id` every 200 ms, 60 s cap (:603-639; `client.js:256-270` → server `uploads.ts:86-107`); upsert with anti-regression mergeFn (:610-635).
20. SSE delivery (primary): `GET /api/workspaces/:id/events` (`server/src/routes/workspaces.ts:167-223`; hijacked raw stream :186-195, `connected` hello :197-202, bus subscribe :204-206, 25 s ping :208-215) ← bus `server/src/lib/workspace-events.ts:56-59`. Client: `useWorkspaceEvents` (`src/hooks/useWorkspaceEvents.js:23-77`, backoff reconnect :55-65) → `subscribeWorkspaceEvents` (`client.js:119-170`; fetch-stream variant :451-505) → `onWorkspaceLiveEvent` (`ConverterView.jsx:114-166`) → `applyWorkspaceEvent` (`liveState.js:463-561`) → `setServerFiles`/`setActiveJobs` (:121-122) → `FileInputCard` list re-render (:1279-1294; card render :1848-1952).
21. `startUploads` epilogue: `saveNow({route, selectedFileIds, toolSettings})` (:725-741; `src/hooks/useWorkspace.js:79-96`) → `PATCH /api/workspaces/:id` (`workspaces.ts:62-73`) → `patchWorkspace` (`workspace.ts:624-664`) → response is a full `hydrateWorkspace` (:677-764) stored into `hydrated` (`useWorkspace.js:85-86`).

**Pause / resume / cancel**
22. Pause: card button (`ConverterView.jsx:1935` → :668-673) → `controller.pause()` (`resumableUpload.js:177-189`: sets flag, aborts inflight XHR → XHR rejects code `PAUSED` :50, `POST .../pause` :182 → server `upload-session.ts:327-336` UPDATE `status='paused'`), `onState('paused')`.
23. Resume/Retry: buttons (:1936-1937 → `restartLocalUpload` :675-685): drops card + controller + WeakSet entry, re-runs `uploadOne`; `ensureSession` reuses the server session via localStorage; server `resume` (`resumableUpload.js:116`); received chunks skipped (:127).
24. Cancel: button (:1938, gated `f.localOnly && f.uploadSessionId` :1291 → `cancelLocalUpload` :687-700) → `controller.cancel()` (`resumableUpload.js:191-199`: abort, `DELETE /api/upload-sessions/:id` :195 → server `upload-session.ts:458-465` DELETE row + rm dir; 409 when completed/finalizing :460-461), remove localStorage key (:197), filter card (:696).
25. Reload recovery: effect `ConverterView.jsx:227-263` lists sessions (`GET /api/upload-sessions?workspaceId=` `client.js:103-104` → `upload-sessions.ts:28-32` → `listWorkspaceUploadSessions` `upload-session.ts:201-211`), force-pauses any still `uploading` (:234-237), renders `session-<id>` placeholder rows flagged `resumableMissingFile` (:238-256). (Traced fully in Flow 3, phase 5.)

**Duplicate multipart path**: `POST /api/workspaces/:id/files` (`server/src/routes/workspaces.ts:90-144`) is a near-verbatim copy of `uploads.ts:22-84` (differs: requires existing workspace :92, no query/field workspaceId, response lacks `workspaceId`). No client caller exists — `src/api/client.js:97-98` uses only the DELETE sibling.

### Where state lives and every location allowed to mutate it

**React state (ConverterView.jsx)**
- `serverFiles` (:77) — union of optimistic local cards, session placeholders, and server file DTOs. Mutators: optimistic insert :495-510; flip-to-uploading :513-520; progress upsert :535-549; resumable onState upsert incl. `session-<id>` row removal :558-569; success replace :583-597; waitForFileReady upsert :610-635; failure upsert :650-659; cancel filters :646, :682, :696; SSE apply :121; terminal-job refresh merge :146-149; job-poll reflection :412-425 and terminal merge :439-443; hydrate merge :203; reload session rows :259; convert-queue reflection :814-825; group-convert refreshes :861, :899, :919, :956; result-cancel refresh :1815; retry refresh :1198-1199; remove :969, :974; clear/new reset :982-983, :996.
- `activeJobs` (:80) + mirror `activeJobsRef` (:94-95). Mutators: :404-408, :444-450, :121-122/:151-157, :175-184, :216-221, :809-813, :984-985, :998-999, :1186-1190.
- `hydratedOnce` :79 (set :222, reset :995); `convertingKeys` :81; `groupSettings` :78; selection sets :85-91; `mountedRef` :100; `startedFilesRef` WeakSet :98 (add :713, delete :683); `uploadControllersRef` Map localId→{controller,file} :99 (set :572, delete :598, :645, :681, :692); `submitGuard` :92; `terminalRefreshPendingRef` :101.
- Controller internals: `session`, `paused`, `cancelled`, `inflight`, `running` (`resumableUpload.js:64-68`), mutated :106-109, :114-118, :145-150, :157, :177-187, :191-198 (read at :128-129).
- `useWorkspace`: `workspaceId`, `hydrated`, `loading`, `saving`, `saveTimer`, `hydrating` (`useWorkspace.js:11-16`), mutated :18-22, :24-54, :60-77, :79-96, :98-111.

**localStorage**
- `alphastudio-workspace-id` (`useWorkspace.js:4`): write/remove :20-21; read :11, :30.
- `alphastudio:upload:<workspaceId>:<name>:<size>:<lastModified>:<mime>` → session UUID (`resumableUpload.js:3-5`): set :97; removed :80 (mismatch/completed), :83 (404), :158 (finalized), :197 (cancel). All storage ops swallow exceptions (:7-17).

**Server in-memory**
- Workspace event bus: single `EventEmitter`, 500-listener cap, monotonic per-process `seq` (`workspace-events.ts:24-32`); mutated by `nextEventVersion` :29-32 and listener add/remove :63-78; `seq` resets on restart (:18 comment, :27).
- `fileFinalizersShuttingDown` flag (`workspace.ts:26-34`), checked :37-40, :404, :426, :444, :505.
- No in-memory upload-session map — sessions are SQLite-only.

**SQLite** (schema `server/src/db/migrations.ts:28-61`, files :118-130, `upload_session_id`/`duplicate_of` :334-342)
- `upload_sessions`: INSERT `upload-session.ts:139-146`; UPDATE touch-on-chunk :309-314, pause :332-334, resume :343-347, finalize lock :389-394, heal :366-371, completed :429-435, failed :449-453; DELETE cancel :462, cleanup :476; restart recovery `server/src/db/index.ts:194-200`, migration v6 `migrations.ts:347-349`.
- `upload_chunks`: INSERT `upload-session.ts:302-308`; removed only via session-dir rm + `ON DELETE CASCADE` (`migrations.ts:58`).
- `files`: INSERT `workspace.ts:294-314`; `missing`/`ready` flips `verifyFileOnDisk` :255-267; terminal :364-368; ready-promotion :470-476; detect update :588-592; soft delete :603-606; clear :772; hard purge :842; retention DELETE :1020, :1037.
- `uploads` (legacy mirror): INSERT OR REPLACE `workspace.ts:315-331`; status sync :371-373, :479-481; DELETE :844.
- `workspaces` (`selected_file_ids`, `ui_json`; sibling `tool_settings`): touch :181-185, :332-336; patch :647-660; soft-delete selection rewrite :608-612.
- `detect_cache`: `setDetectCache` at :412, :500, :596.

### Side effects: when they fire; double-fire / ordering

- **Optimistic card inserts** (:495-520): once per `uploadOne`; the WeakSet (:711-713) blocks re-submission of the *same File object* (StrictMode double-invoke, FilePicker re-fires) but not equal-content re-drops.
- **Multipart XHR POST** (`client.js:207-248`): once per file; cannot be aborted from the UI — `uploadOne` passes no `signal` (:575); removing an uploading multipart card (`onRemoveServerFile` :963-970) only deletes the local row, the XHR continues and its success handler re-adds the server file (:583-597).
- **Chunk PUTs**: sequential, one in flight per controller (:135-147). Re-PUT of a stored chunk after resume returns idempotent 200 (`upload-session.ts:234-243`); a concurrent duplicate PUT is resolved inside the tx (:285-297). Out-of-order impossible client-side (loop), tolerated server-side (range-per-index validation :224-227).
- **Chunk INSERT under paused session**: the status pre-check (:221) is outside the tx; a pause landing between check and tx still commits the chunk INSERT (:302-308) — only the session-touch UPDATE is status-guarded (:311-314).
- **Pause POST**: can fire twice — reload effect (:234-237) plus StrictMode double-run of that effect (cleanup gates only state application :258, not the pause loop); server pause is idempotent (`upload-session.ts:329`). Unmount also pauses every live controller (`ConverterView.jsx:106-110`).
- **finalize POST**: once per run; a second concurrent finalize is blocked by the guarded lock (`upload-session.ts:389-395`); after a crash mid-finalize, restart resets `finalizing→uploading` (`db/index.ts:194-203`) and re-finalize heals via `files.upload_session_id` (:362-374) — `acceptUploadedFile` is not re-run for a committed file.
- **`file.created` SSE emission** (`workspace.ts:340-347`) fires *before* the HTTP 201 reaches the client (emit inside `insertFile`, response after) — the SSE upsert and the XHR-success upsert both write the same row, SSE possibly first (see F1-H1).
- **`finalizeFileAsync`**: scheduled per accept (:583) and re-scheduled for all `processing` rows at boot (`resumeProcessingFiles` :47-66) — can run twice for the same file across restart; ready-promotion is guarded `WHERE status='processing'` (:473-475) and already-ready short-circuits (:408-417). Stale (>30 min) processing rows are failed at boot (:59-62).
- **Deep detect can run twice concurrently**: `finalizeFileAsync`→`detectFile` (:438) and the client's fire-and-forget `POST /api/inspect` (`ConverterView.jsx:602` → `inspect.ts:64`) — two probe processes (ffprobe/sharp) on the same freshly uploaded file.
- **waitForFileReady polling** (200 ms × ≤60 s per file, :605-607) runs concurrently with SSE by design (comment :600); the upsert mergeFn (:623-633) only prevents regression when the existing row is already `ready` with a newer timestamp.
- **Active-job poll** (:392-464): 500 ms interval; effect deps include `activeJobs`, and `applyWorkspaceEvent` returns a fresh `jobs` object on every SSE event (`liveState.js:467`, set at `ConverterView.jsx:122`), so the interval is torn down and recreated on every event (see F2-H7).
- **SSE subscription**: StrictMode mounts twice — first connection closed by cleanup (`useWorkspaceEvents.js:71-76`); reconnect triggers a full `refresh()` hydrate (`ConverterView.jsx:168-188`).
- **Hydrate POST /api/workspaces/recover**: StrictMode double effect (`useWorkspace.js:56-58`); the `hydrating` ref (:25-26) suppresses overlap, not a second sequential call.
- **Autosave PATCH**: two writers — the debounced `save` effect (`ConverterView.jsx:354-389`, 400 ms) and `saveNow` in `startUploads` (:734-738) plus `saveNow` in results actions (:1111, :1138, :1692); each PATCH rewrites `selected_file_ids` wholesale from client state.
- **Timers**: server cleanup interval 15 min (`index.ts:43-54`, immediate pass :57-65 → `cleanupExpiredUploadSessions` `upload-session.ts:468-494` deleting expired sessions + dirs + UUID-shaped orphan dirs); chunk kill timer 2 min (:264-267); SSE ping 25 s (`workspaces.ts:208-215`); client 200 ms/500 ms polls above; save debounce (`useWorkspace.js:64`).
- **Process spawns**: none in the upload path itself until detect (`detectFile` deep probe may invoke external tools).

### State duplicated across locations and synced manually

1. **File row**: SQLite `files` (`workspace.ts:294-314`) ⇄ legacy `uploads` mirror (:315-331) — dual-written inside three tx sites (:315-331, :371-373, :479-481); read paths diverge (`GET /api/uploads/:id` prefers `files`, falls back to `uploads`, `uploads.ts:88-107`; `/api/inspect` reads `uploads` then joins `files`, `inspect.ts:31-36, :43-47, :60`). *(Also underpins F3-D2.)*
2. **File status/progress**: SQLite `files.status` ⇄ client `serverFiles[].status/uiStatus` — synced by four independent mechanisms: SSE (`ConverterView.jsx:121`), waitForFileReady poll (:610-635), hydrate/refresh merges (:203, :146-149), and the XHR response upsert (:583-597); reconciliation in `mergeWorkspaceSnapshot`/`isNewerEvent` (`liveState.js:279-295, :315-399`).
3. **Resumable upload progress**: server `upload_chunks` rows (authoritative `receivedBytes` derived per DTO `upload-session.ts:154-195`) ⇄ controller `committedBytes` (`resumableUpload.js:120, :150`) ⇄ React card `loaded/uploadProgress` (`ConverterView.jsx:543-546`) — synced by copying the session DTO returned from each chunk PUT (:148-150).
4. **Session identity**: SQLite `upload_sessions.id` ⇄ localStorage key (`resumableUpload.js:97`) ⇄ card field `uploadSessionId` (`ConverterView.jsx:562`) — reconciled on start by GET-validate (:76-86).
5. **Selected file ids**: `workspaces.selected_file_ids` ⇄ derived client list — rewritten wholesale by both the debounced autosave (:356-378) and `startUploads`' `saveNow` (:725-738); server independently prunes on delete (`workspace.ts:608-612`) and on hydrate (:686-688).
6. **Job linkage to files**: `job_files` rows + `jobs.options._uploadIds` (server, `workspace.ts:80-93, :122-150`) ⇄ client `file.jobId/jobStatus` stamped by `attachJobsToFiles` (`liveState.js:234-254`), SSE job-reflection (:532-556), and the poll loop (`ConverterView.jsx:410-426`). *(Detailed in F2-D2.)*
7. **Workspace id**: SQLite `workspaces.id` ⇄ localStorage `alphastudio-workspace-id` (`useWorkspace.js:4, :20-21`) — shared by all tabs.

### Race conditions, unhandled error paths, and never-surfaced states

**Races**
- **F1-H1 — SSE `ready` vs XHR-201 upsert regression**: `insertFile` emits `file.created` before the 201 is sent (`workspace.ts:340-347` vs `uploads.ts:72`), and `finalizeFileAsync` can emit `ready` (:488-496) before the client's `xhr.onload` runs. `uploadOne`'s success upsert (`ConverterView.jsx:583-597`) uses `upsertById`'s default merge — no version/updatedAt guard (`liveState.js:264-273`) — overwriting the SSE `ready` row back to `processing`/`inspecting`; recovery relies on `waitForFileReady` (:603) or a later SSE event.
- **F1-H2 — duplicate visible card mid-upload**: between the SSE `file.created` upsert (`ConverterView.jsx:121`, inserting the server id) and XHR completion (the only place the `local-` card is removed, :584), both the local uploading card and the server `inspecting` row coexist in `serverFiles` — `mergeWorkspaceSnapshot` keys strictly by id (`liveState.js:318-336`) and cannot unify differing ids.
- **F1-H3 — cross-tab pause kill**: two tabs share `alphastudio-workspace-id` (`useWorkspace.js:4`). Tab B reloading runs the session-recovery effect (`ConverterView.jsx:234-237`) which pauses every `uploading` session in the workspace — including Tab A's live one. Tab A's next chunk PUT 409s `UPLOAD_CONFLICT` ('Upload session is paused', `upload-session.ts:221`), which is neither `PAUSED` nor `CANCELLED` in `uploadOne`'s catch (:643-644), so Tab A marks the file `upload-failed` (:650-659) despite the durable session being resumable. *(Also listed under Flow 3 phase 5.)*
- **F1-H4 — chunk commit into paused session**: pause UPDATE (`upload-session.ts:332-334`) landing between `storeUploadChunk`'s status check (:221) and its tx (:283-315) still commits the chunk INSERT (:302-308); only the session-touch is status-guarded (:311-314).
- **F1-H5 — lost finalize response duplicates the file**: server completes `finalizeUploadSession` (file committed :419-427, session `completed` :429-435) but the response is lost → client `run()` rejects → `uploadOne` marks `upload-failed` (:650-659) while SSE `file.created` already added the real file row (two contradictory rows). The localStorage key is only removed on client-observed success (`resumableUpload.js:158`); retry finds the saved session `completed`, discards it (:77-80), creates a fresh session, and re-uploads the whole file — a second identical `files` row (dedupe only annotates `duplicate_of` at finalize, `workspace.ts:457-476`; both rows kept).
- **F1-H6 — mid-chunk cancel surfaces as PAUSED**: `controller.cancel()` during an in-flight chunk aborts the XHR whose `onabort` rejects with code `PAUSED` (`resumableUpload.js:50`); `CANCELLED` is thrown only at the loop-top check (:129). `uploadOne` takes the `PAUSED` early-return (:643); card removal depends solely on `cancelLocalUpload`'s subsequent filter (:696).
- **F1-H7 — multipart size-cap guards likely unreachable (inferred)**: route caps use strict `>` (`uploads.ts:39, :52, :56`; duplicated `workspaces.ts:106, :117, :121`) while `@fastify/multipart` is registered with `limits.fileSize = config.maxUploadBytes` (`app.ts:75-81`). Per documented @fastify/multipart/busboy truncate-at-limit semantics, the plugin caps delivered bytes at exactly the limit, which would leave the route-level destroy/413 branches unreachable through the plugin-limited stream — inferred from plugin documentation, not exercised in this read-only audit.
- **F1-H8 — poll/SSE anti-regression gap (files)**: `waitForFileReady` mergeFn (`ConverterView.jsx:623-633`) keeps `existing` only when `existing.status === 'ready'` and newer; a newer SSE `failed` row can be overwritten by an older poll snapshot for the same file. *(Job-side counterpart: F2-H2.)*

**Unhandled / swallowed errors**
- **F1-H9**: `waitForFileReady` failure (60 s timeout or network) fully swallowed (`ConverterView.jsx:636-638`); if SSE is also down, the card remains "Inspecting" indefinitely with no error surfaced.
- **F1-H10**: `api.inspect(...)` errors swallowed (:602).
- **F1-H11**: job-poll errors swallowed (:453-455); terminal-refresh errors swallowed (:160-162); reconnect-snapshot errors swallowed (:185-187). *(Shared with Flows 2/3.)*
- **F1-H12**: `listUploadSessions` failure swallowed (:261) — persisted paused sessions silently never appear after reload.
- **F1-H13**: `saveNow` failure in `startUploads` swallowed as "non-fatal" (:739-741) — server `selected_file_ids` silently diverges from uploaded files.
- **F1-H14**: unmount pause `.catch(() => {})` (:108).
- **F1-H15**: `cleanupExpiredUploadSessions` runs `fs.statSync` on directories in a loop with no per-entry try/catch (`upload-session.ts:486-492`); a single failing entry propagates into the caller's blanket catch (`index.ts:50-52, :62-64`), aborting the rest of that cleanup pass.
- **F1-H16**: `storeUploadChunk`'s `input.body.resume()` on the idempotent path (:235) discards the request body with no length/checksum verification against the stored chunk beyond the DB fields (:236-241).

**Never-surfaced states**
- **F1-H17**: `retrying` uiStatus exists in `FILE_UI_STATUS` (`liveState.js:11`), stage sets (:159), and `normalizeFileUiStatus` return sites (:38, :65, :68), and `FileInputCard` styles it (`ConverterView.jsx:1852, :1872`), but no code path ever sets `uiStatus:'retrying'` — dead status.
- **F1-H18**: failed multipart uploads have no Retry affordance — `onRetry`/`onResume`/`onPause` are wired only when `uploadControllersRef.current.has(f.id)` (:1288-1290), true only for resumable uploads (:572); a small-file `upload-failed` card offers only Remove.
- **F1-H19**: duplicate-detection result (`files.duplicate_of`, exposed in DTO `workspace.ts:234`) is never read or rendered anywhere in `ConverterView.jsx`.
- **F1-H20**: `normalizeFileUiStatus` contains duplicated unreachable branches (`liveState.js:64-69`: `paused`/`retrying`/`finalizing` tested twice; the second block :67-69 is dead).
- **F1-H21**: the `session-<id>` placeholder is dropped only when the same file is reselected (`ConverterView.jsx:559`); if a different browser profile owns the localStorage key, the placeholder's "reselect this file to resume" hint (:1911) is the only surfaced path, and Resume is explicitly disabled for it (`!file.resumableMissingFile` guards :1936-1937), matching `restartLocalUpload`'s notify-only fallback (:676-679).
- **F1-H22**: `POST /api/workspaces/:id/files` (`workspaces.ts:90-144`) is live and duplicates the upload cap/accept logic with zero client callers (`src/api/client.js:97-98` uses only the DELETE sibling) — a second maintenance surface for the same behavior.

---

## Flow 2 — Create/run a conversion or PDF job through progress to result download

### Ordered call path

**A. PDF flow (PdfView → useJobRunner)**
1. Click "Run PDF operation" → `PrimaryButton onClick={start}` `src/views/PdfView.jsx:636`; `start` :247-291 — capability gate :248-251, client validation `validatePdfClient` (`src/lib/pdfJobOptions.js:56-122`) at :252-255, clears `lastOutput`/`inspectData` :258-259.
2. `run('pdf', { files, options: buildPdfJobOptions(...) })` `PdfView.jsx:263-287`; options built in `pdfJobOptions.js:128-238`.
3. `useJobRunner.run` `src/hooks/useJobRunner.js:211-318`: in-flight guard :220, `clientRequestId` :221 (`createClientRequestId` `src/api/client.js:526-529`), busy/progress/status/job set :223-226, AbortController :227-228.
4. Sequential uploads :231-248 → `api.upload` (`client.js:197-250`, `POST /api/uploads`, server `server/src/routes/uploads.ts:22`); upload progress mapped 0–30% :239.
5. `api.createJob` :250-259 → `client.js:274-275` → `POST /api/jobs`.
6. Route `server/src/routes/jobs.ts:19-38` → `createJob` `server/src/workers/jobs.ts:288-439`: password extracted to vault :294-296 + :411-413 (`extractPassword`/`redactSensitiveOptions` `server/src/pdf/operation-options.ts:207-213`/`:192-205`), `assertJobCapable` :316, `options._uploadIds` attach :321-323, upload existence check :325-332, PDF cardinality check :334-347, converter honesty gate `gateConverterCreate` :360-362 (impl :260-286, uses `listOutputsFor` `server/src/convert/matrix.ts:162-228`), dedupe `findActiveDuplicateJob` :367-377 (impl :191-243), `INSERT INTO jobs` :393-409, `job_files` links :416-425, activity row :427-433, `pumpQueue()` :435, `emitJob(created,'created')` :437.
7. `pumpQueue` :664-674 → `startWorkerPool` :1820-1842 (watchdog interval :1828-1841) → `ensureWorkerPool` :1389-1408 forks `worker-process` :1356-1387 → `pumpReadyWorkers` :1534-1544 → atomic claim `claimNextQueuedJobRow` (single UPDATE…RETURNING with lease) :626-655 → `dispatchToWorker` :1489-1532 (job timeout timer :1509-1510; payload `prepareWorkerPayload` :1410-1487 — result-cache lookup :1427-1450, vault password re-injection :1461-1466; IPC send :1515-1520; `emitJob(...,'updated')` :1522).
8. Worker `server/src/workers/worker-process.ts`: `run` :124-213 — payload validation :65-99, mkdir work/output dirs :139-140, cached-result copy :143-159 or `getProcessor(job.type)` :161 (`server/src/processors/index.ts:93-101`; converter → `processConverter` :23), progress IPC :170-179, result IPC :186-191, cleanup + `idle` :202-212.
9. Parent `handleWorkerMessage` :1561-1610: `progress` → `active.progress.update` :1591-1596 → batcher `createProgressBatcher` :705-762 → `dbUpdateJobProgress` (`server/src/db/index.ts:255-262`, SQL :85-86 — writes only when `status='running'`) + `emitJob` :725-727; `result` → `settleWorkerSuccess` :1599-1601.
10. `settleWorkerSuccess` :1661-1697: cancel check :1664-1670, output-path confinement :1673-1678, `progress.flush()` :1679, `completeJobSuccess` :1205-1296: `validateJobOutput` :861-993 + `validateJobOutputDeep` :1122-1160, lease-guarded `UPDATE jobs SET status='completed'` :1235-1252 (stale-lease throw :1253-1257), `setJobResultCache` :1259-1271, `registerJobOutput` → `INSERT INTO outputs` :1273-1285 (`server/src/services/workspace.ts:855-880`), activity :1287-1293, `clearJobPassword` :1294, `emitJob` :1295.
11. `emitJob` :2017-2047: emits `jobEvents 'job'` + `` `job:${id}` `` :2020-2021 and workspace bus `emitWorkspaceEvent` :2032-2043 (`workspace-events.ts:34-61`).
12. Client progress: `api.waitForJob` `client.js:285-301` — prefers SSE `waitViaSse` :416-449 (EventSource on `/api/jobs/:id/events`; server `routes/jobs.ts:91-136`: initial snapshot :118, per-event send :120-127, cleanup on terminal/close :129-134); any SSE failure falls to a 400 ms `getJob` poll loop :294-299.
13. `onUpdate` → `setJob/setProgress/setStatus` `useJobRunner.js:266-274` (progress mapped 30–99 :270) → `ProgressWave` `PdfView.jsx:324`, rail :606, runbar :632.
14. Terminal completed: `useJobRunner.js:276-287` — progress 100, sessionStorage key cleared :279 (`persistJobId` :36-47), notify. PdfView completion effect `PdfView.jsx:123-135` (once per job id via `handledCompleteIdRef` :109): `setLastOutput`, `setFiles([])`, `setInspectData`, `setTab('Export')`.
15. Download: `JobOutputCard` `PdfView.jsx:679-686` → `download` `src/components/JobOutputCard.jsx:44-55` → `api.downloadJob` `client.js:344-346` → `downloadPath` :366-379 (fetch blob → objectURL → synthetic `<a>` click) → `GET /api/jobs/:id/download` `routes/jobs.ts:67-80` (`assertDownloadablePath` :74, streams `output_path` :79).
16. Resume (reload mid-job): mount effect `useJobRunner.js:124-197` reads sessionStorage :130 → `api.getJob` :154 → type check :157-164 → `attachToJob` :177 (impl :61-120: snapshot :72 then `waitForJob` :75-78).

**B. Converter flow (ConverterView)**
17. Files enter via Flow 1 (steps 1-21); `saveNow` persists `selectedFileIds` (`ConverterView.jsx:734-741`).
18. Click "Convert group" :1589-1603 → `startGroupConvert` :842-864 → `queueConvertJob` :762-840: guard key check :772-776, client dupe check `hasActiveDuplicateJob` :777-787 (`src/lib/converterGroups.js:413-429`), `submitGuard.add` :789, `setConvertingKeys` :790-792, `api.createJob({type:'converter', options:{operation:'batch', format, _uploadIds…}})` :794-807, `jobGroupKeysRef.set` :808, `setActiveJobs` :809-813, optimistic file uiStatus `processing` :814-825; error → notify + revert :827-836; `finally` guard delete :837-839.
19. Server: same route/createJob path as step 6; converter jobs ALWAYS dedupe (`workers/jobs.ts:367`).
20. Worker: `processConverter` `server/src/processors/converter.ts:31-147`: per-file `resolveInspect` :51 (detect reuse :153-201), `assertPairAllowed` :53 (`server/src/convert/matrix.ts:422-459`), `routeConversion` :76-79 (`matrix.ts:308-412`), engine fallback execution :80-89, `ENGINE_DISPATCH`/family branches `convertOne` :269-490, multi-file → ZIP via `processArchive` :121-146.
21. Progress fan-out via TWO concurrent channels: (i) workspace SSE `useWorkspaceEvents` (`ConverterView.jsx:191-195`; `useWorkspaceEvents.js:23-77`, backoff :55-65; server SSE + 25 s ping `workspaces.ts:204-222`) → `onWorkspaceLiveEvent` :114-166 → `applyWorkspaceEvent` (`liveState.js:463-561`); (ii) 500 ms poll of active jobs :392-464 (`setInterval` :458).
22. Terminal: SSE handler drops `convertingKeys` :128-135, gated `refresh()` :140-165 re-hydrates the snapshot; poll path does the same :427-451.
23. Render: `resultRows` :1008-1022 (`buildResultRows` from `converterGroups.js`) → progress bars :1763-1777, badges :1779-1795.
24. Download: per-row `downloadOne` :1052-1066 → `api.downloadJob`/`downloadPath`; multi → `downloadSelectedOrAll` :1068-1094 → `api.downloadOutputsZip` `client.js:387-413` → `POST /api/workspaces/:id/outputs/download-zip` `workspaces.ts:230-264` (`listOutputsForZip` `workspace.ts:910-967`, streamed archiver :262-263).
25. Retry: `retryFailed` `ConverterView.jsx:1154-1201` creates a **new** job via `api.createJob` :1175-1185 (spreading old options incl. persisted `clientRequestId`); the server same-row retry endpoint `POST /api/jobs/:id/retry` (`routes/jobs.ts:83-88`, `retryJob` `workers/jobs.ts:480-540`) has zero client callers; likewise the WS endpoint `routes/jobs.ts:139-160` has no client caller.

### Where state lives and every location allowed to mutate it

**React — useJobRunner** (`src/hooks/useJobRunner.js`): `busy` :24 — :64, :115, :223, :307; `progress` :25 — :52, :56, :82, :149, :168, :224, :239, :262, :270, :277; `status` :26 — :58, :65, :83, :93, :150, :168, :171, :225, :240, :263, :271, :278; `job` :27 — :50, :80, :141-151, :166, :226, :260, :268, :275 + external `setJob(null)` from `PdfView.jsx:683`; refs `abortRef` :28 (:33, :69, :116, :189, :200, :228, :308), `resumedRef` :29 (:126), `runPromiseRef` :30 (:220, :311-314).

**React — PdfView** (`src/views/PdfView.jsx`): `tab` :86 (:134, :323); `files` :87 (:129, :336); `operation` :88 (:319, :360); 14 form fields :89-104 (bulk reset effect :138-157; individual onChange :383, :389, :398, :405, :410, :421, :428, :436, :444, :452, :459, :469, :475, :480, :485, :492); `editPlan` :105 (:129, :156, :350); `lastOutput` :106 (:128, :258, :684); `inspectData` :107 (:132, :259); `handledCompleteIdRef` :109 (:126).

**React — ConverterView**: `serverFiles`/`activeJobs` + refs — full mutation inventory in Flow 1 (state subsection); additional job-specific mutators: `convertingKeys` :81 (:129-135, :429-433, :474, :791, :830-836, :945-949), `submitGuard` :92 (:158, :435, :789, :838, :950-952), `jobGroupKeysRef` :93 (:134, :434, :476, :808), `resultFilter` :84, `selectedResultIds` :85, `hideCompleted` :86, `hiddenResultIds` :87, `zipBusy` :88 (:1082, :1092), `selectedGroupId` :89, `selectedFileIds` :91, `terminalRefreshPendingRef` :101 (:141, :164).

**Browser storage**: `sessionStorage['alphastudio.pdf.activeJobId']` — written/removed only in `useJobRunner.persistJobId` (:38-44) and removals :159, :173, :180; key passed from `PdfView.jsx:113`. `localStorage['alphastudio-workspace-id']` — `useWorkspace.js:18-22`, read :11, :30.

**Server in-memory** (`server/src/workers/jobs.ts`): `jobEvents` EventEmitter :53-54 — listeners added/removed `routes/jobs.ts:133, :130, :158-159`; `jobPasswordVault` :61 — set :412, :502; deleted :63-65 via :463, :1294, :2004-2006; `cancelFlags` :87 — set :548, :1629; deleted :528, :1769; read :737, :755, :1664; `workerSlots` :121 (+ :1377, :1781, :1871); pool flags :122-128 (`workerSequence`, `workerPoolStarted/Stopping`, `workerWatchdog`, `workerCrashCount`, `pumpPending`, `settlementTasks` :1612-1615); per-job `ActiveLease` progress-batcher closure (`lastProgress/lastMessage/lastWriteAt/pending*` :713-718); worker-process-local `active` (`worker-process.ts:35`; :136, :209, :232-236, :240-241). Workspace bus + `seq` (`workspace-events.ts:24-32`). `toolsSnapshotCache` (`matrix.ts:97-113`).

**SQLite** (`server/src/db/index.ts:391-421` JobRow): `jobs` — INSERT `workers/jobs.ts:393-409`; UPDATEs: progress `db/index.ts:85-86, :255-262`; claim `workers/jobs.ts:642-653`; retry re-queue :513-522; cancel :556-571; complete :1235-1252; finish (failed/cancelled) :1985-2003; heartbeat :1550-1555; partial-output scrub :1962-1965; startup recovery `db/index.ts:174-189` (running→failed SERVER_RESTART) and :206-210 (queued lease reset); orphan GC delete `workers/jobs.ts:2354-2356`. `job_files` — :416-425, delete :2355. `activity` — `logActivity` :2049-2070 (call sites :427, :529, :576, :1287, :1751). `outputs` — insert `workspace.ts:863-878`, delete `workers/jobs.ts:2335`. `job_result_cache` — `db/index.ts:357-379`; writes `workers/jobs.ts:1259-1271`; deletes :1442-1448. `uploads`/`files` — upload ingestion (Flow 1) + cleanup `workers/jobs.ts:2156-2181, :2360-2372`. `workspaces`/`tool_settings` — PATCH via `useWorkspace.save` (Flow 3 phase 6).

### Side effects: when they fire; double-fire / ordering

- **Upload XHR**: once per file per run; StrictMode-safe in ConverterView via WeakSet (`ConverterView.jsx:711-713`); in PdfView, `run` is click-driven + `runPromiseRef` guard (`useJobRunner.js:220`) — cannot double-fire per hook instance.
- **POST /api/jobs**: PdfView — new `clientRequestId` per run (:221); dedupe applies only because the id is sent (server `workers/jobs.ts:367`). ConverterView — `submitGuard` (:772-789) + client `hasActiveDuplicateJob` (:777-787) + server always-dedupe for converter (:367-377). `retryFailed`'s POST (:1175-1185) has **no submitGuard and no client dupe check** — double-click protection rests solely on server dedupe against the just-created queued row.
- **SQLite progress writes**: throttled by `shouldWriteProgress` (:680-702; ≥5% delta / message change / 500 ms + delta). The header comment :72 claims "flush pending every 500ms" but no periodic flush timer exists — `flush()` runs only at `settleWorkerSuccess:1679` (see F2-H24).
- **Process spawns**: worker `fork` :1359-1365 (restart-on-exit timer :1811-1816; idle-stale kill via watchdog :1833-1836); external converter binaries spawned inside the worker (child PIDs mirrored via `child-started` IPC :1583-1586).
- **SSE emissions**: every `emitJob` dual-publishes (per-job bus :2020-2021 + workspace bus :2032-2043) — a ConverterView job update reaches the client twice when it also polls; ordering is client-reconciled only.
- **Timers**: job timeout :1509; forceKill grace :1640-1644; watchdog interval :1828-1841; worker heartbeat `worker-process.ts:257-264`; SSE ping `workspaces.ts:208-215`; client polls 400 ms (`client.js:294-299`) / 500 ms (`ConverterView.jsx:458`); save debounce 400 ms (`useWorkspace.js:64`); SSE reconnect backoff (`useWorkspaceEvents.js:59-64`).
- **File writes**: worker work/output dirs `worker-process.ts:139-140`; output copy on cache hit :146; work-dir rm :205; partial-output rm `workers/jobs.ts:1951-1969`; temp cleanup :2124-2184; orphan GC :2275-2379.
- **Concurrent SSE + poll (ConverterView)**: both always active — the poll is not disabled while SSE is healthy (:392-464 runs whenever `activeJobs` has queued/running). PdfView `waitForJob` is either/or (SSE first, poll only after SSE throws, `client.js:287-293`).
- **Server restart mid-flow**: running jobs → failed/SERVER_RESTART retryable (`db/index.ts:174-189`); queued re-pumped (:206-210, `resumeQueuedJobs` :217-228); the in-memory vault empties → retry of password jobs returns PASSWORD_REQUIRED (`workers/jobs.ts:505-509`); workspace event `seq` resets to 0 (`workspace-events.ts:27`; consequences at F3-H2).

### State duplicated across locations and synced manually

1. **Job progress/status**: SQLite `jobs.progress/status/message` ⟷ batcher closure `lastProgress/pendingProgress` (`workers/jobs.ts:713-717`) ⟷ `useJobRunner` `progress/status/job` (`useJobRunner.js:25-27`) ⟷ ConverterView `activeJobs[id]` ⟷ `serverFiles[].jobProgress/jobStatus/uiStatus` (`ConverterView.jsx:412-425`; `liveState.js:536-555`) ⟷ `hydrated.jobs` snapshot (`useWorkspace.js:12`) ⟷ DOM progress bars (`ConverterView.jsx:1763-1777`, `PdfView.jsx:324`). Sync: SSE events + polling + `refresh()` snapshot merges (`mergeWorkspaceSnapshot` `liveState.js:315-399`, `isNewerEvent` :279-295).
2. **Job↔file linkage**: `job_files` table (`workers/jobs.ts:416-425`) ⟷ `options._uploadIds` persisted inside `jobs.options` JSON (:321-323) ⟷ client `f.jobId`/`jobGroupKeysRef` (`ConverterView.jsx:93, :808`). Client dedupe/stage placement relies solely on `_uploadIds` (`converterGroups.js:419-425`, `liveState.js:117`).
3. **Active job id**: sessionStorage key (`useJobRunner.js:40`) ⟷ `job` state ⟷ SQLite row. Manual sync at :261, :279, :289, :295; removal-on-error :159, :173, :180.
4. **Workspace file list**: SQLite `files` ⟷ `hydrated.files` ⟷ `serverFiles` (+ optimistic `local-*` rows) — three-way merge in `mergeWorkspaceSnapshot` (`liveState.js:315-399`) and event upserts (:463-561). *(See also F1-D1/D2.)*
5. **Duplicate-job detection duplicated**: client `hasActiveDuplicateJob` (`converterGroups.js:413-429`, key = sorted ids + `|` + format) vs server `findActiveDuplicateJob` (`workers/jobs.ts:191-243`, key = sorted ids + normalized full options) — different comparison semantics maintained in parallel.
6. **downloadUrl**: computed server-side in `jobPublic` (`workers/jobs.ts:607`) and independently client-side in `api.downloadUrl` (`client.js:279`).
7. **Run-job orchestration duplicated**: `useJobRunner.run` (`useJobRunner.js:211-318`) vs `api.runJob` (`client.js:303-342`) implement the same upload→create→wait pipeline.
8. **Retry duplicated**: server same-row `retryJob` (`workers/jobs.ts:480-540`, no client caller) vs client new-row `retryFailed` (`ConverterView.jsx:1154-1201`).
9. **PDF op catalog**: static `GROUPS` (`PdfView.jsx:26-74`) ⟷ backend descriptors merged at runtime (:161-189) — labels/engines exist in both.
10. **Converting flags**: `convertingKeys` + `jobGroupKeysRef` + `submitGuard` mirror server queued/running status; reconciliation effect :468-477 exists precisely to re-sync them.

### Race conditions, unhandled error paths, and never-surfaced states

**Races / ordering**
- **F2-H1 — StrictMode silently skips PDF resume (dev)**: mount effect (`useJobRunner.js:124-197`) sets `resumedRef.current = true` :126; StrictMode cleanup :186-189 runs synchronously — before the `api.getJob` promise (:154) can resolve — setting `cancelled = true`, so the first invocation's async IIFE exits at the `if (cancelled) return` guard :155 and `attachToJob` :177 is never reached (cleanup's `abortRef.current?.abort()` :188 is a no-op at that moment: `abortRef.current` is null until `attachToJob` sets it :69, so catch :178-184 never runs). The second invocation returns early at :125 (`resumedRef` persists). Net: auto-resume never runs in dev; the persisted sessionStorage job id is retained, with no notify.
- **F2-H2 — stale poll overwrites newer SSE state (jobs)**: poll tick `ConverterView.jsx:399-425` writes `setActiveJobs({...prev,[id]:j})` :404-408 and `upsertById` file patches :412-424 with no version/updatedAt comparison (default merge `liveState.js:271`), while the SSE path enforces `isNewerEvent` (`liveState.js:527-547`). SSE delivers progress=80 → an in-flight `getJob` response (progress=60) resolves afterwards → progress regresses in both `activeJobs` and file rows until the next event. *(File-side counterpart: F1-H8; restated for Flow 3 at F3-H7.)*
- **F2-H3 — version counter resets on restart**: see F3-H2 (breaks event ordering for job events too, since `emitJob` stamps `nextEventVersion()` `workers/jobs.ts:2018`).
- **F2-H4 — `submitGuard.current.clear()` on any terminal event clears guards of unrelated in-flight creates**: `ConverterView.jsx:158` (SSE refresh) and :435 (poll) clear ALL keys, including a guard for a create POST still awaiting its response, permitting an immediate duplicate click for that same selection; protection then rests solely on server dedupe (`workers/jobs.ts:367-377`), which compares normalized options only after the first row is inserted.
- **F2-H5 — cancel-vs-result race deletes a completed output**: `settleWorkerSuccess` checks `cancelFlags` (`workers/jobs.ts:1664-1670`) → converts a fully produced result into CANCELLED, and `settleWorkerFailure` runs `removePartialOutputs` (:1742), deleting the finished file — a cancel clicked in the delivery window discards real work by design of the interleaving.
- **F2-H6 — two refresh channels on terminal**: SSE handler refresh (`ConverterView.jsx:140-165`, gated by `terminalRefreshPendingRef`) and poll-path refresh (:436-451, ungated) can both fire for one terminal job → duplicate GET workspace snapshots and interleaved `setServerFiles`/`setActiveJobs` merges.
- **F2-H7 — poll interval churn**: effect :392-464 depends on `activeJobs` (new object identity on every SSE event and every poll write) → the interval is torn down/recreated repeatedly; `tick()` also runs immediately on each re-subscribe (:459), producing bursts of `getJob` calls beyond the nominal 500 ms cadence.
- **F2-H8 — `gateConverterCreate` inspects only `uploads[0]`** (`workers/jobs.ts:360-362`): mixed-extension multi-file batches pass the create gate; files 2..n fail later in the worker at `assertPairAllowed` (`processors/converter.ts:53`) after queueing.
- **F2-H9 — `aggregateJobProgress` scope holds only by construction**: it counts all jobs present in `activeJobs` (`ConverterView.jsx:332`, `converterGroups.js:529-559`); `activeJobs` is populated only from this workspace's hydrate/SSE, and the poll path re-inserts any job it already tracks — no explicit workspace filter.

**Unhandled / swallowed errors**
- **F2-H10**: poll tick `catch { /* ignore poll errors */ }` (`ConverterView.jsx:453-455`) — repeated `getJob` failures (e.g. server down) invisible; progress silently freezes. *(= F1-H11 first clause.)*
- **F2-H11**: terminal-refresh failure swallowed (:160-162). *(= F1-H11.)*
- **F2-H12**: `api.inspect` + `waitForFileReady` swallowed — see F1-H9/H10.
- **F2-H13**: `retryFailed` per-job `catch { /* skip */ }` (:1192-1194) — individual create failures reduced to an aggregate count message (:1196).
- **F2-H14**: `cancelGroupJobs` per-cancel `catch { /* ignore */ }` (:940-943).
- **F2-H15**: `useJobRunner.cancel` swallows cancel-API failure (:205-207); "Job cancel requested" is notified only on success (:204) — failure is silent.
- **F2-H16**: mount-resume catch (:178-184): errors thrown by `api.getJob(id)` :154 (network, 404) in a normal single mount silently delete the stored job id — no notify. Errors escaping `attachToJob` :177 also delete the id, but are toasted first by `attachToJob`'s own catch (:104-112). The StrictMode abort path never reaches this catch (see F2-H1).
- **F2-H17**: ZIP stream error after headers sent (`workspaces.ts:247-252`) — the `reply.sent` guard means mid-stream archiver errors produce a silently truncated ZIP for the client.
- **F2-H18**: WS send failures ignored (`routes/jobs.ts:154-156`).
- **F2-H19**: `run` background promise `.catch(() => {})` (`useJobRunner.js:314`); PdfView catches at `PdfView.jsx:288-290` with an empty body, relying on the hook's notify.
- **F2-H20**: `completeJobSuccess` swallows `registerJobOutput` failure (`workers/jobs.ts:1283-1285`) — the job completes but the `outputs` row is missing → the output is invisible to Converted Files rows built from `hydrated.outputs` (`ConverterView.jsx:1019`) and excluded from ZIP (`listOutputsForZip` reads `outputs` only, `workspace.ts:922-946`), while the per-job download URL still works.

**Never-surfaced states**
- **F2-H21**: `useJobRunner.status` holds the failure text after a failed run (:93, :271), but PdfView renders `status` only while `busy` (`PdfView.jsx:309, :598`) — post-failure the rail shows "Ready"; the error reaches the user only via the transient toast and `JobOutputCard`'s failed branch (`JobOutputCard.jsx:82-88`) if `displayJob` is the failed job.
- **F2-H22**: `job.retryable`/`errorCode` are serialized in `jobPublic` (`workers/jobs.ts:617-618`) but no PDF-side retry UI exists and the retry endpoint has no caller — never rendered or actionable in either traced view.
- **F2-H23**: `attemptCount`/`maxAttempts` (`workers/jobs.ts:615-616`) — never rendered in PdfView or ConverterView.
- **F2-H24**: progress-batcher comment vs behavior (`workers/jobs.ts:72`): "flush pending every 500ms" — no such timer; a final sub-5% delta with unchanged message is only flushed at settle (:1679), i.e. intermediate ticks can be withheld from DB/SSE until job end.
- **F2-H25**: `cancelRequested` is in `jobPublic` (:613) but neither view renders a "cancelling…" intermediate; ConverterView shows only queued/running/terminal badges (:1779-1795).

---

## Flow 3 — App startup workspace recovery + live workspace SSE subscription (incl. resumable-session recovery)

### Ordered call path

**Phase 0 — shell boot**
1. `src/main.jsx:7-11` renders `App` under StrictMode.
2. `src/App.jsx:54` `route` initialized from `getRoute()` (:48-51, hash → viewMap key); hashchange listener :80-84.
3. Health probe effect `App.jsx:65-78`: `api.health()` (`src/api/client.js:78` → `GET /api/health`, server `server/src/routes/system.ts:9-22`, in-memory only) at mount + 15 s interval (:73); result → `setApiOnline` (:69-70) → rendered in `Sidebar.jsx:9-10, :94-98` and `Topbar.jsx:14-15`.
4. `App.jsx:176-179` mounts `ConverterView` with `notify={setToast}`.

**Phase 1 — recover-or-create hydrate**
5. `ConverterView.jsx:63-75` calls `useWorkspace({ route: 'converter', notify })`.
6. `useWorkspace.js:11` seeds `workspaceId` synchronously from `localStorage['alphastudio-workspace-id']` (key :4).
7. Mount effect :56-58 → `hydrate()` (:24-54); re-entry guard `hydrating.current` (:25-26) suppresses the StrictMode second invoke.
8. `hydrate` → `api.recoverWorkspace` (`client.js:90-91`) → `POST /api/workspaces/recover` (`server/src/routes/workspaces.ts:49-53`).
9. Server: `ensureWorkspace` (`workspace.ts:187-196`) — existing active id → `touchWorkspace` UPDATE (:181-185); unknown/inactive id → `createWorkspace` INSERT (:165-175).
10. Server: `hydrateWorkspace` (`workspace.ts:677-764`): `touchWorkspace` again (:680), `listWorkspaceFiles` (:244-248), **DB write during read** — `verifyFileOnDisk` flips files missing↔ready (:254-268), jobs LIMIT 50 (:690-694) + `loadJobInputMeta` from `job_files` (:123-150), outputs LIMIT 50 (:699-711), activity LIMIT 50 (:713-728).
11. Client: `persistId(data.id)` (`useWorkspace.js:33` → :18-22, writes localStorage) + `setHydrated(data)` (:34). Failure path :36-49: toast, then `api.createWorkspace` + `api.getWorkspace` fallback (`POST /api/workspaces` `workspaces.ts:38-46`, GET :56-59); double failure → `setHydrated(null)` (:47).
12. `ConverterView.jsx:1216-1230` renders "Restoring workspace…" while `workspaceLoading && !hydratedOnce`.

**Phase 2 — hydrate-once merge into UI state**
13. `ConverterView.jsx:198-223`: `attachJobsToFiles(hydrated.files, hydrated.jobs)` (`liveState.js:234-254`, links jobs via `options._uploadIds`) → `setServerFiles(mergeWorkspaceSnapshot(...))` (:203, algorithm `liveState.js:315-399`); restores `groupSettings`/`hideCompleted`/`hiddenResultIds` from `toolSettings.converter` (:205-210), `resultFilter` from `ui.converterResultFilter` (:211-213); active jobs into `activeJobs` (:216-221); `setHydratedOnce(true)` (:222).

**Phase 3 — SSE subscription (dual transport, backoff)**
14. `ConverterView.jsx:191-195` `useWorkspaceEvents(workspaceId, ...)` — enabled as soon as `workspaceId` is truthy, i.e. from the stale localStorage id before recover confirms it (`useWorkspace.js:11`).
15. `useWorkspaceEvents.js:23-77`: `connect()` (:39-67) → `api.subscribeWorkspaceEvents` (`client.js:119-170`). Transport pick: `API_TOKEN` set → `subscribeViaFetch` (:127-134, parser :451-505); else native `EventSource` (:136); no token and no EventSource → silent noop (:120-122).
16. Server `GET /api/workspaces/:id/events` (`workspaces.ts:167-223`): 404 if workspace unknown (:169), CORS allowlist (:171-185), `reply.hijack()` + writeHead (:186-187), immediate `connected` event with fresh `nextEventVersion()` (:197-202), bus subscribe (:204-206; bus `workspace-events.ts:63-78`, `setMaxListeners(500)` :25), `: ping` every 25 s (:208-215), cleanup on socket close (:217-222).
17. Backoff: `onError` → drop unsub ref, `setTimeout(connect, backoff)`, backoff ×2 from 1000 ms capped at 15000 ms (`useWorkspaceEvents.js:4-5, :55-65`); `onOpen` resets backoff and fires `onReconnect` only after a prior successful open (:46-54).

**Phase 4 — event production (server) → merge (client)**
18. Producers: file events `insertFile` (`workspace.ts:340-347`), `markFileTerminal` (:378-386), finalize-ready (:488-496 — DB commit :470-483 before emit), `softDeleteFile` (:615-621); job events `emitJob` (`workers/jobs.ts:2017-2047`) — DB write first (`finish` :1983-2003, progress via batcher `jobs.ts:705-759` / `server/src/lib/progress-batch.ts:40`), then `emitWorkspaceEvent` with monotonic `version` (`workspace-events.ts:29-32, :34-61`).
19. Client dispatch: `onWorkspaceLiveEvent` (`ConverterView.jsx:114-166`) → `applyWorkspaceEvent` (`liveState.js:463-561`): delete events remove rows (:469-481), file upserts version-gated by `isNewerEvent` (:496-513, comparator :279-295), job events update the job map + reflect status onto linked files via `_uploadIds` (:517-557) → `setServerFiles`/`setActiveJobs` (:121-122).
20. Terminal-event re-hydrate: status ∈ completed/failed/cancelled (:124-125) → clear `convertingKeys` for the job's group (:127-135) → gated `refresh()` (`terminalRefreshPendingRef` :140-141) → GET hydrate (`useWorkspace.js:98-111`) → `attachJobsToFiles` + `mergeWorkspaceSnapshot` + rebuild `activeJobs` from queued/running only + `submitGuard.current.clear()` (:143-165).
21. Reconnect re-hydrate: `onWorkspaceReconnect` (:168-188) same refresh path, errors swallowed :185-187.
22. Poll fallback runs concurrently with SSE while any job is queued/running: 500 ms `setInterval` `getJob` loop (:392-464), reflecting progress onto files (:410-426) and doing its own terminal refresh (:427-451). *(Traced fully in Flow 2 step 21-22.)*

**Phase 5 — orphaned resumable sessions (forced pause + placeholders)**
23. `ConverterView.jsx:227-263` (after `hydratedOnce`): `api.listUploadSessions(workspaceId)` (`client.js:103-104` → `GET /api/upload-sessions?workspaceId=` `upload-sessions.ts:28-32` → `listWorkspaceUploadSessions` `upload-session.ts:201-211`, statuses uploading/paused/failed).
24. Any session still `uploading` → `api.pauseUploadSession` (`client.js:106` → `POST /api/upload-sessions/:id/pause` `upload-sessions.ts:57-60` → `pauseUploadSession` UPDATE `upload-session.ts:327-336`); pause failure falls back to `getUploadSession` (`ConverterView.jsx:236`).
25. Placeholder cards `id: session-<id>`, `localOnly`, `resumableMissingFile: true`, persisted `receivedBytes` progress (:238-256) → `setServerFiles` upsert (:258-260); rendered with "reselect this file to resume" (:1911) and no Resume button (:1936 requires `!resumableMissingFile`). Placeholder replaced when the same file is re-selected: `createResumableUpload` rediscovers the session via the localStorage key (`resumableUpload.js:3-4, :72-99`) and `onState` filters out the `session-<id>` row (`ConverterView.jsx:557-569`).

**Phase 6 — debounced PATCH autosave**
26. Persist effect `ConverterView.jsx:354-389` fires on any change of `groupSettings`/`serverFiles`/`resultFilter`/`hideCompleted`/`hiddenResultIds` → `save(patch)` (`useWorkspace.js:60-77`, 400 ms debounce, timer ref :15).
27. → `api.patchWorkspace` (`client.js:93-94`) → `PATCH /api/workspaces/:id` (`workspaces.ts:62-73`) → `patchWorkspace` transactional UPDATE of `workspaces.route/selected_file_ids/ui_json` + upsert `tool_settings` (`workspace.ts:624-664`) → response is a fresh `hydrateWorkspace` (`workspaces.ts:72`) → `setHydrated(data)` (`useWorkspace.js:68`) → re-render (results/jobs memos `ConverterView.jsx:267-273, :1008-1022`).

### Where state lives and every location allowed to mutate it

**Client — React/hook state**
- `workspaceId` (`useWorkspace.js:11`) — mutated :11 (init), :19 (`persistId`, called from :33, :42, :122 via `newWorkspace`).
- `hydrated` (:12) — mutated :34, :43, :47 (hydrate), :68 (debounced save), :86 (saveNow), :103 (refresh), :116 (clear), :124 (newWorkspace), :132 (removeFile); setter also exported :150 (unused by ConverterView).
- `loading` (:13) — :27, :51, :100, :109. `saving` (:14) — :65, :72, :83, :92.
- ConverterView `serverFiles`/`activeJobs`/refs — full mutation inventory in Flow 1; startup-specific writes: hydrate merge :203, session placeholders :259, hydrate jobs :216-221, `hydratedOnce` :222/:995.
- `groupSettings` (:78) — :208, :337-350, :747-750, :754, :983, :997. `convertingKeys` (:81), `resultFilter` (:84), `selectedResultIds` (:85), `hideCompleted` (:86), `hiddenResultIds` (:87), `zipBusy` (:88), `selectedGroupId` (:89), `selectedFileIds` (:91) — sites as listed in Flows 1-2.
- App shell: `route` (`App.jsx:54`; :81, :143), `apiOnline` (:60; :69-70), `toast` (:58; set via `notify` prop :178, cleared :123).

**localStorage**
- `alphastudio-workspace-id` — read `useWorkspace.js:11, :30`; write :20; remove :21. Sole writers.
- `alphastudio:upload:{workspaceId}:{name}:{size}:{lastModified}:{type}` — `resumableUpload.js:1-17`; set :97; removed :83, :158, :197 (and :80).
- `alpha-studio-theme` — `App.jsx:55, :88` (shell only).

**Server in-memory**
- Workspace event bus + 500-listener cap (`workspace-events.ts:24-25`); listeners added `workspaces.ts:204`, removed :217-222 (socket close).
- Monotonic per-process `seq` (`workspace-events.ts:27-32`) — incremented only in `nextEventVersion` (:30), called from `workspaces.ts:200` and `workers/jobs.ts:2018`; resets to 0 on server restart.
- Per-connection ping interval (`workspaces.ts:208-215`); progress-batcher closures (`jobs.ts:705-759`); `cancelFlags` (`jobs.ts:737, :755`); worker-pool stats read by `/api/health` (`system.ts:11`).

**SQLite** (schema `migrations.ts:107-176`, `upload_sessions` :28)
- `workspaces`: INSERT `workspace.ts:168-173`; UPDATE :181-185 (touch — from `ensureWorkspace:191`, `hydrateWorkspace:680`), :332-336 (insertFile tx), :608-612 (softDeleteFile), :647-649 (patchWorkspace), :773-776 (clearWorkspace), :783-785 (deleteWorkspace); DELETE :851.
- `tool_settings`: upsert :652-659; DELETE :776, :850.
- `files`: INSERT :294-313; UPDATE :256-266 (`verifyFileOnDisk` — during GET hydrate), :364-374 (markFileTerminal), :470-483 (finalizeFileAsync), :590-592 (updateFileDetect), :604-606 (softDeleteFile), :772 (clearWorkspace); DELETE :842, :1020, :1037.
- `uploads` mirror, `upload_sessions`, `upload_chunks` — sites as in Flow 1.
- `jobs`/`job_files`/`outputs` — written by the job engine (Flow 2); read into hydrate `workspace.ts:690-711`.

### Side effects: when they fire; double-fire / ordering

- **POST /api/workspaces/recover**: mount (`useWorkspace.js:56-58`); StrictMode second invoke suppressed by the `hydrating` ref (:25) — no double POST; re-fires if `notify`/`route` identity changes (:54 deps).
- **POST /api/workspaces + GET (fallback)**: only when recover throws (:39-41); creates a brand-new workspace row per failure; old id overwritten (F3-H3).
- **GET /api/health**: mount + 15 s interval (`App.jsx:67-73`); StrictMode → two initial probes; first interval cleared by cleanup; `cancelled` flag guards stale sets.
- **SSE connect**: on `workspaceId` truthy (`ConverterView.jsx:191-195`); StrictMode connect→cleanup→connect, first EventSource closed (`useWorkspaceEvents.js:71-76`), transient overlap window; error reconnect 1 s→15 s doubling (:59-64).
- **SSE `: ping`**: 25 s per connection (`workspaces.ts:208-215`); write errors swallowed :210-213.
- **GET hydrate via `refresh()`**: SSE terminal (`ConverterView.jsx:142`), poll terminal (:436), reconnect (:170), row cancel (:1813). Only the SSE path is gated (`terminalRefreshPendingRef` :140-141); poll and reconnect refreshes can run concurrently with it → interleaved `setHydrated`/`setServerFiles` with no ordering token. *(= F2-H6.)*
- **500 ms job poll** (:392-464): while `activeJobs` has queued/running; concurrent with SSE; poll upsert :412-425 lacks `isNewerEvent` (F2-H2/F3-H7).
- **`waitForFileReady` 200 ms poll per upload** (:603-639): concurrent with SSE; merge fn :623-634 guards only `existing.status === 'ready'` (F1-H8).
- **Debounced PATCH autosave**: 400 ms after last persist-effect trigger (:354-389 → `useWorkspace.js:60-77`). The timer is cleared on the next `save`/`saveNow` (:63, :82) but **not on unmount** (no cleanup for `saveTimer`) → a PATCH can fire after view unmount; `saveNow` in `startUploads` (`ConverterView.jsx:734`) can PATCH in parallel with the debounced save; a pending timer holds the old `workspaceId` closure across `newWorkspace` (:60-77 vs :120-126) (F3-H8).
- **POST pause per orphaned session**: session-recovery effect (:230-237); StrictMode double-run → duplicate pause POSTs (server-idempotent, `upload-session.ts:329`); effect re-runs on `workspaceId`/`hydratedOnce` change.
- **DB writes on read**: every recover/GET/PATCH hydrate runs `touchWorkspace` (`workspace.ts:680`) + `verifyFileOnDisk` UPDATEs (:254-268); missing↔ready flips emit **no** workspace event (F3-H15).
- **SSE emissions**: after each DB write (`insertFile:340`, `markFileTerminal:378`, finalize :489, `softDeleteFile:615`, `emitJob` `jobs.ts:2031-2043`); version-stamped; ordering guaranteed per-process only (`seq` resets on restart).
- **Server boot**: `resumeProcessingFiles` (`workspace.ts:47-67`) re-schedules or fails stale (>30 min → failed :59-61) processing files; one-shot per boot.

### State duplicated across locations and synced manually

1. **Workspace id** — localStorage `alphastudio-workspace-id` (`useWorkspace.js:4, :20-21`) + React `workspaceId` (:11) + SQLite `workspaces.id` (`migrations.ts:108`). Sync: `persistId` (:18-22) after recover/create; the server may silently swap ids (`workspace.ts:187-196`). *(= F1-D7.)*
2. **File list/status** — SQLite `files` + legacy `uploads` mirror (F1-D1) + client `serverFiles` + `serverFilesRef` (`ConverterView.jsx:77, :96-97`) + `hydrated.files` (`useWorkspace.js:12`). Sync: hydrate-once merge (`ConverterView.jsx:198-223`), SSE (`liveState.js:463-561`), snapshot merge (:315-399), per-upload poll (`ConverterView.jsx:603-639`).
3. **Job status/progress** — SQLite `jobs.status/progress` + `activeJobs` map + `activeJobsRef` + `hydrated.jobs` + reflected per-file fields `jobId/jobStatus/jobProgress` on `serverFiles` rows (`liveState.js:532-556`, `ConverterView.jsx:410-426, :814-824`) + DOM progress bars (:1763-1777, :1913-1928). Sync: SSE events, 500 ms poll, terminal refresh — three independent writers. *(= F2-D1.)*
4. **Converter settings** — React `groupSettings`/`hideCompleted`/`hiddenResultIds`/`resultFilter` + SQLite `tool_settings.settings_json` and `workspaces.ui_json` (`workspace.ts:643-659`). Sync: debounced PATCH up (`ConverterView.jsx:354-389`), hydrate-once down (:204-213) — later PATCH responses also overwrite `hydrated` (`useWorkspace.js:68`).
5. **Selected file ids** — derived per save from `serverFiles` (`ConverterView.jsx:356-358`) + SQLite `workspaces.selected_file_ids` (also mutated server-side by `softDeleteFile` `workspace.ts:608-612` and filtered at hydrate :686-688). *(= F1-D5.)*
6. **Resumable session progress** — SQLite `upload_sessions`+`upload_chunks` (authoritative) + localStorage session-id key (`resumableUpload.js:1-17`) + placeholder rows in `serverFiles` (`ConverterView.jsx:238-256`) + controller in-memory `session` object (`resumableUpload.js:64, :148-150`). Sync: list+pause effect on reload; localStorage key lookup on re-select. *(= F1-D3/D4.)*
7. **Event version** — server `seq` (`workspace-events.ts:27`) copied onto every client row (`liveState.js:500, :544`) and compared in `isNewerEvent` (:279-295); no reconciliation across server restarts.
8. **API liveness** — server truth vs `apiOnline` (`App.jsx:60`), refreshed every 15 s only.

### Race conditions, unhandled error paths, and never-surfaced states

**Races / ordering**
- **F3-H1 — EventSource leak + duplicate event delivery on parse error**: `client.js:153-161`: `onmessage` JSON.parse failure calls `onError` **without** `cleanup()` (only `es.onerror` :163-167 cleans up). `useWorkspaceEvents.js:55-64` then nulls its `unsub` reference and reconnects after backoff: malformed frame → onError → the hook drops the only reference to the still-open EventSource → timer → `connect()` opens a second EventSource → both fire `onEvent` (`closed=false`, `stopped=false`). Each recurrence adds another live connection. (Fetch-stream path unaffected: `client.js:495-501` always runs `cleanup()` in `finally`.)
- **F3-H2 — version comparison breaks across server restart**: server `seq` resets to 0 (`workspace-events.ts:27-32`); client rows keep pre-restart high `version` (`liveState.js:500, :544`); `isNewerEvent` short-circuits on numeric version inequality (:284-286), so post-restart events (version 1, 2, 3…) are dropped as stale — the comment at `liveState.js:546` claims "if versions reset after restart, allow newer updatedAt", but updatedAt is never reached when both versions are finite and unequal. Snapshot merges don't clear `version` either (`liveState.js:342-352, :375-390` spread `snap`, which has no `version` property, so the stale high `f.version` survives) — dropping persists after the reconnect re-hydrate. *(Applies equally to job events, F2-H3.)*
- **F3-H3 — silent workspace replacement on transient recover failure**: `useWorkspace.js:36-49`: any recover error (one 500 or a brief network blip) falls through to `createWorkspace`, and `persistId` (:42) overwrites `alphastudio-workspace-id` with the fresh empty workspace's id. The old workspace with all files remains in SQLite but is unreachable from the client; the only signal is the toast "Failed to restore workspace", auto-cleared after 2.6 s (`App.jsx:121-125`).
- **F3-H4 — SSE to a dead workspace id spins forever**: `ConverterView.jsx:191-195` enables SSE from the raw localStorage id (`useWorkspace.js:11`) before recover validates it. If that id 404s (`workspaces.ts:169`), EventSource errors → infinite 1 s→15 s reconnect loop (`useWorkspaceEvents.js:55-65`); no error is ever shown (the hook has no notify path). The loop persists until recover swaps `workspaceId`.
- **F3-H5 — terminal-refresh gate skips the second job's snapshot**: `ConverterView.jsx:140-141`: job A terminal event → `refresh()` in flight → job B terminal event arrives → the gate returns early → B's authoritative output row is absent from the already-started hydrate → B's Converted row shows no output until some other refresh/poll fires. The same handler runs `submitGuard.current.clear()` (:158) — F2-H4.
- **F3-H6 — stale PATCH response rolls back UI state**: `setHydrated` has four+ writers with no ordering (`useWorkspace.js:34, :68, :86, :103`). Interleaving: debounced PATCH in flight → job completes, SSE terminal → `refresh()` sets fresh `hydrated`, `activeJobs` drops the job (`ConverterView.jsx:151-157`) → the PATCH response (snapshot captured pre-completion) resolves last → `setHydrated(stale)` (`useWorkspace.js:68`) → `resultRows` (`ConverterView.jsx:1008-1022`) reads the job as running from `hydrated.jobs` (the activeJobs overlay no longer contains it) → the completed row flips back to "processing"; the poll effect won't run because `activeJobs` has no queued/running ids (:393-397).
- **F3-H7 — poll vs SSE progress regression**: = F2-H2 (poll upsert `ConverterView.jsx:412-425` uses default `upsertById` overwrite, no `isNewerEvent`).
- **F3-H8 — debounced save fires after unmount / against old workspace**: `saveTimer` (`useWorkspace.js:15`) has no unmount cleanup; a queued 400 ms PATCH executes after route change (state sets on the unmounted hook, network PATCH still lands, touching `last_seen_at`). The queued closure also captures the pre-`newWorkspace` `workspaceId` (:60-77 vs :120-126), so within a 400 ms window after "New workspace" a PATCH can target the abandoned workspace.
- **F3-H9 — cross-tab force-pause**: = F1-H3 (session-recovery effect pauses another tab's live upload; that tab's controller has `paused=false` so the 409 surfaces as `upload-failed`).
- **F3-H10 — missed-event window on reconnect**: no last-event-id/replay — events emitted between socket drop and re-subscribe exist only in the version counter (`workspaces.ts:197-206`); recovery relies wholly on the `onWorkspaceReconnect` refresh, whose errors are swallowed (`ConverterView.jsx:185-187`) — a failed reconnect-hydrate leaves the gap until the next terminal event/poll.

**Unhandled / swallowed errors**
- **F3-H11**: session-recovery list/pause chain `.catch(() => {})` (`ConverterView.jsx:261`) (= F1-H12); reconnect refresh :185-187; SSE-terminal refresh :160-162; poll loop :453-455 (= F2-H10/H11); `api.inspect` :602 and `waitForFileReady` :636-638 (= F1-H9/H10); SSE route write failures (`workspaces.ts:192-194, :210-213`); `emitJob` workspace-emission catch (`jobs.ts:2044-2046`). Note: `useWorkspace.refresh` itself toasts and falls back to `hydrate()` on failure (`useWorkspace.js:106-107`); the ConverterView catches swallow whatever escapes that.

**Loading/error states never surfaced**
- **F3-H12**: `loading` from `useWorkspace` is rendered only pre-hydrate (`ConverterView.jsx:1216`); every later `refresh()` toggles it (`useWorkspace.js:100, :109`) with no UI. Double hydrate failure leaves `hydrated=null`, `loading=false`, `hydratedOnce=false` → the full board renders as an empty functional workspace with header id "…" (`ConverterView.jsx:1333`); the only signal was a 2.6 s toast. `onClear`/`onNew` (:980-1005) have no try/catch — a rejected `clear()`/`newWorkspace()` from the button handlers is an unhandled promise rejection with no toast (`clear` `useWorkspace.js:113-118` has no catch).
- **F3-H13 — silently disabled live layer**: `client.js:120-122`: no `API_TOKEN` and no `EventSource` → subscribe returns a noop; `useWorkspaceEvents` gets neither `onOpen` nor `onError`, so no reconnect and no notification; with no active jobs the 500 ms poll never runs, and a file left `processing` at reload stays "Inspecting" indefinitely (its `waitForFileReady` poll exists only for files uploaded in the current session, `ConverterView.jsx:601-639`).
- **F3-H14 — workspace retention can expire under a live SSE client**: the SSE route never touches `last_seen_at` (`workspaces.ts:167-223`); an idle tab keeping only SSE + health polling lets `cleanupExpiredWorkspaces` (`workspace.ts:977-992`) soft-delete the workspace; the next autosave PATCH 404s (`workspace.ts:634`) → only a transient "Autosave failed" toast; the SSE connection stays open receiving nothing.
- **F3-H15 — `hydrateWorkspace` mutates during GET with no event**: `verifyFileOnDisk` flips files missing↔ready (`workspace.ts:254-268`) inside every hydrate but emits no workspace event, so other connected clients converge only on their own next snapshot.
