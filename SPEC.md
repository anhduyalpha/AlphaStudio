# SPEC — AlphaStudio Rebuild: Target State

This document describes the **finished product** of the client rebuild plus three enabling server changes. It is the target state only — no sequencing, no work breakdown. It is written to be executable by a session with zero memory of how it was produced. Where a decision was deliberately left open it appears under **Open questions**; everything else is normative.

Interview decisions recorded here deliberately **overrule** two audit recommendations, eyes open:
1. AUDIT F recommended rewriting the stylesheet layer while keeping the visual design. This spec instead defines a **full redesign** (new information architecture + new visual language).
2. AUDIT §2 listed the bespoke thin-view pattern as a keep. This spec instead converges **all tool surfaces onto one config-driven workbench** (the ModularWorkspaceView lineage, rebuilt).

Background documents: `AUDIT.md`, `AUDIT-arch.md`, `AUDIT-flow.md`, `AUDIT-metrics.md` are non-normative context. **Exception:** `AUDIT-ui.md` §1b (the per-view feature/state inventory of the pre-rebuild UI) is incorporated by reference as the **normative feature-parity checklist** for §2.3.

---

## 1. Scope

In scope (client):

- New information architecture: 6 task hubs + Home/Activity/Settings/Profile (see §2).
- One config-driven workbench rendering every tool hub; specialized editors plug in as registered panels (§3.3).
- One workspace/job sync store applying hydrate, SSE, and poll through a single versioned merge (§6).
- One SSE subscription module, one upload orchestrator (§3.2).
- New design system: tokens, primitives, states (§4). The old stylesheet and animation files are fully replaced — no rule from the pre-rebuild `src/styles.css` / `src/animations/*.css` survives verbatim.
- New motion system on the existing three-mode gate (§5).
- Deletion of all dead components, dead CSS, and the duplicated primitives the audit inventoried; client structural tests move into a client-side harness.

In scope (server — exactly three changes, server otherwise frozen):

- **S1 Epoch event versioning** — workspace event envelopes gain a boot epoch so client ordering survives server restarts (§6.4).
- **S2 Capabilities-published contracts** — `/api/capabilities` publishes format accept-lists, gated operation ids, and quality-preset alias resolution derived from `server/src/convert/formats.ts`; the job-create gate validates inputs against the **same** published lists (§3.5).
- **S3 Struct-test relocation** — the `server/tests/ui-*-struct.test.ts` files are removed; their surviving assertions run in the client harness (§7.2).

### NOT IN SCOPE

- Job-engine decomposition (`server/src/workers/jobs.ts` split, purge-path unification, activity/hardPurge rerouting).
- External-tool probe consolidation (`server/src/tools/registry.ts` vs `scripts/maint/lib/tools-probe.mjs`) and the probe-precedence decision.
- Server PDF subsystem, Python bridge, upload-session protocol internals, and maint clean/clear/reset behavior.
- New user-facing features. Feature parity only: every capability reachable in the pre-rebuild UI is reachable in the new IA (§2.3).
- Dependency upgrades (the 9 major-version-behind server packages stay). One new **dev** dependency is permitted for the client test harness (§7.2); zero new runtime dependencies.
- Auth walls and rate limiting (locked security boundary — `docs/stabilize/SECURITY_BOUNDARY.md`).
- Removal of the legacy `uploads` table dual-write mirror.
- Server-internal consolidation of the remaining format/MIME/category copies beyond what S2 needs (the seven-copy sprawl inside `detect.ts`, `classifyJobCategory`, engine tables etc. stays; see accepted debt).

### Known accepted debt (unchanged by this rebuild)

- Legacy `uploads` mirror dual-write (AUDIT-flow F1-D1).
- Upload-protocol nits F1-H4 (chunk can commit into a just-paused session) and F1-H16 (idempotent chunk path doesn't re-verify the discarded body).
- Cancel-beats-result: a cancel landing in the delivery window discards finished work. This is a preserved server invariant, not a bug to fix.
- After S2, the published contract and the job-create gate share one table, but server-internal enforcement paths (`detect.ts`, `classifyJobCategory`, per-engine tables) may still drift from each other internally.

---

## 2. Information architecture and UX flows

### 2.1 Routes

Hash routing (no router library). Routes take an optional `?mode=` query after the hash path. A hub URL without `?mode=` renders the **first** mode in that hub's config (`modes[0]`); the `modes` array order is the tab order. An unknown hash — including `#/assets` in a production build — resolves to `#/`.

| Route | Name | Contents |
|---|---|---|
| `#/` | Home | Command center: stats strip (jobs run / storage used, parity with pre-rebuild dashboard stats), resume strip (§2.5), active jobs, recent jobs, hub launch tiles |
| `#/convert` | Convert | Batch conversion board (the ConverterView successor) |
| `#/pdf` | PDF | Modes: `operations`, `organize` (page organizer), `export` |
| `#/media` | Media Studio | Modes: `video`, `audio`, `image` |
| `#/text` | Text & Dev | Modes: `text` (cleanup/analyze/case/hash server ops), `editor` (browser-only editor + compare/diff), `ocr` (capability-gated; renders install-hint gap state when the OCR tool is unavailable), `dev` (the 8 developer utilities — JSON Formatter, Base64 Encode, Base64 Decode, URL Encode, URL Decode, SHA-256 Hash, Text Cleaner, UUID Generator — all run as **existing** server text-job operations, exactly as the pre-rebuild DeveloperView did; no new server ops) |
| `#/security` | Security & Archive | Modes: `security` (hash/compare/metadata/signature/password), `archive` (create/extract/inspect) |
| `#/utilities` | Utilities | Modes: `qr` (generate/decode incl. paste-decode), `color` (browser-only picker/contrast/gradient/palette-extraction-from-image-pixels, plus the pre-rebuild ColorView's optional server image jobs via sharp — a mode with both a local compute and a job run, §3.4) |
| `#/activity` | Activity | Job/activity history with per-row delete (optimistic + rollback, as pre-rebuild) and clear-all |
| `#/settings` | Settings | Theme, density, motion, export preferences |
| `#/profile` | Profile | Profile form + preview |
| `#/assets` | Asset Gallery | Dev builds only (`import.meta.env.DEV`); not in nav; in production this hash resolves to `#/` |

Legacy-route redirects (client-side, on hash resolution — old bookmarks must land correctly):

`#/dashboard→#/` · `#/converter→#/convert` · `#/image→#/media?mode=image` · `#/audio→#/media?mode=audio` · `#/media→#/media?mode=video` · `#/archive→#/security?mode=archive` · `#/developer→#/text?mode=dev` · `#/qr→#/utilities?mode=qr` · `#/color→#/utilities?mode=color` · `#/text→#/text?mode=text` · `#/security→#/security?mode=security` · `#/pdf`, `#/activity`, `#/settings`, `#/profile` unchanged.

Navigation: sidebar lists Home, the 6 hubs, then Activity/Settings/Profile, and shows an **active-jobs indicator** (StatusBadge `live` tone with the running-job count) whenever at least one job is running — this is the element ambient-1 (§5.1) animates in `full` mode; under `reduced` it is the static `--live` dot per §5.4. The command palette (Ctrl+K) searches hubs **and** modes (e.g. typing "audio" offers *Media Studio → Audio*). Nav metadata and order are derived from the hub registry (§3.4) — there is no separately maintained nav list; the pre-rebuild `src/data/tools.js` is deleted.

### 2.2 The canonical hub flow

Every tool hub renders the same workbench skeleton with the same flow:

1. **Mode select** — tabs under the hub header (one Tabs primitive, §4.4). Deep-linkable via `?mode=`.
2. **Input** — one Dropzone primitive; accepted types come from capabilities (§3.5), never from client literals. Files appear as FileRow items with per-file status. Browser-only modes (`kind: 'local'`, §3.4) may take text/color input instead of files.
3. **Configure** — options panel generated from the hub config's option schema; specialized editors (crop, timeline, PDF organizer, QR designer, color lab, media preview) mount as registered panels in the same slot.
4. **Run** — a persistent run bar: primary action, aggregate progress (ProgressBar), cancel. Capability gaps render a Banner with the server-reported reason; the run action is disabled with the reason named next to it, never silently. Local modes run synchronously in the browser; the run bar shows their action without job progress.
5. **Results** — result list in the same view; each result row offers download / retry (on failure) / remove. Retry re-runs the **same** input as a new attempt (§6.3); when the input itself is bad, the recovery path is Remove + upload a corrected file — the ErrorState's recovery action must name whichever applies. Batch results offer ZIP download.

Information hierarchy inside a hub, top to bottom: hub header (name + capability status) → mode tabs → workspace (input rail left, configure center, on ≥1200px results right; single column stacked below 900px) → run bar pinned bottom.

**Aggregate progress composition** (normative — the displayed value is what §6.5's monotonic rule applies to): per file, upload maps to 0–30%, job execution to 30–99%, and 100% only on completion (the pre-rebuild `useJobRunner` mapping, kept). A batch's run-bar value is the arithmetic mean of the per-file composed values. The displayed value never decreases within an attempt.

### 2.3 Feature-parity map (old view → new home)

Dashboard→Home · Converter→Convert · Pdf→PDF · Image→Media Studio/image · Media→Media Studio/video · Audio→Media Studio/audio · Text→Text & Dev/text+editor+ocr · Developer→Text & Dev/dev · Security→Security & Archive/security · Archive→Security & Archive/archive · Qr→Utilities/qr · Color→Utilities/color · Activity→Activity · Settings→Settings · Profile→Profile · AssetGallery→Asset Gallery (dev-only). Every operation offered by the old view exists in its new home; the normative checklist is `AUDIT-ui.md` §1b (incorporated by reference — see header).

### 2.4 Required states per region

Every hub region has all four of: populated, empty, loading, error. Specifically:

- Empty: designed EmptyState with an action (e.g. "Drop files or browse"). No region may render blank. (Pre-rebuild Color and Developer views had none — the rebuild closes this.)
- Loading: Skeleton for initial hydrate; ProgressBar for job/upload progress. Never an unexplained blank.
- Error: inline-persistent ErrorState **where the result would have appeared**, carrying a named recovery action (Retry / Remove / Open Settings / Install hint). Toasts are only for transient non-blocking confirmations (copied, saved, deleted). A job failure surfaced only as a toast is a spec violation.

### 2.5 Resume strip and resumable-uploads strip

One shared strip component with two placements:

- **Home resume strip**: lists (a) resumable upload sessions the server reports for the workspace and (b) active/queued jobs. Each entry names the file/job and links to the owning hub + mode; upload-session entries offer Resume and Discard inline. Empty state: "Nothing to resume."
- **Hub input rail**: the same strip, filtered to upload sessions only, renders above the Dropzone in every hub whenever at least one resumable session exists (sessions are workspace-global, not hub-tagged). This is where e2e step 4 (§7.3) resumes from.

There are no synthetic placeholder file rows for un-resumed sessions (an explicit drop, §6.5).

---

## 3. Target architecture (modules by name)

Language rule: modules under `src/protocol/` and `src/hubs/` are **TypeScript** and are typechecked in CI (extend the existing `npm run typecheck`). Views/components stay `.jsx`. Zero new runtime dependencies.

### 3.1 Module map

```
src/
  api/
    client.js            HTTP transport (kept, PRUNED: all SSE/event-stream code removed —
                         subscribeWorkspaceEvents / subscribeViaFetch / waitViaSse die here)
    resumableUpload.js   chunk transport (kept; owns the alphastudio:upload:* session-identity keys)
  protocol/              NEW — TypeScript
    store.ts             workspace/job sync store — THE single client state owner
    events.ts            SSE subscription — THE single event-stream owner
    uploads.ts           upload orchestrator (multipart + resumable, pause/resume/cancel)
    contracts.ts         capability-derived contracts cache (formats, gated ops, quality aliases)
  workbench/
    Workbench.jsx        the one config-driven hub view
    registry.jsx         panel registry (string key → panel component)
    panels/              specialized editors: PdfOrganizerPanel, QrDesignerPanel,
                         ColorLabPanel, WaveformPanel, TimelinePanel, MediaPreviewPanel,
                         CropPanel, DiffPanel, ArchiveTreePanel, ComparePanel
  hubs/                  NEW — TypeScript, data-only configs
    convert.ts pdf.ts media.ts textdev.ts security.ts utilities.ts
    index.ts             hub registry: route table, nav order, legacy redirects, defaults
  components/            primitives only (§4.4), stateless w.r.t. workspace data
  hooks/                 useStore (useSyncExternalStore binding), useFocusTrap,
                         useMotionPreference, useCapabilities (wraps contracts.ts),
                         useJobPreviewUrl (kept: blob-URL/preview lifecycle for
                         MediaPreviewPanel and result previews)
  lib/                   pure logic. Kept: pdfJobOptions, mediaJobOptions, imageCrop,
                         converterGroups, archiveTree, colorPalette, textDiff,
                         jobResultKind, clipboardImage, pdfPreview (liveState.js deleted).
                         NEW pure builder/compute modules are expected here for hubs that
                         lack one: convertJobOptions, textJobOptions, securityJobOptions,
                         archiveJobOptions, qrJobOptions — the list is non-exhaustive for
                         additions, exhaustive for survivors
  views/                 Home, Activity, Settings, Profile, AssetGallery (bespoke, non-hub)
  styles/                tokens.css, base.css, primitives.css, workbench.css,
                         views.css, motion.css   (replaces styles.css + animations/)
  assets/                registry.js + assets (kept; the only sanctioned asset access path)
  App.jsx                shell: hash router over hubs/index.ts + views, theme/motion boot
```

Deleted at target state (no successor imports them): `src/views/ConverterView.jsx`, `PdfView.jsx`, `QrView.jsx`, `ImageView.jsx`, `MediaView.jsx`, `ArchiveView.jsx`, `TextView.jsx`, `AudioView.jsx`, `ColorView.jsx`, `SecurityView.jsx`, `DeveloperView.jsx`, `DashboardView.jsx`, `ModularWorkspaceView.jsx`, `extraToolConfigs.js`, `AgentFanOut.jsx`, `IconButton`, `FileDropzone`, `FeatureButton`, `IllustrationCard`, `PageIntro`, `src/data/tools.js`, `src/lib/liveState.js` (superseded by `store.ts`), `src/hooks/useWorkspace.js`, `src/hooks/useWorkspaceEvents.js`, `src/hooks/useJobRunner.js` (all three superseded by `store.ts`; their sessionStorage resume and workspace-id persistence move into it), `src/hooks/useAnimationActivity.js` (unless a shipped ambient signature needs activity-pause — §5.1), `src/styles.css`, `src/animations/*.css`.

**Sanctioned network modules (exhaustive):** `api/client.js`, `api/resumableUpload.js` (HTTP), and `protocol/events.ts` (the fetch-stream SSE reader). No other module may call `fetch`, `XMLHttpRequest`, or `EventSource`. `contracts.ts` and `store.ts` perform all HTTP through `api/client.js`; `uploads.ts` performs HTTP only through `api/client.js` (multipart) and `api/resumableUpload.js` (chunked).

### 3.2 Module responsibilities and forbidden dependencies

| Module | Responsibility | May NOT depend on / do |
|---|---|---|
| `api/client.js` | All HTTP request/response, auth header, endpoint paths | MUST NOT contain format lists, op catalogs, merge logic, or any SSE/event-stream code. |
| `api/resumableUpload.js` | Chunk upload protocol; owns `alphastudio:upload:*` localStorage session-identity keys (§6.1) | MUST NOT create jobs or touch store state. |
| `protocol/events.ts` | Open/close the workspace SSE stream (fetch-stream parser), heartbeat/reconnect with backoff, epoch detection; emits parsed events to `store.ts` | MUST NOT mutate state itself; MUST NOT be imported by anything except `store.ts`. Exactly one live connection per workspace (the pre-rebuild app had three SSE implementations; the leak class F3-H1 dies here). |
| `protocol/store.ts` | Owns all client workspace/job/upload-session state, the persisted workspace id, and per-mode job-resume pointers; exposes `getSnapshot`/`subscribe` + typed actions (`hydrate`, `applyEvent`, `applyPoll`, `optimistic*`); ONE versioned merge (§6.3) applied to every write path | MUST NOT import React or any component. No other module may write workspace/job state — a `setState`-shaped export from anywhere else is a violation. |
| `protocol/uploads.ts` | Upload lifecycle: multipart vs resumable branch (≥8 MiB), pause/resume/cancel, crash recovery via session listing, progress normalization; before opening a NEW session for a file it MUST re-check server session state (including `completed`) and adopt an already-committed file instead of re-uploading (kills F1-H5's duplicate re-upload); reports into `store.ts` | MUST NOT parse SSE, MUST NOT construct job payloads. |
| `protocol/contracts.ts` | Fetch (via `client.js`) + cache `/api/capabilities`; expose accept-lists, gated ops, quality aliases, engine availability | MUST NOT contain fallback format/op literals. If capabilities are unreachable, hubs render their capability-gap state — the client never invents a contract. |
| `hubs/*.ts` | Declarative config: modes, capability ids, option schemas, panel keys | Data-only: no JSX, no imports from `components/`, `workbench/`, or `protocol/store.ts` (types from `contracts.ts` allowed). Nav order, redirects, and the route table live in `hubs/index.ts`, outside `HubConfig`. |
| `workbench/Workbench.jsx` | Render any hub config through the canonical flow (§2.2); connect store ↔ panels | MUST NOT special-case a hub by name (`if (hub === 'pdf')` is a violation — differences live in configs/panels). |
| `workbench/panels/*` | Specialized editors; receive state + dispatch via props | MUST NOT call `api/*` directly; MUST NOT own workspace state. |
| `components/*` | Presentation primitives (§4.4) | MUST NOT import `protocol/` or `api/`; workspace data arrives via props only. |
| `hooks/*` | React bindings (store subscription, focus trap, motion, capabilities) | `useFocusTrap` is the ONLY focus-trap implementation. |
| `lib/*` | Pure logic: option builders, grouping/planning math, parsing, preview loaders | Leaf layer: MUST NOT import `protocol/`, `api/`, `components/`, or React. |
| `views/*` (Home, Activity, Settings, Profile) | Bespoke non-hub screens. Workspace/job data ONLY via `hooks/useStore`. Activity history, profile fields, and preferences are NOT store state: these views read/write them directly through `api/client.js` wrappers (Activity keeps optimistic row-delete with rollback). | MUST NOT open event streams or duplicate store-owned state. |
| `styles/*` | All CSS | Token purity per §4.6 (single normative rule); only `tokens.css` defines token values. |
| `server/tests/*` | Server behavior | MUST NOT read or assert on client source (S3). |

Layering (imports may only point downward): `App/views/workbench` → `hooks` → `protocol` → `api` → (leaf). `components`, `hubs`, `lib`, and `assets` are leaves (type-only imports allowed). Circular imports: none (CI-checkable with the same SCC method the audit used).

### 3.3 Panel registry

Panels register under string keys (`'pdf-organizer'`, `'qr-designer'`, `'color-lab'`, `'waveform'`, `'timeline'`, `'media-preview'`, `'crop'`, `'diff'`, `'archive-tree'`, `'compare'`). Hub configs reference keys; `registry.jsx` resolves them with `React.lazy`. An unknown key renders an ErrorState naming the key — never a crash. `media-preview` owns `<video>`/`<audio>` playback for Media Studio (states: default, loading, error on undecodable media).

### 3.4 Hub config interface (normative shape)

```ts
interface HubConfig {
  id: string;                 // route segment, e.g. 'media'
  name: string;               // nav + header label
  icon: string;               // Icon registry name
  modes: HubMode[];           // modes[0] is the default mode and tab order follows array order
}
interface HubMode {
  id: string;                 // ?mode= value
  name: string;
  capabilityIds: string[];    // ids from /api/capabilities that gate this mode ([] for local modes)
  input: { kind: 'files' | 'text' | 'none'; multiple?: boolean; acceptFrom?: string };
                              // acceptFrom names a capabilities accept-list — never literal extensions
  options: OptionField[];     // declarative option schema (text/select/toggle/range/color/derived)
  panels?: string[];          // panel registry keys mounted in the configure slot
  run: {                      // at least one of `local`/`job` MUST be present; both is legal
    local?: { compute: string };                      // compute names a pure src/lib function
    job?: { jobType: string; buildOptions: string };  // buildOptions names a src/lib builder
  };
  results: { kind: 'files' | 'json' | 'text' };
}
```

`local` covers browser-only computation (Text & Dev `editor`; Utilities `color` picker/contrast/gradient/palette extraction — palette extraction runs on image pixels in the browser via `lib/colorPalette`, as pre-rebuild): compute runs synchronously client-side and its output renders in the results region; no job row, no progress. A mode with both (`color`: local computes + sharp image jobs) shows the job action in the run bar while local computes run live. `dev` and `text` are job-only modes over existing server text operations. Builders/computes resolve against `src/lib` per §3.1 (survivors + the expected new builders).

### 3.5 Server change S2 — capabilities-published contracts

`/api/capabilities` additionally publishes, each list derived from its real server-side source:

- `acceptLists` (from `server/src/convert/formats.ts`): named lists of accepted input extensions + MIME types per job type/mode.
- `gatedOps` (from the existing capability/tool-availability layer — `capabilities.ts` + `tools/registry.ts`): operation ids requiring unavailable tools, with reason strings.
- `quality` (from `server/src/convert/quality.ts`): preset names and alias resolution (`max` resolves to exactly one preset — the server's answer; the pre-rebuild client/server disagreement dies by the client never resolving aliases).

The job-create gate (`POST /api/jobs` validation) accepts/rejects inputs against the same published lists, so the published contract cannot drift from create-time enforcement. Deeper server-internal copies stay as accepted debt (§1).

Checkable consequence: `git grep` over `src/` finds no format-extension or MIME literals outside tests and `contracts.ts` type definitions.

---

## 4. Design system

Direction rationale (non-normative): evolve, don't replace, the identity — what "evolved current identity" means checkably is: the accent hue family (`#9b7cff` purple / `#49dbe8` cyan lineage), the Inter/mono font stacks, and dark-as-default remain; everything else is defined solely by §4.1–§4.7. Both themes ship with full token parity; dark is default.

### 4.1 Color tokens (complete set — `styles/tokens.css` is the only definition site)

| Token | Dark | Light | Role |
|---|---|---|---|
| `--bg` | `#070911` | `#f3f6fb` | App background |
| `--bg-raised` | `#0d1020` | `#eaf0fa` | Raised background bands |
| `--surface` | `#101422` | `#ffffff` | Panel/card (opaque — in-flow surfaces are never translucent) |
| `--surface-2` | `#151a2c` | `#f0f3fa` | Hover/nested surface |
| `--border` | `rgba(255,255,255,0.08)` | `rgba(15,23,42,0.08)` | Hairline |
| `--border-strong` | `rgba(255,255,255,0.14)` | `rgba(15,23,42,0.14)` | Emphasis hairline |
| `--text` | `#f7f8fc` | `#111827` | Primary text |
| `--text-2` | `#a7b0c2` | `#475569` | Secondary text |
| `--text-3` | `#717b90` | `#6b7280` | Muted/meta text |
| `--accent` | `#9b7cff` | `#5f3fe4` | Identity + interaction (see role table) |
| `--accent-hover` | `#ab90ff` | `#4f32c9` | Hover of accent controls |
| `--accent-active` | `#8a68f5` | `#462cb4` | Pressed |
| `--accent-soft` | `rgba(155,124,255,0.14)` | `rgba(95,63,228,0.10)` | The ONLY purple tint (selection fills, active-nav wash) |
| `--on-accent` | `#ffffff` | `#ffffff` | Text/icon on accent |
| `--live` | `#49dbe8` | `#0891b2` | Liveness (see role table) |
| `--live-soft` | `rgba(73,219,232,0.12)` | `rgba(8,145,178,0.10)` | The ONLY cyan tint |
| `--success` | `#43d99b` | `#0f9d6b` | Completed |
| `--warning` | `#f4bd5e` | `#b45309` | Degraded/attention |
| `--danger` | `#ff7188` | `#dc2626` | Failed/destructive |
| `--focus-ring` | `rgba(155,124,255,0.85)` | `rgba(95,63,228,0.80)` | Focus outline (purple: focus is interaction; the pre-rebuild cyan ring is retired) |
| `--glass-bg` | `rgba(13,17,29,0.72)` | `rgba(255,255,255,0.78)` | Glass recipe (§4.3) |
| `--glass-border` | `rgba(255,255,255,0.10)` | `rgba(15,23,42,0.10)` | Glass recipe |
| `--glass-blur` | `18px` | `18px` | Glass recipe blur radius |
| `--gradient-brand` | `linear-gradient(135deg,#9b7cff 0%,#5d8dff 100%)` | same | Primary CTA + brand mark ONLY |
| `--shadow-1` | `0 10px 28px rgba(0,0,0,0.18)` | `0 10px 28px rgba(50,65,90,0.08)` | Floating-layer elevation |
| `--shadow-2` | `0 18px 48px rgba(0,0,0,0.26)` | `0 18px 48px rgba(50,65,90,0.12)` | Modal elevation |

Status tints are derived in CSS via `color-mix(in srgb, var(--success) 14%, transparent)` etc. — `color-mix` from a token is the only sanctioned way to make a tint; new literal `rgba(...)` tints are violations.

### 4.2 Accent role table (normative)

| Use | Token | Examples |
|---|---|---|
| Brand identity | `--accent` / `--gradient-brand` | Brand mark, primary CTA |
| Interactive states | `--accent` family | Focus ring, active nav item, selected tab/row, checked toggle, links, selection fills |
| Liveness | `--live` family | Running-job badge and progress fill, SSE-connected dot, upload-in-flight indicators, streaming/inspecting states |
| Outcomes | `--success` / `--warning` / `--danger` | Completed, degraded/capability-gap, failed/destructive |
| Neutral information | `--text-2` / `--surface-2` | Static informational badges, neutral banners, notices |

Any purple used for liveness, any cyan used for anything that is not live/in-flight (including static "info" styling), or any status color used decoratively is a spec violation. There is no cyan "info" family: non-live informational UI is neutral.

### 4.3 Glass — one recipe, enumerated surfaces

The single recipe: `background: var(--glass-bg); backdrop-filter: blur(var(--glass-blur)); border: 1px solid var(--glass-border); box-shadow: var(--shadow-1)` (modal uses `--shadow-2`).

Allowed glass surfaces — exactly these: modal dialogs, command palette, toasts, the pinned run bar, the mobile nav drawer. Everything in-flow (cards, panels, rails, rows, headers) is opaque `--surface`/`--surface-2`. When `backdrop-filter` is unsupported or `data-power="low"` is set (§5.1), glass surfaces fall back to opaque `--surface` — content readability may not depend on blur.

### 4.4 Component inventory — one implementation per pattern

State legend: **D** default · **H** hover · **F** focus-visible · **A** active/pressed · **S** selected/checked · **L** loading/busy · **E** empty · **Er** error · **X** disabled. "Required" means a visible, distinct treatment exists in both themes; a state listed is checkable by rendering it in the Asset Gallery.

| Primitive | Replaces (pre-rebuild count) | Variants | Required states |
|---|---|---|---|
| Button | 31 button treatments | `primary` (gradient CTA), `secondary`, `ghost`, `danger`, `icon`; sizes `sm`, `md` | D H F A L X |
| Tabs | WorkspaceTabs, SegmentedControl, QR tabs, hand-rolled tablists (4) | `underline` (hub modes), `segmented` (compact icon) | D H F S X — roving tabindex + Arrow/Home/End on both variants |
| Field | field-group inputs, inline textareas, color/range one-offs (15 input treatments) | `text`, `select`, `textarea`, `color`, `range`, `checkbox` | D F Er X — error = `has-error` + `role="alert"` message |
| Toggle | ToggleRow | — | D F S X |
| Dropzone | FileDropzone, FilePicker inline zone, QR paste zone (3) | `files`, `paste` | D H F A(drag-over) X E |
| FileRow / FileList | studio-file-row, file-queue-row, FileInputCard, job-row, timeline-row (5) | slots: status icon, meta, progress, actions | D H F S L Er X; list has E |
| ProgressBar | progress-fill, progress-wave, dead third variant (3) | `determinate`, `indeterminate` | L; `reduced` static form (§5.4); `role="progressbar"` + `aria-valuenow` when determinate |
| StatusBadge | StatusBadge + tone classes | tones: `neutral live success warning danger` | D; `live` pulses (§5.3) |
| EmptyState | EmptyState (kept, restyled) | `default`, `compact` | E; optional action button; `live` prop → `role="status"` + `aria-live="polite"` (kept from pre-rebuild) |
| ErrorState | (new — closes the toast-only gap) | inline block | Er + REQUIRED named recovery action; `role="alert"` |
| Banner | CapabilityBanner | `neutral`, `warning` | D; `role="status"` |
| Modal | modal-layer/palette/QR modal duplicates (3 systems) | `dialog`, `palette` | D; focus trapped via the single `useFocusTrap`; Escape closes; scrim click closes unless busy |
| Toast | toast-message | `notice` (neutral), `success`, `danger` | D; enter AND exit animation (§5.3); auto-dismiss after `--duration-toast` (the JS timer reads the token from computed style); rendered inside a persistent `role="status"` `aria-live="polite"` container |
| Card | 30 card treatments | `panel` (with optional header), `flat` | D; optional H when interactive |
| Skeleton | Skeleton | block, row | L |
| Icon | Icon (kept) | registry-driven | unknown name falls back, decorative by default |
| CommandPalette | CommandPalette (kept, on Modal `palette`) | — | D E S |
| RunBar | workbench-runbar | — | D L X; glass surface |
| ResumeStrip | (new, §2.5) | `full` (Home), `uploads-only` (hub rail) | D E |
| Sidebar / Topbar | kept, restyled | — | D H F S(current route); drawer traps focus |

Exactly-one rules (checkable by grep): one focus-trap implementation (`hooks/useFocusTrap`), one `formatBytes`, one file-browse mechanism (Dropzone's hidden input), one tablist keyboard handler, one progress-bar component. Specialized panels (§3.3) compose these primitives; a panel introducing its own button/row/progress styling is a violation.

### 4.5 Non-color tokens

- **Spacing** (unchanged scale): `--space-1..7` = `0.25 / 0.5 / 0.75 / 1 / 1.5 / 2 / 3rem`.
- **Radius**: `--radius-xs 8px`, `--radius-sm 12px`, `--radius-md 16px`, `--radius-lg 20px`, `--radius-pill 999px`. (`28px` retired; off-scale 13/14px radii die.)
- **Type** (Inter stack + mono stack as today): `--text-display 1.75rem/1.2/650`, `--text-title 1.375rem/1.25/600`, `--text-section 1.0625rem/1.4/600`, `--text-body 0.9375rem/1.5/400`, `--text-meta 0.8125rem/1.4/500`, `--text-code 0.875rem/1.5 mono`. Six sizes total; the pre-rebuild 26 raw font sizes map onto these.
- **Z-scale**: `--z-rail 10`, `--z-drawer 30`, `--z-palette 40`, `--z-modal 50`, `--z-toast 60`.
- **Shell**: `--sidebar-width 248px`, `--topbar-height 64px`, `--rail-width 320px`, `--runbar-height 64px`.
- **Breakpoints** (media queries may use these literals): 640, 900, 1200px.

### 4.6 Token purity (the single normative purity rule; §3.2's styles row defers here)

Outside `styles/tokens.css`, CSS may not contain:

- hex colors or `rgb()/rgba()/hsl()` literals (tints only via `color-mix` from tokens);
- literal `ms`/`s` durations or `cubic-bezier` values;
- `border-radius` or `font-size` values that don't reference a token;
- `margin`/`padding`/`gap` values that neither reference `--space-*` nor come from the allowlist.

Allowlist of raw values permitted anywhere: `0`, `1px` (hairline borders/outlines), `2px` (focus outline width/offset), `50%`, `100%`, `100vh/vw/dvh`, `auto`, `transparent`, `currentColor`, breakpoint literals inside `@media`. Structural sizing (`width`/`height`/`min-*`/`max-*`/`inset`/`flex-basis`) may use raw lengths. JSX `style={}` may carry only dynamic values (computed widths/positions/transforms) — never design constants. Enforced by structural tests in the client harness (§7.2).

### 4.7 Accessibility (normative; decision: preserved behaviors, not weakened)

- **Focus**: exactly one focus-trap implementation (`useFocusTrap`) used by Modal, CommandPalette, and the mobile drawer. Roving tabindex + Arrow/Home/End on Tabs and on the palette result list. A skip link ("Skip to content") is the first focusable element. On route change, focus moves to the new view's `<h1>`.
- **Announcements**: one visually-hidden global live region (`role="status"`, `aria-live="polite"`), owned by the shell, announces job terminal transitions ("<name> completed" / "<name> failed"). Toasts render in a persistent polite live container. Inline ErrorState is `role="alert"`. Determinate ProgressBar exposes `role="progressbar"` + `aria-valuenow`; the RunBar's aggregate value is not separately announced (the terminal announcement covers outcome).
- **Component-level**: per the required-states table (§4.4): Field errors `role="alert"`, Banner `role="status"`, EmptyState `live` variant kept.
- All of the above are asserted by the structural harness (§7.2).

---

## 5. Motion language

### 5.1 Modes

Three modes on `html[data-motion]`, resolved pre-paint by the inline script in `index.html` (kept; its device heuristic — a branch that assigned `'balanced'` on both paths — is deleted):

- `balanced` (default): all functional motion (§5.3), no ambient motion.
- `full`: balanced + the ambient tier. At target state the ambient tier ships **at least one** signature, defined here as normative so `full ≠ balanced`: **ambient-1 "live pulse"** — the sidebar's active-jobs indicator pulses opacity 0.6→1.0 at `--duration-ambient`/`--ease-in-out` while at least one job is running. Additional signatures are Open question 1.
- `reduced`: no keyframe animation runs; interaction transitions are retained at `--duration-fast`; every indicator has a styled static form (§5.4). OS `prefers-reduced-motion` forces `reduced`.
- `data-power="low"` (orthogonal attribute, set by `useMotionPreference` when the Battery API reports discharging below 20% or `navigator.connection.saveData` is on — kept pre-rebuild behavior): disables glass blur (§4.3) and all ambient motion regardless of mode.

### 5.2 Timing tokens (the only legal timing values)

- `--duration-fast 150ms` — hover/press feedback, focus ring, toggle knob.
- `--duration-base 220ms` — panel/tab transitions, toast enter, drawer, modal enter.
- `--duration-slow 320ms` — route/hub entrance, modal exit, compare-slider settle.
- `--duration-ambient 2600ms` — ambient loops (`full` only), live badge pulse, indeterminate/skeleton loops.
- `--duration-toast 2600ms` — Toast auto-dismiss (consumed by JS via computed style; the token-only rule covers CSS, and JS timers must read their durations from these tokens rather than hardcoding).
- Easing: `--ease-out cubic-bezier(0.16,1,0.3,1)` (entrances), `--ease-standard cubic-bezier(0.22,1,0.36,1)` (everything else), `--ease-in-out cubic-bezier(0.45,0,0.55,1)` (loops). No other curve exists.

### 5.3 What animates (exhaustive)

| Trigger | Motion | Timing |
|---|---|---|
| Route/hub mount | Single fade+4px rise of the view container | `--duration-slow` / `--ease-out` |
| Tab/mode switch | Panel crossfade; tab indicator slides | `--duration-base` |
| Hover/press | Background/border color-mix shift, icon nudge ≤2px via transform | `--duration-fast` |
| Focus | Focus ring appears (opacity) | `--duration-fast` |
| Modal/palette/drawer | Scale 0.98→1 + fade in over scrim fade | `--duration-base` in / `--duration-slow` out |
| Toast | Slide+fade in AND out (exit animation completes before unmount) | `--duration-base` |
| Progress (determinate) | Width via `transform: scaleX` — never `width` | continuous |
| Progress (indeterminate) | Sliding bar loop via `transform: translateX` | `--duration-ambient`÷2 / `--ease-in-out` |
| Live StatusBadge / ambient-1 | Opacity pulse | `--duration-ambient` |
| Skeleton | Opacity pulse, or a `transform: translateX` gradient-overlay sweep | `--duration-ambient` |
| Compare slider settle | Handle/reveal position via transform on release | `--duration-slow` / `--ease-standard` |
| Dropzone drag-over | Border/fill tint + `scale(1.01)` | `--duration-fast` |

MUST rules (violations are spec violations):

1. **Compositor-only**: only `transform` and `opacity` may be animated by keyframes/transitions; color changes ride `transition: background-color/border-color/color` at `--duration-fast` only (no keyframed color, no `background-position` animation). Never animate `width/height/top/left/margin/padding`.
2. **Token-only timing**: zero literal durations/beziers outside `tokens.css`.
3. **Reduced = styled static, never frozen** (§5.4).

### 5.4 What must never animate

- Layout: nothing moves neighbors. List insertion/removal, job completion, and SSE/poll re-renders cause **no** entrance/stagger replay (entrance fires on route mount only — adopted as a MUST here even though the interview left it "to taste": without it, rule 1 is unenforceable on lists).
- Data values: numbers (progress %, ETA, counts) update instantly — no count-up tweens.
- Text reflow, table rows, focus position, and scroll position (no smooth-scroll except user-initiated `scroll-behavior` on the palette result list).
- Under `reduced`: indeterminate ProgressBar renders a static striped track (recognizably "busy", not a frozen mid-keyframe frame — the pre-rebuild frozen 32%-width bar is the named anti-goal); live badge renders a static `--live` dot; skeleton renders static `--surface-2`.
- Ambient motion anywhere outside `html[data-motion="full"]`.

---

## 6. Data and state model

### 6.1 Where state lives

| State | Location | Truth? |
|---|---|---|
| Jobs, files, workspaces, activity, results | Server SQLite (`data/alphastudio.db`), single connection in the API process | Yes — the only durable truth |
| Job passwords/secrets | Server in-memory vault | Yes; never persisted, never echoed to the client |
| Upload sessions | Server (`upload_sessions` + staging dirs) | Yes |
| Profile fields + preferences (theme/density/motion/exports) | Server SQLite via existing settings/profile API (unchanged) | Yes |
| Event ordering | Server in-memory `(epoch, seq)` per workspace (§6.4) | Yes for ordering only |
| Client workspace/job mirror | `protocol/store.ts` in-memory snapshot | No — derived cache, rebuilt from hydrate at any time |
| In-flight upload controllers | `protocol/uploads.ts` memory | No — recovered via server session listing |
| localStorage | Exactly these keys, pre-rebuild names kept: `alphastudio-workspace-id` (opaque workspace pointer — renaming it would orphan every existing workspace), `alpha-studio-theme`, `alpha-studio-motion` (pre-paint mirrors of server-persisted prefs), plus the `alphastudio:upload:*` session-identity keys owned by `api/resumableUpload.js` (how a re-selected file re-associates with its server session across reloads) | No |
| sessionStorage | `alphastudio-active-job:<hubId>:<modeId>` — job-resume pointers for reload-with-active-job (§6.5), owned by `store.ts` | No |

Any localStorage/sessionStorage key outside this table is a violation. Beyond the sanctioned keys, nothing may be persisted client-side — workspace, job, file, and result data never, under any key. Density has no client-side key (server-persisted, applied post-hydrate).

### 6.2 Who may mutate

- Server rows: server only. The client never patches job status; it requests (create/cancel/retry/delete) and the server decides. Client duplicate detection is **removed**: the client always sends `clientRequestId` and renders whatever the server returns (dedupe is the server's `findActiveDuplicateJob` — one definition, server-owned).
- Client store: only `store.ts` action functions. All four write paths — hydrate snapshot, SSE event, poll result, optimistic action — pass through the **same** merge function. A component calling anything but a published action is a violation.
- Optimistic writes are limited to: file rows during upload, "requested" flags on cancel/delete/convert buttons. Each carries the pending server request; server response or timeout resolves it. Optimistic state may never overwrite a server-terminal status.
- Activity/Profile/Settings server data: mutated only through their existing endpoints via `api/client.js`; Activity's optimistic row-delete with rollback is kept.

### 6.3 Merge semantics (normative)

- Every event/poll payload carries `(epoch, seq)` (S1) or a row `updatedAt`. The store accepts a write iff it is newer: same epoch → higher `seq` wins; row-level fallback → newer `updatedAt` wins; otherwise the write is discarded. Poll and SSE therefore cannot regress each other (the pre-rebuild poll path skipping the version gate was hazard class F2-H2/F3-H6/F3-H7 — dead by construction).
- Progress is monotonic per job attempt: a lower progress value for the same attempt is discarded. Retry starts a new attempt (new job row) at 0. The same rule governs the composed displayed value (§2.2).
- Terminal states (`completed/failed/cancelled`) are immutable in the store; a late progress event for a terminal job is discarded.
- On SSE reconnect or epoch change: full snapshot re-hydrate replaces the mirror wholesale (optimistic overlays re-applied on top), then live events resume.

### 6.4 Server change S1 — epoch event versioning

The event-envelope logic in `server/src/lib/workspace-events.ts` and the SSE handler (`GET /api/workspaces/:id/events` in `server/src/routes/workspaces.ts`), plus the poll/snapshot endpoints that carry versions: the server mints an `epoch` (UUID) at process boot; every event envelope and snapshot carries `{ epoch, seq }` with `seq` monotonic per workspace within the epoch. Client rule: unknown/changed epoch → drop ordering state, re-hydrate, adopt new epoch. Requires no SQLite schema change (epoch is boot-scoped); if a migration is nonetheless needed it must be additive and reversible per §6.6.

### 6.5 Recovery behaviors (MUST) and explicit drops

MUST survive the rebuild, defined behaviorally (self-contained):

1. **Resumable uploads**: files ≥ 8 MiB upload in chunks; pause, resume, and cancel work mid-transfer; after a page reload or crash, sessions listed by the server are offered for resume (§2.5) with correct byte progress; a session the user pauses stays paused. Before starting a new session for a file, the orchestrator re-checks existing server sessions **including completed ones** and adopts an already-committed upload instead of re-uploading (a lost finalize response must not produce a duplicate file).
2. **Reload with active job**: reloading while a job runs re-attaches after hydrate — progress continues from the server's value (never from 0, never backwards) and completion delivers results normally. Applies to every hub, guarded per hub+mode by the expected job type (via the §6.1 sessionStorage pointer).
3. **Monotonic progress**: no visible progress regression, ever (§6.3, §2.2).
4. **Restart resilience**: if the server restarts mid-job, the client re-hydrates (new epoch), shows the server-truth job state (`SERVER_RESTART` failure or resumed queue) and never wedges its event ordering.
5. **Workspace never silently replaced**: if workspace recovery (`/api/workspaces/recover`) fails transiently, the store surfaces a persistent ErrorState and retries; it MUST NOT discard the persisted workspace id or auto-create a replacement workspace without explicit user action (kills hazard F3-H3's silent orphaning).

Explicitly DROPPED (decided, not accidental):

- Cross-tab pause semantics (a second tab pausing/coordinating uploads of the first). Behavior with two tabs open: last writer wins; no coordination promised.
- Upload session placeholder rows (synthetic file rows for sessions discovered but not yet resumed). Discovered sessions appear in the ResumeStrip instead (§2.5).

### 6.6 Migration policy

All existing `data/` content (DB, uploads, outputs, workspace state) survives the rebuild in place and remains readable. SQLite migrations, if any, are additive and reversible (new columns/tables only; no drops, no rewrites of existing rows). The client's persisted workspace id keeps its pre-rebuild localStorage key (§6.1) and `/api/workspaces/recover` semantics are unchanged, so existing workspaces remain reachable on first launch of the rebuilt client.

---

## 7. Testing surface at target state

### 7.1 Existing suites

`npm test` (the server suite excluding the ui-*-struct files relocated by S3) stays green and stays the engine's safety net. `npm run typecheck` covers `server/` plus `src/protocol/` and `src/hubs/`.

### 7.2 Client harness (new)

Vitest (the one permitted new dev dependency) runs client tests:

- Unit: `store.ts` merge semantics (epoch change, seq regression, monotonic progress, terminal immutability, optimistic overlay), `events.ts` parser/reconnect (including a simulated epoch flip), `uploads.ts` branch/pause/resume/adopt-completed logic, hub config validation (every config's `capabilityIds`/`acceptFrom`/`buildOptions`/`compute`/`panels` resolve).
- Structural (relocated from `server/tests/ui-*-struct.test.ts`, replacing them): token purity (§4.6), network calls only in the sanctioned modules (§3.1), no format literals outside `contracts.ts`, exactly-one rules (§4.4), a11y attributes (§4.7), every CSS class in `styles/` has a render site in `src/` (zero dead selectors; the exceptions list must be empty), no class defined in two files, asset-registry rules (no hardcoded `/assets/` URLs, no emoji icons), storage keys limited to the §6.1 table, every legacy route redirects (§2.1).

### 7.3 The one end-to-end verification (acceptance gate)

One Playwright spec, `e2e/rebuild-journey.spec.js`, importing `{ test, expect }` from `e2e/support/browser-audit.js`, run against the production build (`npm run build` + `npm start` on the e2e ports). It passes ⇔ the rebuild works. Steps, in order:

1. Cold start with an empty `data-test/` dir → Home renders; sidebar shows Home, 6 hubs, Activity, Settings, Profile.
2. Visit all 10 production routes in dark, toggle to light, visit all 10 again — every route paints a populated-or-designed-empty state; zero console errors or failed requests (browser-audit enforces). `#/assets` resolves to `#/` in this build.
3. Legacy redirect check: `#/converter`, `#/image`, `#/developer`, `#/qr` land on the mapped hub+mode.
4. In Convert: upload one small file (multipart) and one > 8 MiB file (resumable); pause the resumable upload, reload the page, resume it from the ResumeStrip offer in the input rail, complete it.
5. Batch-convert both plus one corrupt/truncated file of an accepted extension (passes the accept-list, fails server-side validation) → two successes, one failure. The failure renders an inline ErrorState with a Retry action (not only a toast).
6. Reload mid-job (while a conversion runs) → progress re-attaches at ≥ the pre-reload value and reaches completion.
7. On the failed row: use Retry once → it fails again with the same inline ErrorState (same input, new attempt per §6.3, progress restarts at 0). Then Remove the row, upload a repaired version of the file, convert → completes.
8. Download a single result and the batch ZIP; both artifacts are non-empty and well-formed.
9. Restart the Fastify process mid-SSE (kill + relaunch) → the client re-hydrates on the new epoch, shows no progress regression and no wedged/stale rows, and a job created after restart completes and streams events.
10. Set `data-motion="reduced"` → the indeterminate ProgressBar shows its static busy form (assert no CSS animation running on it); create a job and confirm state changes still visible.
11. Open the command palette, search "audio", navigate to Media Studio → Audio.
12. Final assertion: browser-audit reports zero console errors and zero unexpected network failures for the whole journey.

---

## 8. Open questions

1. **Ambient tier inventory beyond ambient-1** — `full` mode ships the normative "live pulse" signature (§5.1) so the tier is non-empty; whether additional ambient signatures ship (candidates discussed: Home hero shimmer, waveform idle sway) is undecided. If a chosen signature needs visibility-based pausing, `useAnimationActivity.js` may be resurrected for it.
2. **Density semantics** — the density preference is kept for parity (server-persisted, §6.1), but what it does in the new token system (spacing-scale multiplier? compact FileRow height? both?) is undecided.
