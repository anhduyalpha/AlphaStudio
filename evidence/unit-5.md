# Evidence — Unit 5 (B2) `src/protocol/store.ts`

- Date: 2026-07-26
- Branch: `unit-5-b2-protocol-store`
- SPEC: §3.2 (store row), §6.1 (state table + sanctioned keys), §6.2 (mutation
  rules), §6.3 (merge semantics), §6.5 items 2/3/5, §2.2 (composed progress —
  §6.3 extends the monotonic rule to it)
- Detailed plan (flagged unit): `docs/plans/UNIT-B2.md`

## Changes

- `src/protocol/store.ts` (new) — the single client state owner. One version
  gate (`acceptsWrite`) and two row merges (`mergeJob` / `mergeFile`) sit under
  **all four** write paths: `hydrate`, `applyEvent`, `applyPoll`, and the
  optimistic overlay. Also owns the persisted workspace id, the per-hub+mode
  job-resume pointers, upload-session mirror, and the §2.2 composed value.
- `src/next/hooks/useStore.js` (new) — `useSyncExternalStore` binding, subscribe
  only, cached per (snapshot, selector) so a snapshot change that does not
  affect a selector cannot re-render its component. Under `src/next/` per
  PLAN's transitional namespace rule (the final `src/hooks/useStore.js` path
  collides with the live old client until F1).
- `docs/plans/UNIT-B2.md` (new) — required for a flagged unit; records the
  design decisions a reviewer should challenge (layered overlay, per-row gate
  seeded by snapshot seq, non-blind wholesale hydrate, terminal-immutability
  scope, recovery policy change).

Behavior deliberately changed rather than ported: `hooks/useWorkspace.js`
auto-created a replacement workspace whenever recovery failed, silently
orphaning the user's workspace (hazard F3-H3). SPEC §6.5 item 5 forbids that —
the store now keeps the persisted id, surfaces a persistent error, retries with
backoff, and creates a workspace only through the explicit `createWorkspace()`
action.

## Test-first proof (PLAN B2: "the merge-semantics suite is written **before** the merge implementation")

Both suites were written first and run against a non-existent module:

```
 FAIL  src/tests/protocol-store-merge.test.ts [ src/tests/protocol-store-merge.test.ts ]
Error: Cannot find module '/src/protocol/store.js' imported from C:/Users/Duy/Code/Project/AlphaStudio/src/tests/protocol-store-merge.test.ts
 ❯ src/tests/protocol-store-merge.test.ts:42:5

 FAIL  src/tests/protocol-store-state.test.ts [ src/tests/protocol-store-state.test.ts ]
Error: Cannot find module '/src/protocol/store.js' imported from C:/Users/Duy/Code/Project/AlphaStudio/src/tests/protocol-store-state.test.ts
 ❯ src/tests/protocol-store-state.test.ts:49:5

 Test Files  2 failed (2)
      Tests  no tests
```

The first implementation run then failed one case — recorded because it is the
bug the suite existed to catch, not a formality:

```
 FAIL  src/tests/protocol-store-merge.test.ts > poll and SSE cannot regress each other (SPEC §6.3)
       > discards a poll payload older than the row (row-level updatedAt fallback)
AssertionError: expected 'queued' to be 'running' // Object.is equality
 Test Files  1 failed | 1 passed (2)
      Tests  1 failed | 51 passed (52)
```

Cause: `applyEvent` stamped rows with the **envelope's** `updatedAt` (minted at
emit time) instead of the row DTO's. A stale poll then tied on the timestamp and
was accepted as an idempotent refresh, regressing `running` → `queued`. Fixed by
building the write token from the row's own `updatedAt` when a DTO is attached
(envelope time is the fallback) — §6.3's gate is per row.

## Gate 1 — unit completion commands (PLAN: `npm run test:client` · `npm run typecheck`)

### `npm run test:client`
```
> alphastudio@3.6.0 test:client
> vitest run

 RUN  v4.1.10 C:/Users/Duy/Code/Project/AlphaStudio

 Test Files  5 passed (5)
      Tests  91 passed (91)
   Duration  442ms
EXIT=0
```

The §7.2 unit list for this module, all in the 52 new cases:
epoch change (adopt + wholesale re-hydrate, no stacked resync, rows that
overtook an in-flight response survive, rows the snapshot dropped are removed) ·
seq regression (lower seq discarded even carrying higher progress; pre-snapshot
events discarded; discarded writes do not notify subscribers) · poll/SSE
non-regression both directions · monotonic progress (value clamped, rest of the
write still applied, retry restarts at 0, upload progress monotonic) · terminal
immutability (late progress dropped, second terminal status refused, enrichment
still merges) · optimistic overlay (local row, re-applied after re-hydrate,
collapses to one row, requested-flag without status patching, refused on a
terminal job, resolved by response / terminal state / timeout).

### `npm run typecheck` (server + client TS projects)
```
> alphastudio@3.6.0 typecheck
> tsc -p server/tsconfig.json --noEmit && tsc -p tsconfig.client.json --noEmit
EXIT=0
```

## Gate 2 — deterministic visual checks

```
> node scripts/visual/run-checks.mjs

PASS    token-purity (§4.6) [1 file(s)]
PENDING motion-purity (§5.2/§5.3) — no CSS yet under src\styles (built by units C1+/F0)
PENDING contrast (WCAG AA on §4.1 tokens) — src/styles/tokens.css not built yet (unit C1)
EXIT=0
```

Note: token-purity moved from PENDING (unit 1) to PASS because creating
`src/next/` puts the check into its transitional mode, where it scans the new-UI
JSX scope (`src/next`, `src/workbench`) — `useStore.js` is the one file. The two
PENDING targets are `src/styles/` CSS, built by C1/F0; B2 builds neither.

## Gate 3 — screenshot capture + diff

```
[visual:capture] booting API (http://127.0.0.1:16787) + client (http://127.0.0.1:16173, VITE_UI=next)
[visual:capture] captured=1 missing=268 → visual\captures
[visual:capture] missing targets are pending build units (see report.json), not failures
EXIT=0

[visual:diff] PASS — 0 baseline(s) verified, 1 capture(s) accounted for.
EXIT=0
```

No baseline accepted: B2 introduces no UI surface. The single capture is
`smoke--home.png` (the old client's home), which this unit neither builds nor
changes; the 268 missing targets belong to later units.

## Gate 4 — visual judge

Not applicable: zero captures belong to this unit. B2 is a protocol module plus
a headless `useSyncExternalStore` binding — it renders nothing, so there is no
artifact to judge and no SPEC §4 criterion that references one. Nothing was
given to the judge; nothing that exists was skipped.

---

# Step 7 — spec review (two rounds)

The first review was interrupted before reporting; it was later completed and
returned **4 confirmed defects**, each re-verified against the source by hand
before any fix (one finding its own adversarial pass had *rejected* was real,
so the verdicts were not taken at face value). A second review, run against the
fixed diff, confirmed all four fixes and raised **5 further findings**. All nine
are fixed and pinned by named tests.

## Round 1 — four defects (commit 1bf924a, tests 20520cf)

| # | Defect | SPEC | Fix |
|---|---|---|---|
| 1 | `jobRank` ranked `completed` (1) below `failed`/`cancelled` (2), so a successful retry handed its file back to the dead attempt: composed value fell 99 → 30 and could never reach 100 | §6.5 item 3, §2.2 | All terminal outcomes rank alike; the existing `createdAt` tie-break picks the newest attempt — which is what the doc comment always claimed |
| 2 | `hydrateInFlight` was cleared only by the generation-owning hydrate, but `createWorkspace()` bumps `generation` — the flag could strand at `true` and `requestResync()` then swallowed every epoch change for the life of the page | §6.4 | Generation-keyed `hydrateGeneration`, released in `finally` by both `hydrate()` and `createWorkspace()`, plus `resyncPending` to replay a suppressed resync |
| 3 | `removeFile` deleted the row's version with the row, and `mergeFile` gated only `if (prev)`, so any later write — including a provably older one — resurrected it | §6.3 | `removedFiles`/`removedJobs` tombstones consulted by both merges; snapshot pruning stamps one carrying the snapshot's stream position **and** the row's last-applied time |
| 4 | `applySnapshot` reassigned `state.epoch` before testing `epoch === state.epoch`, so the reset branch was unreachable and the old epoch's `seq` carried forward | §6.4 | `epochChanged` captured before adoption |

## Round 2 — five findings on the fixed diff

| # | Finding | SPEC | Fix |
|---|---|---|---|
| 5 | `applyEvent` adopted a **first-seen** epoch silently — no ordering-state drop, no re-hydrate. A cold boot whose hydrate raced a server restart then had its stale pre-restart snapshot pull the store back onto the dead epoch, where on an idle workspace no later event ever disagreed | §6.4 ("**unknown**/changed epoch"), §6.5 item 4 | The unknown-epoch branch now drops ordering state and requests a resync, exactly like the changed-epoch branch |
| 6 | `acceptsWrite` returns `true` on identical tokens (idempotent refresh) — correct for a live row, wrong for a tombstone, since §6.3 accepts a write only *iff it is newer* and a tie is not newer. An in-flight unversioned poll carrying the row exactly as it died resurrected it | §6.3 | `acceptsWrite(prev, next, strict)`; `priorVersion` reports whether the prior came from a tombstone, and a tie loses in that case |
| 7 | `createWorkspace`'s `finally` **discarded** a suppressed resync, re-opening the same wedge on the failure path | §6.4, §6.5 item 4 | Replayed when creation threw (nothing landed); treated as satisfied when it succeeded (the fresh snapshot already carries server truth) |
| 8 | `resolveActiveJob` forgot the resume pointer when the mirror was empty — but an empty mirror means "not hydrated yet", not "the server dropped it". A mount-effect read erased the pointer for a job the server was still running | §6.5 item 2 | Returns `null` without forgetting while `state.hydratedAt === null` |
| 9 | `optimisticRequest` refused **every** flag on a terminal job, but §6.2 permits `delete`/`convert` flags and a finished row is exactly where those two buttons live — the button showed no busy state, so a second click started a second attempt | §6.2 | Refusal scoped to `cancel`, the one flag that contradicts a frozen status |

The round-2 reviewer's remaining notes were recorded rather than actioned:
`POST /api/jobs/:id/retry` (same-row retry) is unusable by the new client
because terminal immutability discards it — documented in
`docs/plans/UNIT-B2.md` as a constraint on E1/E2; F2's step-7 assertion must be
written against a composed 30, not 0 (§2.2's job band wins over the step prose);
and the tombstone maps grow with deletes over a long session (memory only).

## Mutation verification of all nine fixes

Each defect was re-introduced one at a time and the suite re-run, then
`store.ts` restored byte-for-byte (verified). Every mutation is caught by a
named test — the tests pin the fixes rather than merely passing beside them:

```
CAUGHT  M1 jobRank: rank completed below failed/cancelled
         ↳ reaches 100 rather than falling back to the failed attempt
CAUGHT  M2 tombstone: gate files on the live row only
         ↳ refuses to resurrect a deleted file from an older write
CAUGHT  M3 load flag: key release on generation, drop createWorkspace claim
         ↳ releases it when createWorkspace overtakes an in-flight hydrate
CAUGHT  M4 epoch: compare after adopting, so the reset branch is dead
         ↳ takes the new epoch position instead of carrying the old one forward
CAUGHT  N1 applyEvent: adopt a first-seen epoch silently
         ↳ requests a re-hydrate for a first-seen epoch instead of adopting it silently
CAUGHT  N2 acceptsWrite: let a tie beat a tombstone
         ↳ refuses an unversioned poll carrying the row exactly as it died
CAUGHT  N3 createWorkspace: discard a suppressed resync
         ↳ replays it when creation throws
CAUGHT  N4 resolveActiveJob: forget the pointer before hydrate
         ↳ does not forget a pointer just because the mirror is still empty
CAUGHT  N5 optimisticRequest: refuse every flag on a terminal job
         ↳ records delete and convert, the two actions a finished row offers

store.ts restored: true
every defect caught: true
```

# Post-fix gate re-run (all four, in order)

```
npm run test:client      Test Files 7 passed (7) · Tests 110 passed (110)   EXIT=0
npm run typecheck        tsc server/tsconfig.json && tsc tsconfig.client.json  EXIT=0

npm run visual:checks
PASS    token-purity (§4.6) [1 file(s)]
PENDING motion-purity (§5.2/§5.3) — no CSS yet under src\styles (built by units C1+/F0)
PENDING contrast (WCAG AA on §4.1 tokens) — src/styles/tokens.css not built yet (unit C1)
                                                                  EXIT=0

npm run visual:capture   captured=1 missing=268 → visual\captures   EXIT=0
npm run visual:diff      PASS — 0 baseline(s) verified, 1 capture(s) accounted for.  EXIT=0
```

Both PENDING lines name `src/styles/`, which unit C1 builds; B2 builds no CSS,
so neither is this unit's target. Gate 4 remains not applicable — B2 still
renders nothing, and no baseline was accepted.
