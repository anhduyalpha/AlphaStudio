# PLAN — Rebuild execution order

Derived from SPEC.md (frozen). This document sequences the work; it does not restate the target — every acceptance criterion below is a citation into SPEC.md, and SPEC.md wins on any wording difference. AUDIT.md §5 is the source for the characterization-test status column.

## Execution strategy (governs every unit)

**Flag-gated parallel build, single flip** (interview decision for this plan):

- `src/main.jsx` selects the client by a build-time flag (`VITE_UI=next`): default = the current client exactly as today; flag = the new shell. The shipped default does not change until unit F1.
- **Transitional namespace rule:** new modules whose target path collides with a live old file (components named `EmptyState`, `Icon`, `CommandPalette`, `Sidebar`, `Topbar`; hook `useCapabilities`; the new `App.jsx`; new views) are built under `src/next/` during the transition. Non-colliding targets — `src/protocol/`, `src/hubs/`, `src/styles/`, `src/workbench/`, new `src/lib/` builders — are built at their final SPEC §3.1 paths immediately. F1 moves `src/next/*` to the final paths mechanically.
- Consequence accepted: intermediate units ship no user-visible change; F1 is large but is almost entirely deletion plus a mechanical move.
- Sequencing note (not a SPEC contradiction, but a decision this plan makes): `api/client.js` SSE code and the 25 `server/tests/ui-*-struct.test.ts` files are needed by the *old* client until the flip, so their removal (SPEC §3.1, S3) lands in F1, not in the units that supersede them.

**Command conventions** (established by A1): `npm run test:client` = `vitest run`; `npm run typecheck` is extended to also check `src/protocol/` + `src/hubs/` (SPEC §3.1 language rule). "Server suite" = `npm test` (`--test-concurrency=1`, serial — do not parallelize).

Every unit may also touch its own test files (client tests colocated or under the harness dir A1 creates; server tests under `server/tests/`). That allowance is implied below and not repeated.

---

## Track A — harness and server enablers

### A1 — Client test harness (SPEC §7.2)
- **Files:** `package.json` (root only — never `npm install` in `server/`), `vitest.config.js`, `tsconfig.client.json`, `.github/workflows/ci.yml`, harness scaffolding under `src/` test dirs.
- **Depends on:** nothing.
- **Acceptance:** SPEC §7.2 opening clause — Vitest is the one permitted new dev dependency; zero runtime dependencies added (§1). CI gains a client-test step.
- **Completion:** `npm run test:client` (trivially green) · `npm test` · `npm run typecheck` all pass.
- **Characterization:** none needed — no production code changes. Existing net: the server suite (AUDIT §5 PR-1 row).

### A2 — S1: epoch event versioning (SPEC §6.4)
- **Files:** `server/src/lib/workspace-events.ts`, `server/src/routes/workspaces.ts` (SSE handler + poll/snapshot endpoints that carry versions).
- **Depends on:** nothing.
- **Acceptance:** SPEC §6.4 in full (boot-scoped `epoch`, `seq` monotonic per workspace within epoch, envelopes and snapshots carry both, no schema change expected; additive+reversible if one proves needed per §6.6).
- **Completion:** `npm run typecheck` · `npm test`.
- **Characterization:** **must be written first** — AUDIT §5 PR-5 flags that no existing test covers event versioning or the restart `seq` reset. Write an emit → restart → emit ordering test in the existing HTTP-integration harness before changing `workspace-events.ts`.

### A3 — S2: capabilities-published contracts (SPEC §3.5)
- **Files:** `server/src/routes/system.ts`, `server/src/capabilities.ts`, `server/src/convert/formats.ts`, `server/src/convert/quality.ts`, and the create-gate wiring only in `server/src/routes/jobs.ts` / `server/src/workers/jobs.ts` (`createJob`) / `server/src/processors/index.ts` (`assertJobCapable`). Job-engine decomposition is NOT IN SCOPE (SPEC §1) — touches to `workers/jobs.ts` are limited to gate validation.
- **Depends on:** nothing (parallel with A1/A2).
- **Acceptance:** SPEC §3.5 in full: `acceptLists` from `formats.ts`, `gatedOps` from the capability layer, `quality` alias resolution from `quality.ts`; the job-create gate validates against the same published lists. Deeper internal copies stay (accepted debt, §1).
- **Completion:** `npm run typecheck` · `npm test`.
- **Characterization:** partial — `converter.test.ts` / `converter-groups.test.ts` exist (AUDIT §5 PR-4). **Write first:** the drift test AUDIT PR-4 requires (every `detect.ts` extension maps into a published list/category), plus gate accept/reject tests against the published lists.

## Track B — protocol core (SPEC §3.1/§3.2, TypeScript, inert until flip)

### B1 — `src/protocol/contracts.ts` (SPEC §3.2 contracts row)
- **Files:** `src/protocol/contracts.ts`.
- **Depends on:** A3 (the published payload shape is its input), A1 (tests).
- **Acceptance:** SPEC §3.2 contracts row — fetch/cache via `client.js` only; no fallback literals; unreachable capabilities ⇒ hubs get the capability-gap state, never an invented contract.
- **Completion:** `npm run test:client` · `npm run typecheck`.
- **Characterization:** none exists and none applicable (new module; `src/` has zero unit tests today — AUDIT §5 PR-6 row). Unit tests are written inside this unit.

### B2 — `src/protocol/store.ts` (SPEC §3.2 store row, §6)
- **Files:** `src/protocol/store.ts`, `src/next/hooks/useStore.js`.
- **Depends on:** A1 (harness), A2 (the `(epoch, seq)` envelope it merges).
- **Acceptance:** SPEC §6.1 (state table + sanctioned storage keys), §6.2 (mutation rules, client dedupe removed), §6.3 (the single versioned merge, monotonic progress, terminal immutability, wholesale re-hydrate on epoch change), §6.5 items 2/3/5.
- **Completion:** `npm run test:client` (the §7.2 unit list: epoch change, seq regression, monotonic progress, terminal immutability, optimistic overlay) · `npm run typecheck`.
- **Characterization:** none exists — the modules it supersedes (`liveState.js`, `useJobRunner.js`, `useWorkspace.js`) have no tests (AUDIT §5 PR-6, flagged). SPEC §6 is the contract; the merge-semantics suite is written **before** the merge implementation within this unit.

### B3 — `src/protocol/events.ts` (SPEC §3.2 events row)
- **Files:** `src/protocol/events.ts`. Explicitly NOT `api/client.js` — its legacy SSE code stays for the old client until F1.
- **Depends on:** B2 (sole consumer/emit target), A2 (epoch detection).
- **Acceptance:** SPEC §3.2 events row — fetch-stream parser, heartbeat/reconnect with backoff, epoch detection, exactly one live connection per workspace, importable only by `store.ts`; §6.3 reconnect/epoch re-hydrate behavior.
- **Completion:** `npm run test:client` (parser/reconnect suite incl. a simulated epoch flip — §7.2) · `npm run typecheck`.
- **Characterization:** none exists (AUDIT §5 PR-5: no test simulates the seq reset — A2's new server test covers the server half; the client half is written here).

### B4 — `src/protocol/uploads.ts` (SPEC §3.2 uploads row)
- **Files:** `src/protocol/uploads.ts`; `api/resumableUpload.js` is consumed as-is (kept per §3.1).
- **Depends on:** B2 (reports into the store).
- **Acceptance:** SPEC §3.2 uploads row (branch at 8 MiB, pause/resume/cancel, crash recovery via session listing, adopt-completed before opening a new session) and §6.5 item 1.
- **Completion:** `npm run test:client` (branch/pause/resume/adopt-completed suite — §7.2) · `npm run typecheck`.
- **Characterization:** none client-side; server upload-session tests are the existing net (AUDIT §5 PR-7 row flags client races as e2e-only — F2 steps 4–7 are the eventual end-to-end check).

## Track C — design system and primitives (SPEC §4; parallel with Track B)

### C1 — Tokens and base styles (SPEC §4.1, §4.2, §4.5, §5.2)
- **Files:** `src/styles/tokens.css`, `src/styles/base.css`. Not imported by the old client.
- **Depends on:** nothing (may land in parallel with A-track).
- **Acceptance:** the complete token tables of §4.1/§4.5/§5.2; §4.6 purity holds for `base.css`.
- **Completion:** `npm run test:client` (token-purity structural test from §4.6, written in this unit against `src/styles/`).
- **Characterization:** none applicable (new files; the old stylesheet is not touched).

### C2 — Primitives I: controls and status (SPEC §4.4)
- **Files:** `src/next/components/` (Button, Field, Toggle, Tabs, Card, Skeleton, StatusBadge, EmptyState, Banner, Icon restyle), `src/styles/primitives.css`.
- **Depends on:** C1, A1.
- **Acceptance:** §4.4 rows for these primitives (variants + required states), §4.7 component-level a11y, §4.6 purity.
- **Completion:** `npm run test:client` (purity, a11y attributes, exactly-one rules as they become enforceable). **The visual state matrix itself has no machine check** — manual check: render every required state per §4.4 legend in the Asset Gallery (available after D2) in both themes.
- **Characterization:** none applicable — old components are not modified; the 25 `ui-*-struct` server tests keep pinning the old ones untouched until F1.

### C3 — Primitives II: file and flow (SPEC §4.4)
- **Files:** `src/next/components/` (Dropzone, FileRow/FileList, ProgressBar, ErrorState, Toast, RunBar, ResumeStrip), `src/styles/primitives.css`.
- **Depends on:** C2 (shared css file and state conventions).
- **Acceptance:** §4.4 rows for these primitives incl. ErrorState's required named recovery action (§2.4), ResumeStrip's two placements contract (§2.5), Toast timer reading `--duration-toast` from computed style (§5.2); §4.7.
- **Completion / Characterization:** same shape as C2 (structural tests machine-checked; visual states manual via Asset Gallery).

### C4 — Primitives III: overlay and chrome (SPEC §4.4, §4.7)
- **Files:** `src/next/components/` (Modal, CommandPalette, Sidebar, Topbar), `src/hooks/useFocusTrap.js` (new, final path — no collision), `src/styles/primitives.css`.
- **Depends on:** C2.
- **Acceptance:** §4.4 rows; §4.7 — `useFocusTrap` as the single trap used by Modal/palette/drawer; §4.3 glass only on the enumerated surfaces.
- **Completion / Characterization:** same shape as C2; the exactly-one-focus-trap grep rule (§4.4) becomes fully enforceable only at F1 (old traps still exist) — the structural test allowlists `src/next/` + old paths until then, and the allowlist empties at F1.

## Track D — shell and workbench

### D1 — Shell skeleton: entry flag, router, hub registry (SPEC §2.1, §3.1)
- **Files:** `src/main.jsx` (flag branch), `src/next/App.jsx`, `src/hubs/index.ts` (route table, legacy-redirect map, nav order, **stub entries for all six hub configs** so Track E units never touch this file concurrently), stub `src/hubs/{convert,pdf,media,textdev,security,utilities}.ts`, `index.html` (delete the no-op device heuristic per §5.1 — audit evidence says both branches assigned `'balanced'`, so the old client is unaffected; verify that claim against the source before deleting).
- **Depends on:** B2 (hydrate/boot path), C2 (minimal primitives for stub rendering).
- **Acceptance:** §2.1 route table, `?mode=` resolution (`modes[0]` default), unknown-hash → `#/`, the full legacy-redirect list; §3.1 nav derived from the hub registry.
- **Completion:** `npm run test:client` (redirect-table + route-resolution tests) · `npm run typecheck` · `npm run build` (both flag values build).
- **Characterization:** old-client routing has no tests; not needed — old `App.jsx` is untouched.

### D2 — Shell chrome and Asset Gallery (SPEC §2.1, §4.7)
- **Files:** `src/next/App.jsx`, `src/next/components/` (Sidebar/Topbar/palette wiring), `src/next/views/AssetGallery.jsx`, `src/styles/views.css`.
- **Depends on:** C4, D1.
- **Acceptance:** §2.1 nav contract (active-jobs indicator, palette searches hubs **and** modes), §4.7 shell items (skip link, route-change focus to `<h1>`, global live region), §2.1 `#/assets` dev-only gating.
- **Completion:** `npm run test:client` (a11y structural: skip link, live region, roles). **No machine check for chrome visuals** — manual: Asset Gallery renders the full §4.4 state matrix in both themes; sidebar/palette walkthrough.
- **Characterization:** none applicable (new surface).

### D3 — Workbench and panel registry (SPEC §2.2, §3.3)
- **Files:** `src/workbench/Workbench.jsx`, `src/workbench/registry.jsx`, `src/styles/workbench.css`.
- **Depends on:** B1 (capability gating), B2 (store binding), C2+C3 (the primitives the flow is made of), D1 (mounting).
- **Acceptance:** §2.2 canonical flow incl. the normative aggregate-progress composition; §3.3 (lazy resolution, unknown key → ErrorState naming the key); §3.2 Workbench row (no hub special-casing by name).
- **Completion:** `npm run test:client` (hub-config validation per §7.2 — every config's `capabilityIds`/`acceptFrom`/`buildOptions`/`compute`/`panels` resolve — plus registry unknown-key test) · `npm run typecheck`.
- **Characterization:** none applicable (new surface; per-hub behavior is Track E's problem).

## Track E — hubs and views (mutually parallel after D3)

Shared shape for E1–E8 — differences only are listed per unit:
- **Acceptance:** the hub's row in §2.1, the §2.2 flow, §2.4 four-states-per-region, and **feature parity per AUDIT-ui.md §1b** (normative checklist, incorporated by SPEC §2.3).
- **Completion:** `npm run test:client` (config validation + any unit-specific lib tests) · `npm run typecheck`. **Parity has no machine check** — manual: tick the AUDIT-ui §1b rows for the old view(s) this hub absorbs, in the running flag build.
- **Characterization:** server-side behavior is covered by the existing server suite (jobs/converter/pdf/text tests). Client-side old views have zero tests; the old e2e specs (`pdf-tools`, `corrective-*`, `residual-*`) exercise old markup and serve as pre-flip reference only — they are retired in F1.

### E1 — Convert hub (SPEC §2.1 `#/convert`)
- **Files:** `src/hubs/convert.ts`, `src/lib/convertJobOptions.js` (new), `src/lib/converterGroups.js` (kept, adapted).
- **Extra deps:** B4 (uploads are the heart of this hub). This is the e2e centerpiece (F2 steps 4–8) and the successor of the audit's RC1 parallel client — **flagged for its own detailed plan at execution time.**

### E2 — PDF hub config + export/operations modes (SPEC §2.1 `#/pdf`)
- **Files:** `src/hubs/pdf.ts`, `src/lib/pdfJobOptions.js` + `src/lib/pdfPreview.js` (kept, adapted).

### E3 — PdfOrganizerPanel (SPEC §3.3)
- **Files:** `src/workbench/panels/PdfOrganizerPanel.jsx`.
- **Extra deps:** E2 (the `organize` mode that mounts it). Heaviest single panel — **flagged for its own detailed plan at execution time.**

### E4 — Media hub config + preview/crop (SPEC §2.1 `#/media`)
- **Files:** `src/hubs/media.ts`, `src/lib/mediaJobOptions.js` + `src/lib/imageCrop.js` (kept, adapted), `src/workbench/panels/MediaPreviewPanel.jsx`, `src/workbench/panels/CropPanel.jsx`, `src/hooks/useJobPreviewUrl.js` (kept per §3.1).

### E5 — Media editor panels (SPEC §3.3)
- **Files:** `src/workbench/panels/WaveformPanel.jsx`, `src/workbench/panels/TimelinePanel.jsx`.
- **Extra deps:** E4.

### E6 — Text & Dev hub (SPEC §2.1 `#/text`)
- **Files:** `src/hubs/textdev.ts`, `src/lib/textJobOptions.js` (new), `src/lib/textDiff.js` (kept), `src/workbench/panels/DiffPanel.jsx`, `src/workbench/panels/ComparePanel.jsx`. Note the §2.1 constraints: `dev` runs the 8 utilities as existing server text ops; `ocr` renders the install-hint gap state when gated.

### E7 — Security & Archive hub (SPEC §2.1 `#/security`)
- **Files:** `src/hubs/security.ts`, `src/lib/securityJobOptions.js` + `src/lib/archiveJobOptions.js` (new), `src/lib/archiveTree.js` (kept), `src/workbench/panels/ArchiveTreePanel.jsx`.

### E8 — Utilities hub (SPEC §2.1 `#/utilities`)
- **Files:** `src/hubs/utilities.ts`, `src/lib/qrJobOptions.js` (new), `src/lib/colorPalette.js` + `src/lib/clipboardImage.js` (kept), `src/workbench/panels/QrDesignerPanel.jsx`, `src/workbench/panels/ColorLabPanel.jsx`. Exercises the dual `local`+`job` run shape (§3.4) — the one hub that proves it.

### V1 — Home view + ResumeStrip placements (SPEC §2.1 `#/`, §2.5)
- **Files:** `src/next/views/Home.jsx`, `src/styles/views.css`.
- **Depends on:** B2 (stats/active jobs from store), C3 (ResumeStrip primitive), D2.
- **Acceptance:** §2.1 Home row; §2.5 both placements incl. the no-synthetic-rows drop.
- **Completion:** `npm run test:client` (structural) · **visuals manual** (populated + empty resume strip).
- **Characterization:** none client-side; ResumeStrip resume flow is end-to-end-verified by F2 step 4.

### V2 — Activity view (SPEC §2.1 `#/activity`, §3.2 views row)
- **Files:** `src/next/views/Activity.jsx`, additive wrappers in `src/api/client.js` if an endpoint wrapper is missing.
- **Depends on:** D2, C2.
- **Acceptance:** §2.1 Activity row (per-row optimistic delete + rollback, clear-all); §3.2 views row (history is not store state).
- **Completion:** `npm run test:client` (optimistic-rollback unit test) · **visuals manual**.
- **Characterization:** server activity endpoints covered by existing suite; client rollback test written in-unit.

### V3 — Settings + Profile views (SPEC §2.1) — **deferred-decision unit**
- **Files:** `src/next/views/Settings.jsx`, `src/next/views/Profile.jsx`.
- **Depends on:** D2, C2.
- **Acceptance:** §2.1 rows; §6.1 (theme/motion mirrors, density server-persisted with no client key).
- **Deferred marker:** density *semantics* are SPEC §8 Open question 2 — this unit ships density as a persisted preference with no visual effect, placed as late as the graph allows; wiring its meaning is out of plan until the question is decided.
- **Completion:** `npm run test:client` (storage-key structural test) · **visuals manual**.
- **Characterization:** none applicable.

## Track F — motion, flip, acceptance gate (strictly last)

### F0 — Motion system (SPEC §5) — **deferred-decision unit**
- **Files:** `src/styles/motion.css`, transition rules inside `src/styles/primitives.css`/`workbench.css`/`views.css`, `src/hooks/useMotionPreference.js` (kept, shared with old client — behavior-preserving for it).
- **Depends on:** C2–C4, D2–D3, E/V units (it animates what exists). Last content unit by the mandated layer order.
- **Acceptance:** §5.2 timing tokens, §5.3 exhaustive trigger table + 3 MUST rules, §5.4 never-animate list incl. reduced static forms, §5.1 ambient-1 in `full`.
- **Deferred marker:** ambient signatures beyond ambient-1 are SPEC §8 Open question 1 — not planned; if later decided, they extend this unit (and may resurrect `useAnimationActivity.js` per §3.1).
- **Completion:** `npm run test:client` (token-only timing + compositor-only structural checks). Reduced-mode static form is machine-checked later by F2 step 10. **Ambient-1 in `full` mode and overall motion feel have no machine check** — manual pass across the §5.3 table in all three modes.
- **Characterization:** none applicable (old animation CSS untouched until F1).

### F1 — Flip, deletion, S3 (SPEC §3.1 deletion list, §7.2 structural suite, S3) — **flagged for its own detailed plan at execution time; single point of no return**
- **Files (wide by nature — this is the unit's entire purpose):**
  - Move `src/next/*` → final §3.1 paths; flip `src/main.jsx` default and remove the flag.
  - Delete: the §3.1 deletion list verbatim (17 old view files + `extraToolConfigs.js`, dead components incl. `AgentFanOut`/`IconButton`/`FileDropzone`/`FeatureButton`/`IllustrationCard`, `useWorkspace.js`/`useWorkspaceEvents.js`/`useJobRunner.js`/`useAnimationActivity.js`, `liveState.js`, `src/data/tools.js`, `src/styles.css`, `src/animations/*.css`); prune all SSE code from `src/api/client.js`.
  - Delete the 25 `server/tests/ui-*-struct.test.ts` files (S3). **Also audit** `ui-assets-design-system` / `ui-contrast` / `ui-converter-results-behavior` / `ui-job-resume` / `ui-qr-decode-error` `.test.ts` and `converter-c0-matrix-struct.test.ts`: any that read client source must move or die per §3.2 (server tests MUST NOT read client source).
  - Retire the old-UI e2e specs (`e2e/pdf-tools.spec.js`, `corrective-*`, `residual-*`) — they drive deleted markup. Coverage note: PDF e2e depth is temporarily reduced to F2 + the server PDF suite; restoring a PDF-focused e2e against the new UI is post-plan follow-up work, recorded here so the loss is deliberate.
  - Empty the transitional allowlists in the structural suite so §7.2 enforces fully: token purity, sanctioned network modules, no format literals, exactly-one rules, a11y, zero dead selectors, no duplicate class definitions, asset-registry rules, §6.1 storage-key table, every legacy redirect.
- **Depends on:** every prior unit; F2 spec green against the flag build **before** this merges.
- **Acceptance:** SPEC §3.1 "Deleted at target state" reached; S3 done; §7.2 structural list fully enforced with empty exception lists.
- **Completion:** `npm run typecheck` · `npm test` · `npm run test:client` · `npm run build` · `npm run test:e2e`.
- **Characterization:** the relocated structural assertions are themselves the moved spec (AUDIT §5 PR-2 row); the server suite minus the deleted struct files must stay green.

### F2 — E2E acceptance gate (SPEC §7.3)
- **Files:** `e2e/rebuild-journey.spec.js` (imports `{ test, expect }` from `e2e/support/browser-audit.js`), fixture helpers under `e2e/support/` if needed.
- **Depends on:** E1 (steps 4–8), A2+B2+B3 (step 9), F0 (step 10), D1/D2 (steps 1–3, 11). Drafted incrementally against the flag build as Track E lands; must pass on the flag build before F1 merges, and re-pass post-flip.
- **Acceptance:** the 12 steps of §7.3, verbatim.
- **Completion:** `npm run test:e2e -- e2e/rebuild-journey.spec.js` against the production build. Note: CI does not run e2e (ubuntu, no external tools) — this gate runs locally by policy; that is stated here rather than pretending CI covers it.
- **Characterization:** this unit *is* the characterization of the rebuilt whole.

---

## Layer order

Mandated order: **core logic → app shell and routing → components → animation.** This plan follows it as: Track A + Track B (core) → D1 (shell skeleton: entry, router, redirects, hub registry) → C2–C4 + D2–D3 + Track E (components) → F0 (animation) → F1/F2.

**One deviation, justified:** C1 (tokens) and C2 (first primitives) start before D1 completes, and D2 (full shell chrome) lands after C4. Reason: Sidebar, Topbar, Modal, and CommandPalette are themselves §4.4 primitives — building finished chrome before the primitive layer exists would mean throwaway markup rebuilt one unit later. The shell *skeleton* (routing, redirects, boot — the part the layer order is protecting) still precedes the component bulk; only its visual chrome trails the primitives it is made of.

## Units flagged for their own detailed plan at execution time

- **B2 + B3** — the sync core; every hazard class SPEC §6.3 kills by construction depends on exact merge semantics, and everything downstream consumes it.
- **E1 Convert** — replaces the audit's RC1 parallel client; densest integration of uploads + store + contracts; the e2e centerpiece.
- **E3 PdfOrganizerPanel** — heaviest single editor surface.
- **F1 Flip** — largest blast radius in the plan; point of no return.

## Parallelism (disjoint file sets)

- **A1 ∥ A2 ∥ A3 ∥ C1** — four independent starts.
- **Track B ∥ Track C** — protocol and design system share no files. Within B: B1 ∥ B2, then B3 ∥ B4.
- **E1–E8 mutually parallel** after D3 — D1's stub configs mean no E unit touches `src/hubs/index.ts`; each owns its hub file, its lib builders, its panels. Ordering inside pairs: E3 after E2, E5 after E4.
- **V1 ∥ V2 ∥ V3 ∥ E-units** — views and hubs are disjoint (shared `src/styles/views.css` is append-only across V units; coordinate merges, no sequencing needed).
- Not parallel: D-track (D1→D2, D1→D3), F-track (F0 → F2-green → F1).

## Rollback

**Abandon at any point before F1:** delete the flag branch in `src/main.jsx` and the new directories (`src/next/`, `src/protocol/`, `src/hubs/`, `src/workbench/`, `src/styles/`); the shipped client was never anything but the old one. Keep regardless of abandonment: A1 (client harness), A2 and A3 (additive server improvements that fix real drift — the audit's PR-4/PR-5 value survives on their own).

**Shippable states, by name:** the project is shippable after **every** unit from A1 through F0 inclusive (the shipped artifact is the unchanged old client plus additive server changes). After **F1+F2** the shipped artifact is the rebuilt client. Between F1 starting and F2 re-passing, the project is *not* shippable — which is why F2 must be green on the flag build before F1 merges, keeping that window inside a single PR.

**Mid-way coherence:** because units are inert until the flip, "coherent" is automatic — there is no state where users see half of each design system. The cost, accepted in the strategy decision, is that no user value ships before F1.

## Deferred decisions (SPEC §8)

| Open question | Blocked unit | Placement |
|---|---|---|
| §8.1 ambient tier beyond ambient-1 | F0 (extension only — ambient-1 itself ships) | F0 is the last content unit; the undecided part is excluded from F0's scope |
| §8.2 density semantics | V3 (behavior only — the persisted preference ships inert) | V3 is placed at the end of Track E; semantics wiring is out of plan |

Both are marked on their units above. Neither blocks F1.
