# AUDIT — Synthesis and rewrite decision

Sources: AUDIT-metrics.md, AUDIT-arch.md, AUDIT-flow.md, AUDIT-ui.md only. No source code was read in this phase. Where those reports lack the evidence to make a call, that is stated instead of guessed.

---

## 1. Root causes

Most of the ~90 concrete findings across the four reports reduce to three underlying problems. Symptoms are listed under each cause to keep the two separated.

### RC1 — The converter surface was built as a second, parallel client instead of extending the shared layer

The client has a real extraction layer (`src/api/client.js`, `src/hooks/useJobRunner.js`, `src/lib/liveState.js`) and ten views consume `useJobRunner` (AUDIT-arch §2, verified count). The single most complex view, `src/views/ConverterView.jsx` (1972 LOC, churn 6, ~50% non-presentation logic), bypasses all of it and re-implements uploads, job creation, polling, dedupe, retry, and SSE application inline (AUDIT-arch §2.1, §3.2). Because the parallel implementation lacks the safeguards the shared one has, most of the flow hazards concentrate there.

Symptoms explained by this cause:
- Three upload→create→wait pipelines (`api.runJob`, `useJobRunner.run`, ConverterView's own stack — AUDIT-arch §4.1) and two retry mechanisms (server `retryJob` with zero callers vs client new-row `retryFailed` — AUDIT-flow F2 step 25).
- The poll path writes without the version gate the SSE path has → progress regression races F2-H2/F3-H7, and stale-PATCH rollback F3-H6.
- Client and server disagree on what a duplicate job is (`hasActiveDuplicateJob` vs `findActiveDuplicateJob` — AUDIT-arch §4.4), and `submitGuard` mass-clear (F2-H4) reopens the double-submit window.
- Triplicated refresh-merge blocks inside ConverterView itself (AUDIT-arch §4.14), poll-interval churn (F2-H7), dual terminal-refresh channels (F2-H6).

### RC2 — Shared contracts have no single source of truth; knowledge is copy-pasted across layers and drifts

The same fact is hand-maintained in multiple places on both sides of the wire, with measurable drift in nearly every instance:
- Format/extension/MIME classification: 7 server + 4 client copies (AUDIT-arch §4.5). Concrete drift: `classifyJobCategory`'s `MEDIA_FORMATS` omits `wma/mpeg/mpg/wmv/m4v/flv` and `IMAGE_FORMATS` omits `heif/ico`, so those jobs classify as `general` instead of `media`/`image` (the reports document the misclassification itself; its downstream scheduling effect is inference).
- Audio quality presets: client resolves `max` → *balanced* while the server resolves `max` → *high* (AUDIT-arch §4.6) — same input, different output quality by layer.
- Capability/op catalogs restated client-side (`PdfView.jsx` GROUPS, `GATED_OP_IDS`), endpoint paths hand-mirrored in `client.js`/`resumableUpload.js` (AUDIT-arch §4.8).
- External tool resolution: five probe implementations across three stacks with *inverted precedence order* between `server/src/tools/registry.ts` (configured→project→PATH) and `scripts/maint/lib/tools-probe.mjs` (system-first) and three writers of `.runtime/config.json` (AUDIT-arch §4.9).
- Path confinement ×4, chunked SHA-256 ×3, job-row purge ×3 + two near-identical expired-workspace sweepers on the same 15-minute timer (AUDIT-arch §4.10–4.12); `db-repair.mjs`'s fallback DDL lacks the `result_json` column the server SQL uses (AUDIT-arch §3.2).
- Durability contract violated by design in one spot: the client treats the server's in-memory event `seq` as a durable ordering token, but it resets on restart, permanently wedging `isNewerEvent` (F3-H2) — a state-sync bug that follows directly from duplicating ordering knowledge without owning it anywhere.
- The `files` table has a legacy `uploads` mirror dual-written in three transactions and read inconsistently (AUDIT-flow F1-D1).

### RC3 — UI generations accrete without deletion, and server-side structural tests pin the abandoned layers in place

`src/styles.css` (5,421 LOC — largest file in the repo, highest non-doc/non-state churn at 15) contains two design systems: lines ~98–4218 use nearly all-raw values; the post-4220 "redesign foundations" sections are tokenized (AUDIT-ui §4a). The old generation was never removed: 21+ variant classes are fully styled (many animated) with zero JSX usage, 7 class names have two competing definition sites, entire dead animation subsystems remain (AUDIT-ui §3, §6c), and dead components (`AgentFanOut`, `IconButton`, `FileDropzone`, `FeatureButton`, `IllustrationCard`) plus the orphaned `ModularWorkspaceView`/`extraToolConfigs` pair survive because ~30 `server/tests/ui-*-struct.test.ts` files read client source text and assert on it (AUDIT-arch §1.2, AUDIT-ui §1b, appendix item 11). Deletion is not merely neglected — it is actively test-blocked from the wrong layer.

Symptoms explained: 31 button / 30 card / 15 input treatments (AUDIT-ui §3), ~1,447 raw CSS values vs 134 spacing/radius/typography token references outside token blocks (§4a–4b), four different hardcoded fallbacks for `--accent` (§4b), duplicated motion resolvers with a no-op device heuristic in both copies (§6b), and the unmounted activity-pause mechanism (§6b, appendix 6).

Not a root cause but a cross-cutting gap: **no coverage tooling exists, e2e has 13 cases, and client `src/` has no unit-test harness at all** (AUDIT-metrics §6) — which is why the safety-net column in §5 matters more than usual.

---

## 2. Keep — working as-is, should survive untouched

- **Job-engine invariants** (`server/src/workers/jobs.ts` claim/lease/settle core): atomic claim with lease, lease-guarded terminal writes, output confinement + validation, restart recovery, and cancel-beats-result — noting that AUDIT-flow F2-H5 documents the cost of that last invariant (a cancel landing in the delivery window discards finished work); it should be preserved knowingly, not by accident. AUDIT-arch §3.1 found the IPC/ProcessContext boundary "not bypassed"; AUDIT-flow's hazards in this area are mostly client-side, with server-side exceptions F2-H5, F2-H8 (create-gate checks only `uploads[0]`), F2-H20 (swallowed `registerJobOutput` failure), and F2-H24 (batcher comment vs behavior). 704 server test cases lean on it. The *file* is oversized (2,442 LOC) — that's a structure problem (§3), not a behavior problem.
- **PDF operation contract** (`server/src/pdf/operation-contract.ts`): backend-authoritative, published via capabilities, enforced at create; cleanest seam in the repo (AUDIT-arch §3.1).
- **SQLite ownership** (`server/src/db/index.ts`): single connection, only runtime importer of better-sqlite3 (AUDIT-arch §3.1). The *raw SQL sprawl* on top of it (41 prepares in jobs.ts, 53 in workspace.ts) is addressed in §3, but the connection model itself is right.
- **Server-side resumable upload protocol** (`server/src/services/upload-session.ts`): idempotent chunk PUTs, guarded finalize lock, crash-heal via `files.upload_session_id`, UUID-confined staging (AUDIT-flow F1 steps 10–16). The serious hazards in that flow are predominantly client-side handling; two server-protocol findings do exist and should be tracked, not lost — F1-H4 (a chunk can commit into a just-paused session) and F1-H16 (the idempotent chunk path discards the request body without re-verifying it).
- **The thin-view pattern**: `useJobRunner` + `buildMediaJobOptions`/`buildPdfJobOptions`/`imageCrop` with Audio/Media/Image/Text as consumers (AUDIT-arch §2.2, §4.15). This is the model the rest of the client should converge on — it already works.
- **Client HTTP transport ownership**: `fetch(` exists only in `src/api/client.js`; no component bypasses it for requests (AUDIT-arch §3.1).
- **The token system + motion architecture as a direction**: the post-4220 token set, `html[data-motion]` gating, `motion-modes.css` and the pre-paint bootstrap are coherent (AUDIT-ui §4a, §6b). The problem is the 4,100 lines that predate them, not the system itself.
- **Accessibility behaviors**: focus traps, roving tabindex, aria-live/status wiring exist broadly (AUDIT-ui §1, §5). Implementations should be merged (three copies of the trap), but the behavior must not be simplified away.
- **The server node:test suite** (704 cases): it is the only meaningful regression net in the repo and every step in §4 depends on it staying green.

---

## 3. Per-area verdicts

| Area | Verdict |
|---|---|
| A. Server job engine (`workers/jobs.ts`, `worker-process.ts`, `ipc.ts`) | **Restructure in place** |
| B. Converter/engine layer (`processors/converter.ts`, `convert/matrix.ts`, `convert/engines/*`) | **Restructure in place** |
| C. Shared contract knowledge (formats/MIME/quality/capabilities/endpoints) | **Restructure in place** |
| D. ConverterView + client live-state sync (`ConverterView.jsx`, `liveState.js`, poll/SSE application) | **Rewrite** |
| E. Client event transport (`client.js` SSE paths, `useWorkspaceEvents.js`, server `workspace-events.ts` versioning) | **Restructure in place** |
| F. Design-system CSS (`styles.css`, `animations/*.css`) | **Rewrite** |
| G. UI primitives in JSX (buttons/rows/tablists/traps/dead components + `ui-*-struct` test pinning) | **Restructure in place** |
| H. Tool resolution (`server/src/tools/registry.ts` vs `scripts/maint/lib/tools-probe.mjs` vs `setup-tools.mjs`) | **Restructure in place** |
| I. PDF subsystem, Python bridge, db connection layer, server upload protocol, maint clean/clear/reset | **Leave alone** |

**A — restructure in place.** Split `workers/jobs.ts` (2,442 LOC) into claim/schedule/settle/GC modules behind its existing exports; fold the three job-row purge sites and the two near-identical sweepers (AUDIT-arch §4.12) into one owner; move the raw-SQL bypasses (`routes/activity.ts` stats, `workspace.ts` hardPurge) behind the engine's API. Not a rewrite: the invariants are correct and heavily tested; a rewrite risks the exact lease/cancel/validation semantics that currently hold.

**B — restructure in place.** Give `ConversionEngineAdapter` an execute method so dispatch stops being a string-keyed table plus hardcoded family branches (AUDIT-arch §3.2), and type the side-band fields now crossing `ProcessContext.options` untyped (`_uploadIds`, `_detect`, `_engineRoute`). The route-selection layer itself (`routeConversion` + engine fallback) drew no adverse findings in the reports — preserve its behavior while restructuring around it.

**C — restructure in place.** Make `server/src/convert/formats.ts` the only format/MIME/category table and derive or delete the other ten copies; fix the `classifyJobCategory` omissions and the `max` quality alias divergence in the process; export accept-lists/gated-op ids to the client through `/api/capabilities` instead of hand-copied literals.

**D — rewrite (the protocol core of ConverterView, onto a shared store).**
- *What*: extract one workspace/job sync store (versioned merge applied to SSE *and* poll *and* hydrate), one upload orchestrator hook wrapping multipart + resumable, then rebuild ConverterView as a thin view over them, deleting its inline poll loop, refresh triplication, dedupe, and retry reconstruction.
- *Cost*: the largest client change in this plan — ~2,000 LOC view + `liveState.js` (561) + `converterGroups.js` (608) interplay, plus the recovery behaviors in AUDIT-flow F1/F3 that exist nowhere else as spec. Realistically several weeks including the safety net it needs first.
- *Risk of not doing it*: the documented race cluster stays (F1-H1/H5, F2-H2/H4/H6/H7, F3-H6), every future converter feature is written three ways again, and the flow report's hazard list keeps growing in a file that is both a top-10 LOC and a top-40 churn pain point (1972 LOC, churn 6 — AUDIT-metrics §3; the top non-CSS source churn point is its sibling `PdfView.jsx` at 10).
- *Argument against*: server-side dedupe, lease guards, and output validation make many of these races self-healing cosmetic blips in a single-user app; and AUDIT-flow is currently the only complete description of the subtle recovery behaviors (session placeholders, anti-regression merges, cross-tab pause semantics) — a rewrite could silently drop behaviors the reports show but no test asserts. If the team can't fund the safety net first (steps 1–2 of §4), incremental restructure is the safer wrong answer.

**E — restructure in place.** Collapse the three client SSE implementations + the reconnect logic living in a fourth file into one subscription module; fix the EventSource leak on parse error (F3-H1); replace the restart-resetting `seq` with an epoch-qualified version (server change in `workspace-events.ts`) so `isNewerEvent` survives restarts (F3-H2); dedupe the two server SSE handlers whose drift is exactly the missing keepalive/try-catch (AUDIT-arch §4.3).

**F — rewrite (the stylesheet layer, not the visual design).**
- *What*: regenerate the stylesheet on the existing token system — tokenize the pre-4220 era, delete the 21+ zero-usage variant classes and dead animation subsystems, collapse the 6 duplicate class definitions, split per-domain files.
- *Cost*: mechanical but wide — 5,421 LOC touching all 17 views; the state-code matrix in AUDIT-ui §1/§5 is the checklist. Cheap in logic risk (no behavior), expensive in verification (visual).
- *Risk of not doing it*: styles.css is the single largest and highest-churn file in the repo (AUDIT-metrics §3); every UI change pays the two-generations tax and the drift keeps compounding (four `--accent` fallbacks already).
- *Argument against*: dead CSS is inert — it ships bytes but breaks nothing, and there is no automated visual regression in the repo (screenshot e2e specs exist, but the reports contain no evidence of a pixel-comparison gate), so a rewrite has the weakest safety net of any step here. A defensible cheaper path is deletion-only (dead selectors + duplicates) without re-tokenizing the live rules.
- *Evidence gap*: none of the reports measure whether the CSS size has any runtime/perf cost — the case rests on maintenance economics only.

**G — restructure in place.** First relocate or rewrite the `ui-*-struct` server tests so client structure is not pinned from `server/tests/` (AUDIT-arch §1.2); then delete the dead components and the orphaned `ModularWorkspaceView`/`extraToolConfigs` pair, merge the three focus traps, three tablists, three dropzones, and four `formatBytes` (AUDIT-ui §2, AUDIT-arch §4.14). *Evidence gap*: the reports cannot say whether `ModularWorkspaceView` is abandoned or intended future work — that needs a product decision before deletion; the struct tests referencing it suggest intent at some point.

**H — restructure in place.** Extract one probe/resolution library consumed by both the server registry and the maint scripts (they already share the manifest data files), and pick one precedence order deliberately — the reports document the drift (inverted preference, differing timeouts and candidate lists, three config.json writers) but give no evidence of which order is *intended*, so that decision must be made explicitly, not inferred.

**I — leave alone.** PDF operations, Python bridge, db connection layer, server upload-session protocol, and the maint clean/clear/reset allowlists came through the audit with explicit clean verdicts or findings small enough not to justify structural work (AUDIT-arch §3.1, §4.15; AUDIT-flow F1 server side). Two recorded findings ride along in this area and belong on a fix list rather than driving a verdict: the F1-H4/F1-H16 protocol nits above, and AUDIT-arch §4.12's observation that `scripts/maint/lib/clear-targets.mjs:103` deletes `data/uploads|outputs|temp` wholesale with no DB reconciliation — a third deletion path over directories the server also sweeps.

---

## 4. Sequence — one reviewable PR per step

Order rationale: build the missing safety nets first; unblock deletion before consolidation (less code to migrate); fix contracts before rewriting their largest consumer; CSS last because it is independent and has the weakest verification.

1. **PR-1: Test infrastructure.** Add coverage tooling to the server suite, a client unit-test harness for `src/lib` + `src/hooks` (none exists today — AUDIT-metrics §6), and 3–5 converter e2e journeys (multipart upload→convert→download; resumable pause/resume/cancel; reload with active job). No production code changes. *Depends on: nothing.*
2. **PR-2: Un-pin the client from server tests.** Move/rewrite the ~30 `ui-*-struct.test.ts` assertions into the client harness from PR-1 (or an explicit allowlist file), so client deletions stop breaking `server/tests`. *Depends on: PR-1.*
3. **PR-3: Dead-code deletion.** Remove dead components (`AgentFanOut`, `IconButton`, `FileDropzone`, `FeatureButton`, `IllustrationCard`), the orphaned `ModularWorkspaceView`/`extraToolConfigs` (after the product decision flagged in §3G), zero-usage CSS variants and dead animation selectors (AUDIT-ui §3, §6c), and the never-imported `@types/ws` (AUDIT-metrics §4c). No behavior change intended. *Depends on: PR-2.*
4. **PR-4: One format table.** Consolidate the 11 format/MIME/category copies onto `convert/formats.ts`; fix `classifyJobCategory` omissions and the `max`-alias divergence; publish client-consumed lists via capabilities. *Depends on: nothing (parallel with 2–3).*
5. **PR-5: Event transport unification.** One client SSE module (leak fix F3-H1), epoch-qualified event versions (F3-H2), deduped server SSE handler. *Depends on: PR-1 (client harness for the parser/reconnect unit tests).*
6. **PR-6: Shared workspace/job sync store.** Version-gated merge applied uniformly to SSE, poll, and hydrate paths (kills F2-H2/F3-H6/F3-H7 class); ConverterView consumes it with minimal edits at this step. *Depends on: PR-5.*
7. **PR-7: ConverterView rewrite.** Thin view over the PR-6 store + an upload-orchestrator hook; delete the inline poll loop, dedupe, retry reconstruction, refresh triplication; align duplicate-detection with the server's definition. *Depends on: PR-1, PR-4, PR-6.*
8. **PR-8: Tool-probe consolidation.** Shared probe library + one deliberate precedence order + single config.json writer. *Depends on: nothing (parallel track).*
9. **PR-9: Job-engine split.** Decompose `workers/jobs.ts` into claim/schedule/settle/GC modules; unify the three purge paths; route `routes/activity.ts` stats and `workspace.ts` hardPurge through the engine API. Behavior-preserving. *Depends on: PR-4 (category table) recommended, not required.*
10. **PR-10: Stylesheet regeneration.** Tokenize the pre-4220 era, collapse duplicate definitions, split files; visual pass across the AUDIT-ui §1 state matrix. *Depends on: PR-3 (deletions), PR-2 (struct tests no longer pin class names).*

---

## 5. Safety net per step — what must exist BEFORE work begins

| Step | Required pre-existing net | Status |
|---|---|---|
| PR-1 | `npm test` green (704 cases — AUDIT-metrics §6) | **Exists** for the test suite; any CI gate or fixture-verify tooling is named in no phase report — confirm what CI runs before relying on it |
| PR-2 | The struct tests themselves (they are the spec being moved); full server suite green | **Exists** |
| PR-3 | PR-2's relocated tests; e2e screenshot specs for before/after eyeballing | **Partial — flagged**: screenshots are captured by e2e specs, but the reports show no automated pixel comparison; CSS deletions currently have **no automated way to be verified** beyond "suite still green + manual screenshot diff" |
| PR-4 | `converter.test.ts` (582 LOC) + `converter-groups.test.ts` (591 LOC) — both evidenced in AUDIT-metrics §1; plus a new drift test (assert every `detect.ts` extension maps to a category) written *before* consolidating | **Partially evidenced**; further detect/engine tests are presumed but named in no report — inventory them first; drift test must be added first |
| PR-5 | A restart-ordering integration test (emit → restart → emit, assert client-side ordering survives) | **Flagged**: no report evidences any existing test of event versioning, and none simulates the `seq` reset; the ordering test must be written first using the existing HTTP-integration harness, otherwise the F3-H2 fix is unverifiable |
| PR-6 | Client unit harness from PR-1 covering `liveState.js` merge semantics (version gates, snapshot merges) | **Does not exist today — flagged**: `src/` has zero unit tests; without PR-1 this step cannot be verified |
| PR-7 | PR-1's converter e2e journeys; server-side upload-session tests | **Partial — flagged**: no report names a resumable-upload test file (presumed; confirm first), and the client race cluster (F1-H1/H5, F2-H4) has **no deterministic test method identified in the reports** — verifiable only by e2e approximation |
| PR-8 | maint-script suite (36 cases — AUDIT-metrics §6); the forwarder scripts `scripts/check-tools.mjs`/`repair-tools.mjs` (AUDIT-arch §4.15) as smoke checks | **Exists** for the maint suite; no report evidences a dedicated tool-verification command — confirm before starting |
| PR-9 | `workers.test.ts` (504 LOC), `job-delete-history.test.ts` (498 LOC), `hardening.test.ts` (630 LOC) — all evidenced in AUDIT-metrics §1 | **Exists** — strongest net in the plan; a retention/cleanup-specific test is presumed but named in no report |
| PR-10 | Visual regression gate | **Does not exist — flagged**: same gap as PR-3; without adding a screenshot-comparison step, the stylesheet rewrite is verifiable only by manual review across 17 views × state matrix |

---

*End of synthesis. Committed as the final phase of the read-only audit; no source files were modified at any point.*
