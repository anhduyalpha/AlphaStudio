# UNIT-B2 — `src/protocol/store.ts` (detailed plan)

PLAN.md flags B2 for its own plan because it pairs with B3 (`events.ts`, the
sole event source) and because it is the single client state owner: every
regression hazard the audit filed under "two writers disagree" dies here or
not at all. This document is the plan; SPEC.md wins on any wording difference.

## Goal

One module owning all client workspace/job/upload-session state, the persisted
workspace id, and the per-hub+mode job-resume pointers, with **one** versioned
merge on every write path (hydrate · SSE event · poll · optimistic), plus a
React binding in `src/next/hooks/useStore.js` that only subscribes.

Cited: SPEC §3.2 (store row), §6.1 (state table + sanctioned keys), §6.2
(mutation rules), §6.3 (merge semantics), §6.5 items 2/3/5, §2.2 (composed
progress — §6.3 makes the monotonic rule govern the composed value too).

Inert until F1: nothing imports it yet (B3/B4/D-track do).

## Interfaces this unit merges against (read, not changed)

- Snapshot (`versionedSnapshot` in `server/src/routes/workspaces.ts`, A2):
  `hydrateWorkspace()` + `{ epoch, seq }`. Fields used: `id`, `route`,
  `selectedFileIds`, `ui`, `files[]`, `jobs[]`, `outputs[]`. `activity[]` is
  deliberately **not** mirrored — §3.2 makes Activity a view concern read
  through `api/client.js`.
- Event envelope (`WorkspaceEvent`, A2): `{ type, workspaceId, fileId, jobId,
  status, stage, progress, message, updatedAt, version, epoch, seq, file, job }`.
  Types actually emitted: `connected`, `file.created`, `file.updated`,
  `file.deleted`, `job.created`, `job.progress`, `job.updated`.
- Job DTO (`jobPublicDto`): `id, type, tool, status, progress, message, error,
  options (incl. `_uploadIds`), meta, outputName, outputMime, downloadUrl,
  createdAt, updatedAt, startedAt, finishedAt, cancelRequested, category`.
- File DTO (`filePublic`): `id, originalName, mime, size, ext, checksum,
  fingerprint, duplicateOf, status, detect, downloadUrl, previewUrl,
  createdAt, updatedAt`. **No `jobId`** — the file→job link only exists
  through `job.options._uploadIds` (why the store keeps a reverse index).
- Upload session DTO (`uploadSessionPublic`): `id, workspaceId, originalName,
  mime, size, chunkSize, totalChunks, receivedChunks, receivedBytes,
  nextMissingIndex, status, fileId, lastError, createdAt, updatedAt, expiresAt`.

## Design decisions (the ones a reviewer should challenge)

1. **Layered state, not flattened.** Server rows and the optimistic overlay are
   stored separately; `getSnapshot()` composes them. §6.3's "optimistic overlays
   re-applied on top" after a re-hydrate is then free, and §6.2's "optimistic
   state may never overwrite a server-terminal status" is enforced in one place
   (the compose step) instead of at every write site.
2. **The version gate is per row, seeded by the snapshot's seq.** A write is
   accepted iff: same epoch and `seq` > the row's last-applied seq; or no
   comparable seq and `updatedAt` > the row's; or the tokens are identical
   (idempotent refresh — no ordering conflict, and the monotonic/terminal rules
   below still govern status and progress). Anything older is discarded. Rows
   from a snapshot are stamped with the snapshot's `seq`, so a live event that
   overtook an in-flight hydrate is not regressed by the late response.
3. **Hydrate is wholesale but not blind.** It rebuilds the row set from the
   snapshot (rows absent from it are dropped) except rows whose last-applied
   seq is newer than the snapshot's — those were created by an event that
   overtook the response, and dropping them would flicker a just-created row.
   Every surviving row still passes through the same gate.
4. **Epoch change re-hydrates.** `applyEvent` with an unknown/changed epoch
   drops ordering state, adopts the new epoch, and triggers `hydrate()`
   (generation-guarded so a stale response cannot land). Events keep applying
   under the new epoch meanwhile — they are the newest truth available.
5. **Terminal immutability is about status and progress, not enrichment.** Once
   a job is `completed/failed/cancelled`, later writes may not change `status`
   or `progress`; other fields (`meta`, `downloadUrl`, `outputName`) still merge
   if the write is newer. A late `job.progress` for a terminal job is discarded
   whole (§6.3).
6. **Progress monotonicity is per job row = per attempt.** Retry creates a new
   job row (§6.3), so the floor resets naturally. The composed §2.2 value keeps
   its floor keyed by `(fileId, owning jobId)` for the same reason — e2e step 7
   requires a retried attempt to restart at 0.
7. **Workspace recovery never self-heals destructively** (§6.5 item 5): a failed
   `recoverWorkspace` sets a persistent `error` and schedules a backoff retry;
   it never removes `alphastudio-workspace-id` and never calls
   `createWorkspace`. Creating a replacement is an explicit action
   (`createWorkspace()`), i.e. a user act. This is a deliberate behavior change
   from `useWorkspace.js`, which auto-created on failure (hazard F3-H3).
8. **The resume pointer stores a bare job id.** The §6.1 key
   `alphastudio-active-job:<hubId>:<modeId>` holds the id only; the expected-type
   guard (§6.5 item 2) is applied at resolve time against the hydrated job row,
   so a pointer to a job of the wrong type resolves to `null` and is dropped.
   No new value schema, nothing to migrate.
9. **No React, no components, no format literals** (§3.2). HTTP only via
   `api/client.js`. `useStore.js` is the only React-aware file in this unit.

## Ordered steps

1. Write `src/tests/protocol-store-merge.test.ts` **first** (the §7.2 list:
   epoch change, seq regression, monotonic progress, terminal immutability,
   optimistic overlay) and watch it fail — PLAN B2 characterization requirement.
2. Types + snapshot shape (`StoreSnapshot`, `FileEntry`, `JobEntry`,
   `UploadSessionEntry`, `PendingRequest`).
3. Storage adapters for the two sanctioned keys (§6.1), guarded so a
   non-browser/denied-storage environment degrades to memory instead of throwing.
4. The single `applyWrite` merge + the gate helpers.
5. Write paths on top of it: `hydrate`, `applyEvent`, `applyPoll`,
   `optimistic*`, `setUploadSessions`.
6. Selectors: files/jobs/sessions, composed §2.2 progress, run-bar mean,
   active-job resolution.
7. `src/next/hooks/useStore.js` — `useSyncExternalStore` binding with a cached
   selector so a selector returning a fresh object cannot loop.
8. Second test file for the store's non-merge surface (storage keys, workspace
   recovery policy, resume pointer, composed progress).

## Risks

| Risk | Mitigation |
|---|---|
| `useSyncExternalStore` infinite loop from a non-stable snapshot | snapshot is rebuilt only when a write changes state; selector results memoized per snapshot in the hook |
| Storage unavailable (Safari private mode, denied) | every storage touch wrapped; failure degrades to in-memory, never throws into a render |
| Hydrate racing live events | generation guard + per-row seq gate (decisions 2/3) |
| Optimistic flag leaking forever if a response never arrives | each pending request carries a deadline and a timer that resolves it (§6.2 "server response **or timeout**") |
| Over-reach into B3/B4 territory | store exposes `applyEvent`/`setUploadSessions` and owns no transport: no SSE parsing, no chunk logic, no job payload construction |
| No DOM in the client harness (`environment: 'node'`) | store is DOM-free by design; storage is injected/stubbed in tests. `useStore.js` is structurally reviewed, not unit-tested — its React binding is exercised by D-track units and F2 |

## Test plan (`npm run test:client` · `npm run typecheck`)

`src/tests/protocol-store-merge.test.ts` — the §7.2 merge list:
- epoch change → wholesale re-hydrate, ordering state dropped, new epoch adopted
- seq regression → discarded (same epoch, lower seq)
- poll cannot regress SSE and vice versa (row `updatedAt` fallback)
- monotonic progress → lower progress for the same attempt discarded; a new
  attempt (new job row) legitimately starts at 0
- terminal immutability → late progress/status writes discarded; enrichment merges
- optimistic overlay → applied on top, never over a server-terminal status,
  resolved by response and by timeout, re-applied after re-hydrate

`src/tests/protocol-store-state.test.ts` — the rest of the acceptance:
- §6.1 exactly the two sanctioned keys are touched, and only those
- §6.5 item 5 recovery failure keeps the id, surfaces the error, retries, never
  auto-creates
- §6.5 item 2 resume pointer round-trip incl. the wrong-type guard
- §2.2 composed progress mapping (0–30 upload / 30–99 job / 100 complete),
  batch mean, and no regression across an attempt
- file→job reverse index via `options._uploadIds`; `file.deleted` removes the
  row instead of resurrecting a ghost

`src/tests/protocol-store-regressions.test.ts` and
`src/tests/protocol-store-review.test.ts` — one case per defect the two spec
reviews confirmed. Every one is mutation-verified: re-introducing the defect
fails a named test. See `evidence/unit-5.md` for the table and the runs.

## Constraints this unit imposes on later units

- **Retry must create a NEW job row.** Terminal immutability (§6.3) makes the
  store discard the `failed → queued → running → completed` sequence of a
  *same-row* retry forever, so a successful retry would never surface. That puts
  `POST /api/jobs/:id/retry` off-limits to the new client. SPEC §6.3 mandates
  new-row retries and the pre-rebuild client already complies
  (`ConverterView.jsx` retries by creating a job), but E1/E2 must not "simplify"
  to the same-row endpoint.
- **A queued retry composes to 30, not 0.** For an already-uploaded file the
  §2.2 job band starts at 30, so F2's §7.3 step-7 assertion must be written
  against 30. §2.2's normative composition wins over the step's prose.
- **Ownership of a file follows the newest attempt**, not the most "alive"
  status: all terminal outcomes rank alike and `createdAt` breaks the tie. A hub
  showing per-file progress gets the newest attempt's value by construction.
