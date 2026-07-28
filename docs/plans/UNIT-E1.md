# Unit E1 — Convert hub detailed plan

## Objective

Replace the parallel legacy converter client with the config-driven Convert
workbench while preserving the audit parity surface: durable workspace
hydration, multipart and resumable uploads, detected grouping, batch plans,
inline failures, retry/remove, scoped cancellation, and single/ZIP downloads.

## Architecture

1. `src/hubs/convert.ts` remains data-only and declares the complete normative
   mode shape. It references only the published `converter.batch` capability
   and the `buildConvertJobOptions` builder.
2. `src/lib/convertJobOptions.js` converts group/selection plans into canonical
   `POST /api/jobs` payloads. It is pure, rejects incomplete plans, carries
   `_uploadIds` for reload/retry ownership, and never owns format literals.
3. `src/lib/converterGroups.js` remains the pure board/result model. Adapt only
   representation mismatches exposed by the new store (array jobs, normalized
   ids, persisted option shapes) and pin them with tests.
4. `src/next/hooks/useConvertWorkbench.js` is the React integration seam.
   Uploads go through `protocol/uploads.ts`; snapshots and optimistic overlays
   go through `protocol/store.ts`; HTTP is only through existing
   `api/client.js` wrappers. It owns ephemeral UI choices, not workspace truth.
5. `Workbench.jsx` consumes a controller contract, not a hub-name branch. The
   Convert controller supplies derived option state, attempt ids, callbacks,
   and the grouped/result presentation needed by the converter board. This
   extension is included here because D3 intentionally stopped at a callback
   boundary and E1 is the first operational hub.

## Correctness invariants

- Accepted file types and output targets come from capabilities/detect data.
- A retry creates a new job with a new client request id; terminal rows are not
  mutated.
- Cancel affects only active converter jobs touching the chosen attempt files.
- Reload recovery derives active attempt ids from the store and saved
  per-mode pointer; progress uses the store's monotonic 0–30/30–99/100 model.
- A failed job remains inline in Results with both Retry and Remove recovery.
- Batch ZIP includes only explicit completed output/job ids.
- Resume never invents a file row; it requires reselecting the matching local
  file before `createUploadTask` can adopt/continue the server session.

## Verification

- Unit tests: config/reference validation, payload builder, grouping/result
  normalization, duplicate prevention, selection/all planning, retry identity.
- Existing client suite, typecheck, build with both UI flag values.
- Structural and deterministic visual gates.
- Browser walkthrough at `#/convert` in dark/light and desktop/mobile, covering
  empty, uploaded/grouped, active, completed, and failed result states.
- Spec review after the implementation commit; all blockers fixed before merge.
