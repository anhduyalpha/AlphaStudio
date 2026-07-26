# AUDIT-ui — Component, primitive, token, state, and animation inventory

Scope: `src/components/**`, `src/views/*`, app shell (`src/App.jsx`), `src/styles.css`, `src/animations/*.css`, `index.html`. All paths repo-relative to `C:/Users/Duy/Code/Project/AlphaStudio`. Read-only audit; current state only. LOC figures verified with `wc -l` (total src components+views+App = 9,649).

State codes used in the tables below (detail + citations in §5): **D** default, **H** hover/focus (component-specific rule beyond the global `:focus-visible` ring styles.css:136-143 and global `:disabled` dim styles.css:207-214), **L** loading, **E** empty, **Er** error, **X** disabled. Values: Y = implemented, P = partial, N = absent, `-` = not applicable.

## 1. Component table

### 1a. Shell + shared components (src/components/** and App)

| Name | File | Purpose | Usage sites | LOC | States D/H/L/E/Er/X |
|---|---|---|---|---|---|
| App | src/App.jsx | Root shell: hash routing via `viewMap` (App.jsx:29-46, `getRoute` 48-51), theme persistence (86-98), 15s API health polling (65-78), Ctrl+K/Escape keys (100-119), toast (121-125, 188), route focus/scroll (141-151) | Entry component (src/main.jsx) | 191 | — (container) |
| Sidebar | src/components/Sidebar.jsx | Nav rail + mobile drawer with focus trap (12-66), grouped nav from `navigation` (102-122), API health block (94-100); `React.memo` export (136) | App.jsx:3 (rendered :164) | 136 | Y/Y/N/N/P/N |
| Topbar | src/components/Topbar.jsx | Header: menu button, title/subtitle, command-search trigger (37-46), API health pill (47-50), theme toggle (51-53), avatar link to `#/profile` (54-56) | App.jsx:4 (rendered :166-175) | 60 | Y/Y/N/N/P/N |
| CommandPalette | src/components/CommandPalette.jsx | Ctrl+K modal search over `navigation` with focus trap (73-87), roving highlight (54-71), listbox results (132-151) | App.jsx:5 (rendered :187) | 155 | Y/Y/N/Y/N/N |
| AgentFanOut | src/components/AgentFanOut.jsx | Decorative orchestrator-fans-out SVG/ring visual with mount animation (`role="img"` :21) | **0 importers** (dead; grep matches only its definition :18; server test asserts absence — server/tests/ui-shell-dashboard-struct.test.ts:51) | 67 | Y/N/N/N/N/N |
| BrandMark / BrandLockup | src/components/Brand.jsx | Brand logo `<img>` primitives (square mark :4, horizontal lockup) | Sidebar.jsx:3 (BrandMark); AssetGalleryView.jsx:3 (both) | 30 | Y/N/N/N/N/N |
| PageIntro | src/components/Common.jsx:6-19 | `@deprecated` thin adapter around WorkspaceHeader | AssetGalleryView.jsx:5 (imported, not rendered — see §2 item 9) | (in 311) | — (adapter) |
| PrimaryButton | src/components/Common.jsx:26-49 | Gradient primary button; `busy` prop → "Working…" + converting icon + `aria-busy` (:27, 37-42) | 17 views (all of src/views/* per import lines: ActivityView:4, ArchiveView:5, AssetGalleryView:5, AudioView:5, ColorView:4, ConverterView:12, DashboardView:4, DeveloperView:3, ImageView:5, MediaView:5, ModularWorkspaceView:15, PdfView:12, ProfileView:2, QrView:9, SecurityView:5, SettingsView:2, TextView:5) + QrPasteModal.jsx:3, JobOutputCard.jsx:3, pdf/PdfPageOrganizer.jsx:6, results/JobResultBody.jsx:3 | (in 311) | Y/Y/Y/-/N/Y |
| SecondaryButton | src/components/Common.jsx:52-69 | Secondary button, no busy prop | same Common importer set | (in 311) | Y/Y/N/-/N/Y |
| IconButton | src/components/Common.jsx:71-95 | Icon-only button | **0 importers** (dead; name-mention only in server/tests/ui-foundations-struct.test.ts) | (in 311) | Y/Y/N/-/N/Y |
| StatusBadge | src/components/Common.jsx (tones styles.css:3730-3736) | Status pill with tone + StatusIcon | Common importer set (e.g. DeveloperView.jsx:73) | (in 311) | Y/N/P/-/P/- |
| FileDropzone | src/components/Common.jsx:97-119 | Dropzone button (icon/title/subtitle/small) | **0 importers** (dead) | (in 311) | Y/Y/N/-/N/P |
| SelectField | src/components/Common.jsx:125-139 | Labeled select; `error` → `has-error` + `role="alert"` (:125-136) | Common importer set (e.g. SettingsView.jsx:141-149) | (in 311) | Y/P/N/N/Y/N |
| TextField | src/components/Common.jsx:141-171 | Labeled input; hint/error (:156-169) | Common importer set (e.g. ProfileView.jsx:102-105) | (in 311) | Y/P/N/N/Y/N |
| ToggleRow | src/components/Common.jsx:173-198 | Switch row; disabled → `.toggle-row.is-disabled` (styles.css:1276-1281) | Common importer set (e.g. SettingsView.jsx:176) | (in 311) | Y/P/N/-/N/Y |
| WorkspaceTabs | src/components/Common.jsx:200-239 | `role="tablist"` with roving tabindex/arrow keys (:201-218), active via aria-selected + `.active` (:228-231) | PdfView.jsx:323; ModularWorkspaceView.jsx:129 | (in 311) | Y/Y/N/N/N/N |
| FeatureButton | src/components/Common.jsx:241-257 | Icon+title+description action button, aria-pressed (:244-247) | **0 importers** (dead) | (in 311) | Y/Y/N/-/N/N |
| FeatureRail | src/components/Common.jsx:266-279 | Vertical feature selector, aria-selected (:270) | ModularWorkspaceView.jsx:166 (itself unrouted — §1b) | (in 311) | Y/Y/N/N/N/N |
| IllustrationCard | src/components/Common.jsx:286-297 | Static illustrated card | **0 importers** (dead; name-mention only in server/tests/ui-workspaces-redesign-struct.test.ts) | (in 311) | Y/N/N/N/N/N |
| Panel | src/components/Common.jsx:299-311 | `panel-card` structural wrapper with optional head | Common importer set (e.g. ArchiveView.jsx:120) | (in 311) | Y/N/N/N/N/N |
| EmptyState | src/components/EmptyState.jsx | Illustrated empty/failed block driven by `emptyStateCopy` registry; `live` → role=status/aria-live (:19-20) | 11 views (ActivityView:3, ArchiveView:4, AssetGalleryView:4, AudioView:4, ConverterView:4, DashboardView:3, ImageView:4, MediaView:4, ModularWorkspaceView:4, SecurityView:4, TextView:4) + JobOutputCard.jsx:4 | 30 | Y/N/N/Y*/P/- |
| FilePicker | src/components/FilePicker.jsx | Dropzone + hidden `<input type=file>` (:66-76) + file queue with optional reorder arrows | 11 views: ArchiveView:2, AudioView:2, ColorView:2, ConverterView:3, ImageView:2, MediaView:2, ModularWorkspaceView:2, PdfView:2, QrView:2, SecurityView:2, TextView:2 | 137 | Y/Y/N/Y/N/Y |
| Icon (+ iconAliases, utilityIconNames, iconNames, resolveIconName) | src/components/Icon.jsx | Sprite-based SVG icon, alias resolution, unknown-name fallback (:29-32), decorative-by-default a11y (:61-66) | 16 files: 11 components (AgentFanOut:2, CommandPalette:2, Common:2, FilePicker:2, QrPasteModal:2, Sidebar:2, StatusIcon:2, StudioPrimitives:2, Topbar:2, Workbench:2, archive/ArchiveTree:2) + 5 views (ActivityView:2, AssetGalleryView:2, ConverterView:2, DashboardView:2, DeveloperView:2). Exports `iconAliases` (:4), `iconNames` (:23), `resolveIconName` (:29) imported nowhere; `utilityIconNames` used AssetGalleryView.jsx:2 | 70 | Y/N/N/-/P/- |
| JobOutputCard | src/components/JobOutputCard.jsx | Job result card: status badge, download/delete busy labels + mutual disable (:11-12, 114-119), typed body delegation, failed/cancelled EmptyStates (:82-95), `null` without job (:13) | 9 views: ArchiveView:3, AudioView:3, ColorView:3, ImageView:3, MediaView:3, ModularWorkspaceView:3, PdfView:3, SecurityView:3, TextView:3 | 132 | Y/P/Y/P/Y/P |
| QrPasteModal | src/components/QrPasteModal.jsx | Paste/drop/choose QR image modal; phase machine `idle\|hasImage\|decoding\|result\|error` (:20); focus trap (:100-179); busy gates close/decode (:124, 277, 404, 412) | QrView.jsx:3 | 421 | Y/Y/Y/Y/Y/Y |
| StatusIcon (+ statusIconName) | src/components/StatusIcon.jsx | Maps ~20 status strings to sprite icons with per-status class (:4-25); `statusIconName` (:27) exported, used only in-file | Common.jsx:3, StudioPrimitives.jsx:3 | 40 | Y/N/Y/-/Y/- |
| SegmentedControl | src/components/StudioPrimitives.jsx:6-35 | Icon mode switcher, `.segmented-item.is-active` (styles.css:5057); no `.segmented-item:hover` rule exists | AudioView.jsx:127, SecurityView.jsx:79 (importer views: ArchiveView:7, AssetGalleryView:7, AudioView:7, ColorView:6, ConverterView:14, ImageView:7, MediaView:7, PdfView:14, SecurityView:7, TextView:7) | (in 306) | Y/P/N/N/N/N |
| TimelineRange | src/components/StudioPrimitives.jsx:~60-120 | Start/end time range, disabled on all 4 inputs (:79, 91, 107, 117); emits `is-disabled` (:66) with no matching CSS rule | AudioView.jsx:175 area, MediaView.jsx:163 | (in 306) | Y/P/N/N/N/P |
| WaveformStrip | src/components/StudioPrimitives.jsx:~130-210 | Audio waveform; mode machine idle/loading/ready/fallback (:138, 157, 178, 184); "Analyzing audio…" (:206); decode-failure fallback (:181-186, 207) | AudioView | (in 306) | Y/N/Y/P/Y/- |
| FileRow | src/components/StudioPrimitives.jsx:213-267 | File row card, selected `.is-selected` (styles.css:5160), progress mini-bar (:243-247), keyboard Enter/Space (:230-235); no `.studio-file-row:hover` rule (only `cursor:pointer` styles.css:5159) | StudioPrimitives importer views | (in 306) | Y/P/P/N/P/N |
| FileRowList | src/components/StudioPrimitives.jsx:~269-275 | List wrapper with `empty` prop fallback (:272) | StudioPrimitives importer views | (in 306) | Y/N/N/Y/N/N |
| CompareSlider | src/components/StudioPrimitives.jsx:~277-306 | Before/after slider; `null` without beforeSrc (:281); missing-after placeholder (:286) | ImageView (result), ConverterView, PdfView per imports | (in 306) | Y/P/N/P/N/N |
| WorkbenchLayout | src/components/Workbench.jsx:~20-45 | Structural workspace layout; conditional rail/runbar/footer (:30-41) | 17 views (all import Workbench at lines 4-14) + Common.jsx:4 | (in 126) | Y/N/N/N/N/N |
| WorkspaceHeader | src/components/Workbench.jsx:49-71 | Static workspace header (PageIntro is its deprecated adapter) | same importer set (e.g. AssetGalleryView.jsx:24-28) | (in 126) | Y/N/N/N/N/N |
| CapabilityBanner | src/components/Workbench.jsx:73-84 | Unavailable/degraded banner, role=status; CSS styles.css:4535 | MediaView.jsx:133-135, ArchiveView.jsx:95, TextView.jsx:115-120, AudioView.jsx:134-139, SecurityView.jsx:86, ModularWorkspaceView.jsx:131-143 | (in 126) | Y/N/N/-/Y*/- |
| ResultPanel | src/components/Workbench.jsx:~86-95 | Result region with `empty` fallback (:93) | Workbench importer set | (in 126) | Y/N/N/Y/N/N |
| Skeleton | src/components/Workbench.jsx | Shimmer loading block (styles.css:4577-4593; motion-off :4793-4804) | DashboardView.jsx:118, 143, 211 | (in 126) | Y/N/Y*/-/-/- |
| ProgressWave | src/components/Workbench.jsx:109-126 | Determinate + `is-indeterminate` progressbar with aria (:112-119; CSS styles.css:4492-4531) | run bars in ConverterView:1560-1564, PdfView:324, ImageView:160, MediaView:167, ArchiveView:128, TextView:162, AudioView:179, ColorView:164, SecurityView:102, ModularWorkspaceView:159 | (in 126) | Y/N/Y*/-/-/- |
| ArchiveTree | src/components/archive/ArchiveTree.jsx | Expand/collapse archive tree with search filter, render cap (:92), aria-expanded (:19), "No matching entries." (:106) | ArchiveView.jsx:8 | 111 | Y/Y/N/Y/N/N |
| CropSelector | src/components/image/CropSelector.jsx | Pointer-driven crop rect overlay; disabled guards drags (:54, 69) + `.crop-selector.is-disabled` (styles.css:5336); `null` without src (:125) | ImageView.jsx:8 | 161 | Y/P/N/P/N/Y |
| PdfPageOrganizer (+ fileIdentity, PREVIEW_PAGE_LIMIT) | src/components/pdf/PdfPageOrganizer.jsx | PDF.js thumbnail grid for reorder/rotate/extract/delete/duplicate; loading role=status (:335), error role=alert (:336), byte/page limit messages (:104-111, 140-147, 337), no-file empty card (:317-323), disabled threaded to every button (:341, 345, 371, 386, 389, 402, 407) | PdfView.jsx:17 (named exports also read by server/tests/ui-pdf-struct.test.ts) | 420 | Y/P/Y/Y/Y/Y |
| JobResultBody (+ 7 named sub-renderers) | src/components/results/JobResultBody.jsx | Typed result body: image preview, JSON classification (hash/compare/password/signature/metadata/media-inspect/archive-listing), text; loading notes (:199, 237, 277), error notes (:200, 238, 276), `null` unless completed+downloadUrl (:256), password reveal toggle (:64-73) | JobOutputCard.jsx:6 (named exports HashTable…ArchiveListingResult at :281-289 imported nowhere) | 289 | Y/P/Y/Y/Y/N |
| DiffView | src/components/text/DiffView.jsx | Line diff with word tokens + summary counts; "Identical" (:14); add/remove tints styles.css:5295-5296 | TextView.jsx:8 | 54 | Y/N/N/P/N/N |

### 1b. Views (src/views/*)

| Name | File | Purpose | Usage sites | LOC | States D/H/L/E/Er/X |
|---|---|---|---|---|---|
| DashboardView | src/views/DashboardView.jsx | Command center: stats strip, resume/active/recent job lists from `/api` (:26-45), quick-launch tiles | App.jsx:6; `viewMap.dashboard` App.jsx:30 (fallback :50, 133); nav tools.js:4 | 240 | Y/css/Y/Y/P/N |
| ConverterView | src/views/ConverterView.jsx | Batch conversion board: SQLite workspace hydrate, resumable XHR uploads (:483-666), SSE+poll job tracking (:114-195, 392-464), group/selection convert, filterable results footer (:1618-1839) | App.jsx:7; `viewMap.converter` App.jsx:31; nav tools.js:5 | 1972 | Y/css/Y/Y/Y/Y |
| PdfView | src/views/PdfView.jsx | PDF ops: capability-gated op catalog (:26-76, 161-189), organizer preview, tabs Workspace/Preview/Export (:323), job runner with auto-resume (:112-117) | App.jsx:8; `viewMap.pdf` App.jsx:32; nav tools.js:6 | 689 | Y/css/Y/P/P/Y |
| QrView | src/views/QrView.jsx | Dual-mode QR generate/decode with paste modal, collapsible style sections (:53-75), blob previews (:122-136) | App.jsx:9; `viewMap.qr` App.jsx:33; nav tools.js:7 | 642 | Y/css/Y/Y/P/Y |
| ImageView | src/views/ImageView.jsx | Single-image ops (optimize/resize/crop/rotate/convert/compress/strip) with CropSelector + CompareSlider | App.jsx:10; `viewMap.image` App.jsx:34; nav tools.js:8 | 236 | Y/css/Y/Y/P/Y |
| MediaView | src/views/MediaView.jsx | Video/audio inspect/trim/transcode/extract with player + TimelineRange, ffmpeg gating (:50, 133-135) | App.jsx:11; `viewMap.media` App.jsx:35; nav tools.js:9 | 245 | Y/css/Y/Y/P/Y |
| ArchiveView | src/views/ArchiveView.jsx | Create/extract/inspect archives; inspect parses job JSON into ArchiveTree (:49-73) | App.jsx:15; `viewMap.archive` App.jsx:36; nav tools.js:10 | 172 | Y/css/Y/Y/P/Y |
| TextView | src/views/TextView.jsx | Text cleanup/analyze/case/hash (server) + browser-only editor/compare/OCR-blocked modes (:19-27) | App.jsx:16; `viewMap.text` App.jsx:37; nav tools.js:11 | 232 | Y/css/Y/Y/P/Y |
| AudioView | src/views/AudioView.jsx | Audio convert/trim/normalize/inspect with WaveformStrip + TimelineRange, ffmpeg gating | App.jsx:17; `viewMap.audio` App.jsx:38; nav tools.js:12 | 275 | Y/css/Y/Y/P/Y |
| ColorView | src/views/ColorView.jsx | Browser color picker/palette/contrast/gradient + image palette extraction (:52-70); optional Sharp jobs (:72-86) | App.jsx:18; `viewMap.color` App.jsx:39; nav tools.js:13 | 265 | Y/css/Y/P/P/Y |
| SecurityView | src/views/SecurityView.jsx | Hash/compare/metadata/signature/password jobs with capability gating (:30) | App.jsx:19; `viewMap.security` App.jsx:40; nav tools.js:14 | 182 | Y/css/Y/Y/P/Y |
| DeveloperView | src/views/DeveloperView.jsx | 8 text utilities (UTIL_MAP :9-18) via `api.runJob('text', …)` (:36-47), input/output textareas | App.jsx:12; `viewMap.developer` App.jsx:41; nav tools.js:15 | 186 | Y/css/P/P/Y/Y |
| ActivityView | src/views/ActivityView.jsx | SQLite activity log with per-row delete (:49-77; optimistic + rollback :63-73) and clear-all (:31-47) | App.jsx:13; `viewMap.activity` App.jsx:42; nav tools.js:16 | 172 | Y/css/Y/Y/P/Y |
| ProfileView | src/views/ProfileView.jsx | Profile form persisted via `/api` with dirty-tracking (:41-43) and live preview aside (:112-118) | App.jsx:20; `viewMap.profile` App.jsx:43; nav tools.js:17 | 122 | Y/css/P/N/Y/Y |
| SettingsView | src/views/SettingsView.jsx | Preferences (theme/density/motion/exports) persisted in SQLite; motion via `useMotionPreference` (:8, 86-91) | App.jsx:14; `viewMap.settings` App.jsx:44; nav tools.js:18 | 193 | Y/css/P/N/Y/Y |
| AssetGalleryView | src/views/AssetGalleryView.jsx | Dev-only design-system gallery; guard `if (!import.meta.env.DEV) return null` (:20) | lazy import App.jsx:25-27; `viewMap.assets` dev-only App.jsx:45; NOT in tools.js nav (label hardcoded App.jsx:128-129; footer dev-only button App.jsx:183) | 155 | Y/css/-/-/-/- |
| ModularWorkspaceView | src/views/ModularWorkspaceView.jsx | Generic config-driven workbench (FeatureRail + options + runbar) taking `config` prop (:29) | **Unrouted/orphaned**: not in `viewMap`, zero imports under src/ (grep matches only its definition :29); referenced by server/tests/ui-workspaces-redesign-struct.test.ts:50 and ui-capability-honesty-struct.test.ts:13 | 238 | Y/css/Y/Y/P/Y |
| extraToolConfigs | src/views/extraToolConfigs.js | Five ModularWorkspaceView config objects: archiveConfig (:3-28), textConfig (:30-55), audioConfig (:57-81), colorConfig (:83-160), securityConfig (:162-186) | **Zero imports under src/**; read only by server/tests/ui-capability-honesty-struct.test.ts:12 | 186 | — (data) |

## 2. Components duplicating each other's function

1. **PageIntro ↔ WorkspaceHeader** — PageIntro is an explicit `@deprecated` adapter around WorkspaceHeader (src/components/Common.jsx:6-19 → src/components/Workbench.jsx:49); both exist; PageIntro still imported by AssetGalleryView.jsx:5 while AssetGalleryView renders WorkspaceHeader (AssetGalleryView.jsx:24-28).
2. **FileDropzone ↔ FilePicker's inline dropzone** — Common.jsx:97-119 vs FilePicker.jsx:39-65; both render a `file-dropzone` button with icon/title/subtitle/small. The Common one has 0 importers; FilePicker's is live.
3. **QrPasteModal dropzone** — QrPasteModal.jsx:292-338 (`qr-paste-dropzone`) is a third independent drop-target implementation alongside items 2's two.
4. **WorkspaceTabs ↔ SegmentedControl** — Common.jsx:200-239 vs StudioPrimitives.jsx:6-35; both `role="tablist"` mode switchers with active highlighting; WorkspaceTabs adds arrow-key roving, SegmentedControl adds icons.
5. **QrView hand-rolled tablist** — QrView.jsx:287-328 implements its own `role="tablist"` with ArrowLeft/Right/Home/End handling, parallel to WorkspaceTabs (Common.jsx:200-239, used PdfView.jsx:323) and SegmentedControl (StudioPrimitives.jsx:6-35).
6. **FeatureButton ↔ FeatureRail item** — Common.jsx:241-257 vs Common.jsx:266-279; near-identical icon+title+description buttons with active state; FeatureButton has 0 importers.
7. **Three parallel file-row renderings** — StudioPrimitives `FileRow` (StudioPrimitives.jsx:213-267, `.studio-file-row`), FilePicker queue rows (FilePicker.jsx:80-124, `.file-queue-row`), ConverterView `FileInputCard` (ConverterView.jsx:1848-1952, bespoke `file-queue-row` card). FileInputCard also carries its own `formatBytes` (ConverterView.jsx:1954-1959) duplicating FilePicker's (FilePicker.jsx:132-137). DashboardView `job-row` markup (DashboardView.jsx:129-137, 151-159, 222-233) and ActivityView `timeline-row` (ActivityView.jsx:118-141) are additional bespoke row lists not using FileRow/FileRowList (StudioPrimitives.jsx:213-275).
8. **Two live progressbar implementations** — ConverterView renders raw `progress-track/progress-fill` inline (ConverterView.jsx:1763-1777 result rows; 1913-1928 FileInputCard) while shared `ProgressWave` (Workbench.jsx:109-126) is used in the same view's runbar (ConverterView.jsx:1560-1564).
9. **Three browse-file mechanisms** — FilePicker's hidden input (FilePicker.jsx:66-76); ConverterView's own `<input id="converter-add-input" type="file" hidden>` (ConverterView.jsx:1305-1316, triggered ConverterView.jsx:1255); QrView "Replace" `document.createElement('input')` (QrView.jsx:563-573).
10. **Focus-trap logic triplicated** — Sidebar.jsx:18-52, CommandPalette.jsx:34-87, QrPasteModal.jsx:106-141: same `getFocusable` querySelector string + Tab/Escape handler in each.
11. **Textarea field pattern re-created inline** — no shared textarea field exists in Common (only TextField input, Common.jsx:141-171); `label.field-group` textarea pattern duplicated at TextView.jsx:128-131, 142-149; ProfileView.jsx:107-110; DeveloperView.jsx:129-148; ColorView inlines `field-group` color inputs (ColorView.jsx:174-177, 187-188, 195-196).
12. **Cross-file logic duplication** — checksum regex `/^[a-fA-F0-9]{32,128}$/` in both SecurityView.jsx:43 and ModularWorkspaceView.jsx:73; health probing in both App.jsx:65-78 (15s interval) and DashboardView.jsx:33 (per-load `api.health()`); motion-mode resolver duplicated index.html:22-39 vs src/hooks/useMotionPreference.js:16-35.

## 3. Primitive variants

Token baseline for reference: `:root` styles.css:1-76 (dark, 56 custom properties), `:root[data-theme="light"]` styles.css:78-96 (16 overrides), alias `:root` styles.css:3931-3935.

### 3a. Buttons — 31 distinct visual treatments

| Variant | Definition | Usage |
|---|---|---|
| `.button` base | styles.css:634-649; press animations/controls.css:6-8 | composed by all button components |
| `.button-primary` (gradient) | styles.css:651-656; sheen controls.css:12-29 | Common.jsx:34 (PrimaryButton) |
| `.button-secondary` | styles.css:658-667, light 3747-3750 | Common.jsx:59 (SecondaryButton) |
| `.button.button-ghost` | styles.css:4427-4436 | **no JSX usage** (`variant="ghost"` never passed) |
| `.button.size-sm` | styles.css:4416-4421 | JobResultBody.jsx:15, AssetGalleryView.jsx:72-73 |
| `.button.size-md` | styles.css:4423-4425 | Common.jsx:34 (default `size='md'`) |
| `.icon-button` — **defined twice** | styles.css:524-541 (40×40, r12) AND styles.css:4620-4634 (min 44×44, `var(--radius-sm)`); press shell.css:122-124 | Common.jsx:74 (IconButton, dead), Topbar.jsx:51 |
| `.icon-button.quiet` (34×34) | styles.css:543-547 | FilePicker.jsx:92 |
| `.menu-button` | styles.css:549-551, 2992-2994 | Topbar.jsx:21 |
| `.avatar-button` — 3 definition sites | styles.css:303-310, 553-559, 3197-3221; shell.css:126-132 | Topbar.jsx:54 |
| `.text-button` | styles.css:901-909, 3988 | App.jsx:183, DashboardView.jsx:114 |
| `.linkish` | styles.css:3778-3785 | ConverterView.jsx:1324, 1935-1937 |
| `.sidebar-link` (+`.active` gradient) | styles.css:361-393; motion shell.css:79-100 | Sidebar.jsx:112 |
| `.command-search` (fake-input button) | styles.css:478-490, 2996-3001 | Topbar.jsx:38 |
| `.segmented-control button` / `.tool-tabs button` | styles.css:1463-1478, 3699-3703; pop controls.css:83-92 | **no JSX usage** (`.tool-tabs` doesn't exist in JSX) |
| `.segmented-item` | styles.css:5045-5062 | StudioPrimitives.jsx:25 (SegmentedControl) |
| `.qr-tab` | styles.css:1540-1558 | QrView.jsx:309 |
| `.qr-collapse-trigger` | styles.css:1591-1606 | QrView collapse sections |
| `.style-preset` (+`.active`) | styles.css:1493-1509; workspaces.css:186-199 | **no JSX usage** |
| `.thumbnail-row button` | styles.css:2055-2065; editors.css:43-49 | **no JSX usage** |
| `.dev-tool-list button` | styles.css:2299-2318; insights.css:104-114 | DeveloperView.jsx:86-92 |
| `.command-results button` | styles.css:2845-2862, 4952-4956; controls.css:64-75 | CommandPalette.jsx:132ff |
| `.workspace-tabs button` | styles.css:3236-3256; insights.css:176-186 | Common.jsx:221-236 (WorkspaceTabs) |
| `.feature-action-button` | styles.css:3311-3335; insights.css:166-174 | Common.jsx:244 (FeatureButton — component never imported) |
| `.action-ribbon-buttons button` | styles.css:3421-3438 | **no JSX usage** |
| `.dashboard-quick-grid button` | styles.css:3446-3475; dashboard.css:240-251 | **no JSX usage** |
| `.avatar-style-grid button` | styles.css:3559-3588; insights.css:152-160 | **no JSX usage** |
| `.feature-rail-item` | styles.css:4363-4394 | Common.jsx:271 (FeatureRail) |
| `.command-launch-tile` | styles.css:4676-4707 | DashboardView.jsx:173, 196 |
| `.play-button` (circular glass) | styles.css:2151-2165; editors.css:61-82 | **no JSX usage** |
| One-off inline PDF page tile button | PdfPageOrganizer.jsx:367-380 (inline border/background/fontSize) | same file |

Related button-like surfaces: `.file-dropzone` (styles.css:1065-1082 + `.liquid-drop` 4463-4489; FilePicker.jsx:40, Common.jsx:106), `.qr-paste-dropzone` (styles.css:2651-2667; QrPasteModal.jsx:293), `.modal-scrim` rendered as `<button>` (styles.css:2586-2594), `.archive-tree-row` (styles.css:5262-5277; ArchiveTree.jsx:17), `.studio-file-row[role="button"]` (styles.css:5146-5163), `.skip-link` **defined twice** (styles.css:145-163 and 4917-4931), press-effect utility `.liquid-press` (styles.css:4438-4460).

### 3b. Inputs — 15 distinct treatments

| Variant | Definition | Usage |
|---|---|---|
| Global reset (font/color/disabled/focus/placeholder/option) | styles.css:117-143, 183-214 | all controls |
| `.field-group input/select/textarea` (canonical field) | styles.css:1164-1199; label/hint/error 4597-4617 | Common.jsx:125-169 (SelectField/TextField), ColorView.jsx:174 |
| `.toggle-row` switch (hidden checkbox, 42×24 pill) | styles.css:1209-1282; spring controls.css:95-99 | Common.jsx:183-196 (ToggleRow), SettingsView.jsx:176 |
| `.command-input input` (borderless) | styles.css:2821-2837 | CommandPalette.jsx:117ff |
| `.code-panels textarea` (dark code pane, own font stack) | styles.css:2358-2371, 3753-3758; focus editors.css:160-166 | DeveloperView.jsx:103ff |
| `.qr-color-field input[type='color']` 36×32 + small text input | styles.css:1640-1659 | QrView (qr-color-field) |
| `.color-workspace input[type="color"]` | styles.css:5407-5412 | ColorView.jsx |
| Inline color inputs, raw heights 40/44 | ColorView.jsx:176, 187, 188, 195, 196 | same |
| `.range-field input` (accent purple) | styles.css:2086-2099 | **no JSX usage** |
| `.timeline-range-sliders input[type="range"]` | styles.css:5101-5104 | StudioPrimitives.jsx:100-120 (TimelineRange) |
| `.compare-range` slider | styles.css:5211-5219 | StudioPrimitives.jsx:288ff |
| `.converted-select input` 16×16 checkbox | styles.css:3821 | ConverterView.jsx |
| `.converter-file-select-row input[type='checkbox']` | styles.css:4828-4831 | ConverterView.jsx:1366ff |
| Bare `textarea` with inline `width:'100%'` (reset-only styling) | TextView.jsx:130, 144, 148; ProfileView.jsx:109 | same |
| `.qr-frame` decode paste-box area | styles.css:1879-1887 | **no JSX usage** |

### 3c. Modal / dialog / overlay — 7 treatments

| Variant | Definition | Usage |
|---|---|---|
| `.modal-layer` + `.modal-scrim` base | styles.css:2577-2594; scrim fade controls.css:43-50 | CommandPalette.jsx:109-111, QrPasteModal.jsx:249-251 |
| `.command-palette` (620px, r20) | styles.css:2810-2819; entrance controls.css:53-61 | CommandPalette.jsx:117 |
| `.qr-paste-modal` v1 (flex column + header/body/footer 2617-2766) | styles.css:2603-2615 | QrPasteModal.jsx:260 |
| `.qr-paste-modal` v2 — **duplicate re-definition** (padding/overflow differ) + companion `.qr-paste-drop/.qr-paste-preview/.qr-paste-actions/.qr-paste-error/.qr-paste-result` set | styles.css:3847-3917 | those 5 companions (3868, 3878, 3898, 3904, 3909) **no JSX usage**; `.qr-paste-meta` (3890) **is** rendered (QrPasteModal.jsx:344) — live duplicate vs :2718; v2 re-styles the same node |
| `.qr-paste-layer` placement modifier | styles.css:2597-2601 | QrPasteModal.jsx:249 |
| `.sidebar-scrim` (mobile drawer) | styles.css:412-415, 2973-2985 | Sidebar.jsx |
| `.toast-message` (fixed glass toast) | styles.css:2875-2889, 4993-4997; glow controls.css:32-40 | App.jsx:188 |

### 3d. Cards — 30 distinct treatments

| Variant | Definition | Usage |
|---|---|---|
| `.surface-card` base | styles.css:676-681 | Common.jsx:301, DeveloperView.jsx:81 |
| `.content-card` padding modifier | styles.css:683-685, 892-899, 3106-3108 | JobOutputCard.jsx:72 |
| `.panel-card` (+head/title) | styles.css:4397-4413 | Common.jsx:301 (Panel), ArchiveView.jsx:120 |
| `.sticky-card` | styles.css:670-674, 1060-1063 | **no JSX usage** |
| `.stat-card` | styles.css:830-847; dashboard.css:223-237 | **no JSX usage** |
| `.launch-card` — **defined twice** | styles.css:917-947 AND 3477-3496; dashboard.css:254-260 | **no JSX usage** |
| `.privacy-card` (+orb) | styles.css:968-988 | **no JSX usage** |
| `.tip-card` | styles.css:1308-1334, 2387-2395 | DeveloperView.jsx:175 |
| `.estimate-box` / `.savings-panel` | styles.css:1308-1334, 2101-2105 | **no JSX usage** |
| `.pdf-module-card` (+color spans 955-966) | styles.css:1348-1375; workspaces.css:83-96 | **no JSX usage** |
| `.qr-preview-card` / `.decode-result-card` | styles.css:1523-1527, 1860-1869 | **no JSX usage** |
| `.qr-section-card` | styles.css:1573-1576 | QrView.jsx:338 |
| `.qr-result-card` | styles.css:1791-1793 | QrView.jsx:593 |
| `.image-canvas-card` / `.media-editor-card` | styles.css:1925-1928 | **no JSX usage** |
| `.illustration-card` | styles.css:3273-3299, 3977-3981 | Common.jsx:288 (IllustrationCard — dead) |
| `.profile-preview-card` | styles.css:3502-3536, 5417-5420 | ProfileView.jsx:112 |
| `.profile-editor-card` | styles.css:3502-3505 | **no JSX usage** |
| `.job-output-card` | styles.css:3843, 4033 | JobOutputCard.jsx:72 |
| `.converted-row` (row card) | styles.css:3794-3812 | ConverterView.jsx, JobOutputCard.jsx |
| `.asset-icon-card` | styles.css:4103-4125 | AssetGalleryView.jsx |
| `.sidebar-footer-card` | styles.css:395-404 | Sidebar.jsx |
| `.local-status` | styles.css:320-329 | Sidebar.jsx |
| `.alpha-empty-state` (+is-compact) | styles.css:3991-4034 | EmptyState.jsx:18 |
| `.capability-banner` | styles.css:4535-4550 | Workbench.jsx:75 |
| `.result-panel` | styles.css:4552-4574 | Workbench.jsx:88 |
| `.lifecycle-banner` (+is-running/failed/completed) | styles.css:4970-4992 | **no JSX usage** |
| `.command-strip` | styles.css:4650-4668 | DashboardView.jsx:86 |
| `.workbench-rail` / `.workbench-runbar` (glass) | styles.css:4306-4337 | Workbench.jsx:31, 37 |
| `.job-row` / `.studio-file-row` / `.file-queue-row` row cards | styles.css:4716-4725, 5146-5163, 1116-1119 | ArchiveView.jsx, StudioPrimitives.jsx, FilePicker.jsx:80 |
| One-off inline cards | ColorView.jsx:127, 135, 147, 158 (raw height/borderRadius/border clusters); ConverterView.jsx:1889 (thumb); PdfPageOrganizer.jsx:367 (tile) | same files |

Orphaned decorative card sets with zero JSX usage: `.floating-window`/`.window-front`/`.window-back` (styles.css:725-762), `.dashboard-hero` (:687-698), `.converter-group-card` (:3762 — margin rule only, no base definition), `.file-input-card`/`.file-row-card` referenced at styles.css:4832-4833 but **never defined and never used**. `.brand-proof`/`.brand-mark-proof` (:4046-4066) used only by AssetGalleryView.

Cross-cutting fact: `.icon-button`, `.skip-link`, `.qr-paste-modal`, `.segmented-control`, `.launch-card`, `.avatar-button`, `.front-end-pill` (styles.css:506-522 vs 4941-4951) each have two competing definition sites in styles.css; 21 variant classes above are fully styled (many also animated) with zero JSX render sites.

## 4. Hardcoded colors, spacing, font sizes, radii

### 4a. Token definitions (the baseline)

- Dark `:root` styles.css:1-76: 13 surface/border/text colors (:3-15), 11 accents (:18-28), 3 shadows (:31-33), 6 radii (:36-41), 7 spacing steps `--space-1..7` (:44-50), 4 shell dims (:53-56), 5 motion (:59-63), 7 typography (:66-72). Light overrides styles.css:78-96 (16 vars). Alias block styles.css:3931-3935 (3 `--brand-*`, var() refs only).
- Raw values inside token blocks: 19 hex, 21 rgba, 22 px, 12 rem (74 occurrences — these ARE the tokens).
- Token adoption in rules: 79 `var(--space-*)` occurrences (75 declarations), 36 `var(--radius-*)` occurrences (35 declarations — styles.css:4911 carries two refs in one shorthand), 19 `var(--text-{meta,section,title,body})` references — all concentrated in the post-line-4220 "UX/UI REDESIGN FOUNDATIONS"/"Studio primitives" sections; styles.css:98-4218 uses nearly all-raw values.

### 4b. Hardcoded in CSS rules (outside token blocks) — ~1,447 raw occurrences

**Hex colors — 59 total (57 in styles.css rules / 25 distinct; 1 animations; 1 index.html):**
- `#fff` ×17+1 (styles.css:307, 383, 384, 652, 653, 1273, 1475, 1476, 1853, 1978, 2043, 2160, 2172, 2252, 3701, 3702 — one comment-text at 3199; dashboard.css:132). Duplicates `--text` only in dark theme.
- `#182640` ×4 (styles.css:1991, 2079, 2082, 2083 thumb-art gradients); `#111827` ×3 (styles.css:1841, 2041, 4059 — equals light `--text` value); `#f87171` ×2 (styles.css:2644, 2646 — ≠ `--danger`); `#ef4444` ×2 (styles.css:5296, 5299 — diff remove, ≠ `--danger`); `#cdd6f4` ×2 (styles.css:2364, 3754) and `#a6e3a1` ×2 (styles.css:2370, 3758 — code-editor palette); `#5b8cff` ×2 fallback in `var(--accent, #5b8cff)` (styles.css:2665, 2666); `#6c8cff` ×2 fallback (styles.css:4825, 4826); `#c9a227` ×1 fallback for `--warning` ≠ token value (styles.css:4847); `#f8fafc` ×2 (1698, 1854); `#392e70` ×2 (391, 392); `#000` ×2 (3945, 3946); `#070911` ×2 = `--bg` re-typed (2112, 2124); `#101526` ×2 (1991, 2084).
- ×1 each: `#080b13` (2365), `#090c16` (4057), `#0b0e17` (1963), `#111a31` (2124), `#334155` (1714), `#5b6475` (1430), `#9ea8bc` (1425), `#cdd3df` (1422), `#eef1f7` (1400), `#f7f9fd` (4059). index.html:10 `#765fff` (theme-color; matches no token).

**rgb()/rgba() — 131 total (112 styles.css rules / 77 distinct; 19 animations).** Dominated by re-typed accent RGB triplets at ad-hoc alphas:
- purple `rgba(155,124,255,α)` ×28 styles.css + 3 animations, 14 distinct alphas 0.035-0.9 (e.g. styles.css:822, 868, 956, 1041, 3474; dashboard.css:88)
- cyan `rgba(73,219,232,α)` ×34 + 5, 20 distinct alphas 0.02-0.8 (e.g. styles.css:141, 520, 820, 869, 1805; editors.css:71)
- blue `rgba(93,141,255,α)` ×10 + 1 (styles.css:309, 655, 871, 960, 2002, 2014, 2140, 3215, 3519; dashboard.css:90)
- green `rgba(67,217,155,α)` ×6 + 1 (styles.css:340, 821, 870, 962, 2020, 2148); danger `rgba(255,113,136,α)` ×4 (styles.css:3736, 3773, 3774, 4935); pink `rgba(255,127,172,0.1/0.14)` ×1 + 1 (styles.css:964; dashboard.css:91); amber `rgba(244,189,94,0.1/0.14)` ×1 + 1 (styles.css:966; dashboard.css:93)
- white overlays `rgba(255,255,255,α)` ×13 + 5 at 12 distinct alphas (styles.css:677, 2032, 2161, 2182, …); black shadows `rgba(0,0,0,α)` ×6 + 1 (styles.css:1403, 1699, 1992, 3810, 3888, 5321; workspaces.css:95)
- 9 misc dark-surface literals: rgba(17,21,37,0.98)/rgba(11,15,27,0.94) (:697), rgba(15,19,32,0.78) (:729), rgba(241,245,252,0.94) (:703), rgba(5,8,15,0.68) (:1980), rgba(9,12,22,0.52) (:2163; 0.72 editors.css:81), rgba(2,4,10,0.66/0.62) (:2592, 2980).
- Additionally 35 `color-mix(...)` calls in styles.css derive tints from tokens (token-referencing, not counted as raw).

**px — 641 total (569 styles.css rules / 110 distinct; 72 animations), excluding token block's 22.** Top groups (styles.css rules): `1px` ×129 (borders), `2px` ×25, `12px` ×24, `16px` ×16, `14px` ×16, `8px` ×15, `10px` ×15, `42px` ×13, `40px` ×13, `20px` ×13, `3px` ×12, `44px` ×11, `18px` ×11, `6px` ×11, `999px` ×9, `34px` ×8, `720px` ×8.

**border-radius subset (styles.css rules): 100 raw px declarations vs 35 token-based declarations (36 occurrences — styles.css:4911 has two `var(--radius-sm)` refs in one shorthand).** Raw: `12px` ×14 (styles.css:409, 533, 1586, 1855, 2059, 2225, 2309, 2645, 2855, 3242, 3342, 3429, 3887, 3912, 4179), `14px` ×12 (:315, 782, 952, 1217, 1315, 1459, 1501, 1534, 1885, 2437, 2786, 2884), `999px` ×8-9 non-token (:512, 750, 800, 1249, 1421, 1799, 1979, 2042, 2197 — duplicates `--radius-pill`), `20px` ×7, `16px` ×7, `15px` ×7, `13px` ×7 (:372, 488, 556, 641, 1170, 1370, 2059), `8px` ×6, `18px` ×6, `11px` ×4, `10px` ×4, `17px` ×3, `22px`/`2px`/`99px` ×2 each, 9 singles (9, 6, 40, 36, 34, 26, 24, 1px, 0), `50%` ×9 (circles). `13px` and `14px` sit between tokens `--radius-sm:12px` and `--radius-md:16px`; neither exists in the token scale.

**rem — 526 total (519 styles.css rules; 7 animations) vs 79 `var(--space-*)` references.** Top: `1rem` ×85, `0.75rem` ×39, `0.8rem` ×33, `0.65rem` ×32, `0.7rem` ×28, `0.85rem` ×27, `0.55rem` ×26, `0.72rem` ×15, `0.5rem` ×14, `0.45rem` ×14, `0.35rem` ×14, `0.25rem` ×14 (this last duplicates `--space-1`), `0.9rem` ×13. Values 0.55/0.65/0.7/0.72/0.78 have no token equivalent.

**font-size — 90 hardcoded declarations in styles.css rules vs 19 token refs; 2 raw in animations** (dashboard.css:115 `0.62rem`, dashboard.css:143 `0.58rem`). Groups: `0.72rem` ×14 (styles.css:464, 502, 1091, 1333, 1450, 1802, 1982, 2183, 2191, 2355, 2546, 2574, 3435, …), `0.8rem` ×9, `0.82rem` ×9, `0.76rem` ×7, `0.78rem` ×6, `0.7rem` ×5, `1.05rem` ×4, `0.9rem` ×4, `0.75rem` ×4, `0.88rem`/`0.85rem`/`0.68rem` ×3 each, `2rem`/`1rem`/`0.95rem`/`0.74rem` ×2 each, singles incl. `0.66rem` (:2215), `0.65rem` (:5278), `1.6rem` (:840), plus 3 `clamp()` (:471, 607, 709). 26 distinct raw sizes vs the 5-token type scale (`--text-display/title/section/body/meta`).

### 4c. Hardcoded inline in JSX — 129 `style={}` occurrences across 25 files; 118 are hardcoded design values

- **Numeric px: 97 occurrences.** Value `12` ×36 across 14 files (`marginTop:12` ×29 e.g. AudioView.jsx:190, ImageView.jsx:201, ConverterView.jsx:1366, SecurityView.jsx:154, JobResultBody.jsx:54; `marginBottom:12` ×3; `borderRadius:12` ×3 ImageView.jsx:149, MediaView.jsx:150, ColorView.jsx:135; `fontSize:12` ×1 PdfPageOrganizer.jsx:367). Value `0` ×21 (mostly `margin:0`, e.g. ArchiveView.jsx:142, DashboardView.jsx:145). Value `16` ×12 across 7 files (`marginTop:16` ×5 ArchiveView.jsx:119, ImageView.jsx:147, MediaView.jsx:150; `gap:16` ×3 AssetGalleryView.jsx:32, ColorView.jsx:126, ProfileView.jsx:93; `borderRadius:16` ×3 ColorView.jsx:127, 147, 158). Value `8` ×11 across 5 files (`marginBottom:8` ×5 ConverterView.jsx:1367, JobResultBody.jsx:176; `gap:8` ×2; `borderRadius:8` ×2 ConverterView.jsx:1889, PdfPageOrganizer.jsx:367; `marginTop:8` ×2). `height:40` ×4 (ColorView.jsx:187, 188, 195, 196); `maxHeight:280` ×2 (JobResultBody.jsx:179, 190); singles: `height:44` (ColorView.jsx:176), `64` (ColorView.jsx:135), `80` (PdfPageOrganizer.jsx:380), `120` (ColorView.jsx:127), `200` (ColorView.jsx:158), `padding:24` (ColorView.jsx:147), `padding:4` (PdfPageOrganizer.jsx:367), `marginTop:4/6/10` (PdfPageOrganizer.jsx:385, ConverterView.jsx:1921, ConverterView.jsx:1512).
- **rem strings: 15 occurrences** — `'0.75rem'` ×6 (PdfView.jsx:502, 508, 517, 522; PdfPageOrganizer.jsx:340, 400), `'0.5rem'` ×6 (PdfView.jsx:578; PdfPageOrganizer.jsx:354, 400, 412, 413), `'1rem'` (PdfView.jsx:654), `'0.25rem'` (JobOutputCard.jsx:107), `'0.35rem 0'` (ProfileView.jsx:115), `fontSize:'0.7rem'` (PdfView.jsx:568).
- **Color literals in style attrs: 6** — PdfPageOrganizer.jsx:367: `#3b82f6` (fallback in `var(--accent, #3b82f6)` — a 4th distinct accent-blue fallback), `rgba(59,130,246,0.12)`, `#333` (fallback in `var(--border, #333)`); DeveloperView.jsx:82: `#f87171` (fallback in `var(--danger, #f87171)` — `--danger` token value is `#ff7188`, mismatch). Non-style state-default hex constants in JSX: ColorView.jsx:31-35 (`#9b7cff`, `#f7f8fc`, `#121727`, `#9b7cff`, `#49dbe8` — token values re-typed), QrView.jsx:18-19 (`#0f172a`, `#ffffff`).
- Remaining ~11 of 129 are dynamic/behavioral (percent widths StudioPrimitives.jsx:68, 202, 245, 288; Workbench.jsx:103, 121; ConverterView.jsx:1774, 1925; CropSelector.jsx:142-147; transforms FilePicker.jsx:98, 109; PdfPageOrganizer.jsx:378; CSS vars AgentFanOut.jsx:41, 51; grid templates TextView.jsx:141, ProfileView.jsx:93, PdfPageOrganizer.jsx:354; background URLs AssetGalleryView.jsx:149-150).
- **Accent fallback divergence**: four different hardcoded fallback values exist for the same `--accent` variable — `#5b8cff` (styles.css:2665-2666), `#6c8cff` (styles.css:4825-4826), `#3b82f6` (PdfPageOrganizer.jsx:367) — plus `#c9a227` for `--warning` (styles.css:4847).

## 5. Per-component implemented states — legend + evidence

The D/H/L/E/Er/X codes are folded into the §1 tables. Evidence citations per component:

| Component | Evidence |
|---|---|
| CommandPalette | hover `.command-results button:hover` styles.css:2859, `.is-active` styles.css:4952 + aria-selected CommandPalette.jsx:138-139; empty "No workspace found." :150; closed → `null` :106 |
| PrimaryButton | hover `.button:hover` styles.css:647, press `.liquid-press:active` styles.css:4444; `busy` → "Working…" + aria-busy Common.jsx:27, 37-42; disabled Common.jsx:26, 37 + styles.css:207 |
| SecondaryButton | `.button-secondary:hover` styles.css:665; disabled Common.jsx:52, 62; no busy prop |
| IconButton | `.icon-button:hover` styles.css:537, `:hover:not(:disabled)` styles.css:4631; disabled Common.jsx:71, 77 |
| StatusBadge | tones styles.css:3730-3736; `is-live` pulse controls.css:104 + spinning StatusIcon for converting/uploading styles.css:3957-3959; error via `tone-danger/red` styles.css:3735-3736 |
| FileDropzone | hover styles.css:1079 + workspaces.css:14-25; `active` → `is-active` styles.css:4469, 4487; **emits `is-disabled` (Common.jsx:106) with no `.file-dropzone.is-disabled` rule in styles.css or animations/** — only global `:disabled` applies |
| SelectField / TextField | error → `has-error` + `role="alert"` Common.jsx:125-136 / :156-169; CSS styles.css:4605-4615; global focus ring only; no disabled prop |
| ToggleRow | checked styles.css:1267-1271; disabled `.toggle-row.is-disabled` styles.css:1276-1281 |
| WorkspaceTabs | hover styles.css:3247, 3688; selected aria-selected + `.active` Common.jsx:228-231; roving tabindex Common.jsx:201-218 |
| FeatureButton | `.feature-action-button:hover` styles.css:3326; aria-pressed Common.jsx:244-247 |
| FeatureRail | `.feature-rail-item:hover` styles.css:4384, `.active` :4389; aria-selected Common.jsx:270 |
| EmptyState | is the empty primitive (styles.css:3991-4034); `live` → role=status EmptyState.jsx:19-20; error only via caller-passed `type="conversionFailed"` |
| FilePicker | empty dropzone with upload illustration FilePicker.jsx:53-55; disabled threaded to dropzone/arrows/remove :42, 95, 106, 119; no error or upload-progress state |
| Icon | unknown-name fallback to 'dashboard' Icon.jsx:29-32 |
| JobOutputCard | busy labels + mutual disable JobOutputCard.jsx:11-12, 114-119; failed → EmptyState conversionFailed :82-88, cancelled :89-95; `null` without job :13 |
| QrPasteModal | phases QrPasteModal.jsx:20; error alert :284-289 + styles.css:2638; decoding role=status :392-396; dropzone `is-dragover` styles.css:2664; busy gates :124, 277, 404, 412; focus trap :100-179; **`phase === 'result'` (:20, 235) immediately calls `onClose()` (:236) — declared but unrendered state** |
| Sidebar | hover styles.css:377, 3673-3674 + shell.css:94-98; active aria-current Sidebar.jsx:112-113; API `is-offline/is-online` :94 + styles.css:4932-4938; mobile focus trap :12-66 |
| StatusIcon | animated converting/uploading/inspecting styles.css:3957-3959 (reduced-motion off :3964-3966); failed/warning/offline via map StatusIcon.jsx:4-25 |
| SegmentedControl | `.segmented-item.is-active` styles.css:5057; **no `.segmented-item:hover` rule**; no disabled prop |
| TimelineRange | disabled on 4 inputs StudioPrimitives.jsx:79, 91, 107, 117; **emits `is-disabled` (:66), no matching CSS rule** |
| WaveformStrip | modes StudioPrimitives.jsx:138, 157, 178, 184; "Analyzing audio…" :206; fallback bars + message :181-186, 207; idle flat 0.2 bars :191; **mode classes `mode-idle/loading/ready/fallback` (:196) have no per-mode CSS selectors** (only `.waveform-status` styles.css:5135) |
| FileRow | selected styles.css:5160; progress mini-bar StudioPrimitives.jsx:243-247; status class + StatusIcon :226, 238; **no `.studio-file-row:hover` rule**; keyboard :230-235 |
| CompareSlider | `null` without beforeSrc StudioPrimitives.jsx:281; missing-after placeholder :286 |
| Topbar | `.avatar-button:hover` styles.css:3219, press shell.css:122-130; API pill `is-online/is-offline` Topbar.jsx:14-15 + styles.css:4932-4946 |
| CapabilityBanner | is the unavailable/error banner, role=status Workbench.jsx:73-84 |
| Skeleton / ProgressWave | are the loading primitives; shimmer styles.css:4577-4593 (motion-off :4793-4804); wave :4492-4531; aria progressbar Workbench.jsx:112-119 |
| ArchiveTree | `.archive-tree-row:hover` styles.css:5276; "No matching entries." ArchiveTree.jsx:106; aria-expanded :19; render-cap note :92 |
| CropSelector | disabled guards CropSelector.jsx:54, 69 + styles.css:5336; handle cursors styles.css:5332-5335 with no `:hover` rule |
| PdfPageOrganizer | loading role=status :335; error role=alert :336; limits :104-111, 140-147, 337; empty card :317-323; disabled on every button :341, 345, 371, 386, 389, 402, 407; selected border :367 |
| JobResultBody | "Loading preview/result/text…" :199, 237, 277; error notes :200, 238, 276; `null` gate :256; reveal toggle :64-73; **`ImageBody` declares `notify` param, never references it (:195-206)** |
| DiffView | tints styles.css:5295-5296; "Identical" DiffView.jsx:14; no explicit empty-input state |

Per-view state evidence (codes in §1b): Dashboard — Skeletons DashboardView.jsx:118, 143, 211; offline EmptyState :102-110; "Nothing to resume" :119-126; "No recent jobs" :212-219; no control ever disabled (Refresh :96, tiles :170-182 active during load). Converter — hydrate screen :1216-1230; per-file upload %/speed/ETA :1848-1952; runbar ProgressWave :1559-1565; result-row progressbars :1763-1777; "No convertible groups yet" :1338-1344; results EmptyState :1708-1723; `upload-failed` path :649-660 + danger tone :1867-1877; unsupported-files `role="alert"` :1317-1331; `row.error` :1762; per-row Retry :1802-1806; disable gating :1247-1252, 1571-1614, 1666-1685. Pdf — ProgressWave :324; live badge :308-310; caps "Detecting tools…" :618; Export empty :672-674; unavailable reasons :508-513, 617; run gate :636; `<option disabled>` :363-369. Qr — busy % :466-468, 558-560, Cancel :279-284; preview placeholder :490-493; decode empty stage :527-548; errors notify-only :158-160, 224-227, 240-246; disable while busy :466-471, 500-508, 534, 558-586, 623. Image — ProgressWave :160; loading note :156; EmptyState :157-159; notify validation :71-80; gates :124, 229. Media — ProgressWave :167; EmptyState :155-157; CapabilityBanner :133-135; notify :82-88; gates :163, 236. Archive — ProgressWave :128; EmptyState :115-117; inspect placeholder :121-123; CapabilityBanner :95; notify :32-39; inspect parse failure silently sets `[]` :70-72; gates :106, 163. Text — ProgressWave :162; EmptyState :159-161; compare hint :152; CapabilityBanner incl. blocked OCR :115-120; gate :218-222. Audio — ProgressWave :179; EmptyState :156-158; CapabilityBanner :134-139; gates :175, 266. Color — "Sampling image pixels…" :163; ProgressWave :164; `busy={extracting}` :240; swatch fallback text only :139-141 (no EmptyState component); notify :62-65, 238; gates :207-211, 240, 162. Security — ProgressWave :102; EmptyStates :95-97, 100; CapabilityBanner :86; checksum notify :41-47; gate :168-172. Developer — busy button :75 + "Running…" :145; output placeholder :145 (no EmptyState); error card `role="alert"` :80-84 + StatusBadge :73; gates :75, 114, 135. Activity — "Loading history…" :107 + aria-busy :106; EmptyState :108-117; notify-only errors :20-21, 43-44, 72 with rollback :63-72; gates :88-93, 133-140. Profile — `loading` gates save :82 and bio textarea :109 only (TextFields :102-105 stay editable); no empty state (preview `—` fallback :114); error card :88-92; gate :82. Settings — `loading` gates save :100 only; error card :105-109. ModularWorkspace — ProgressWave :159; EmptyStates :137-142, 210-212; CapabilityBanner :131-143; notify :62-77; gate :224-229.

## 6. Animation implementation

### 6a. Mechanisms and load order

- `src/main.jsx:4-5` imports `./styles.css` then `./animations/index.css`; `src/animations/index.css:4-10` is a barrel importing shell, dashboard, controls, workspaces, editors, insights, then `motion-modes.css` last (comment: overrides win cascade, index.css:1-3).
- Route entrance: every view root uses `view-stack` (17 view files, e.g. DashboardView.jsx:64); `view-fan-out` keyframes styles.css:574-594 (300ms, `var(--ease)`, stagger via `--fan-index` calc); replays on navigation because `<main key={route}>` remounts (App.jsx:176).
- Per-file inventory (animations/): shell.css 132 LOC, 6 `shell-*` keyframes, 1 transition (:127); dashboard.css 297 LOC, 10 `dash-*` keyframes, 2 transitions (:225, :255); controls.css 121 LOC, 5 `ctl-*` keyframes, 2 transitions (:19, :95); workspaces.css 210 LOC, 10 `wsp-*` keyframes, 2 transitions (:11, :21); editors.css 166 LOC, 10 `edt-*` keyframes, 2 transitions (:62, :161); insights.css 186 LOC, 9 `ins-*` keyframes, 0 transitions; motion-modes.css 76 LOC, 0 keyframes (gating only: activity pause :19-24, reduced hard-stop :31-35, blur reductions :40-68, `@supports` fallback :71-76); index.css 10 LOC barrel.
- styles.css itself contains 8 `@keyframes` (`view-fan-out` :574, `toast-in` :2891, `progress-indeterminate` :3839, `status-icon-spin`/`status-icon-breathe` :3961-3962, `progress-wave-slide` :4529, `skeleton-shimmer` :4592, `liquid-complete-pulse` :4999), 15 `animation:` declarations, 31 `transition:` declarations. Interaction transitions throughout: skip-link :157, sidebar-link :374, icon-button :534, `.button` :644, launch-card :928, file-dropzone :1076, pdf-module-card :1356, qr-tab :1551, qr-paste-dropzone :2661, mobile sidebar drawer :2963-2971, progress-fill :3833, liquid-press system :4441-4482, progress-wave-fill :4514, file chips :4374, :4688, segmented-item :5055. Mobile drawer open/close is a class-toggled transition (`.sidebar.mobile-open` :2969-2971), excluded from shell entrance by `@media (min-width: 901px)` (shell.css:67-71).
- **No rAF/WAAPI/JS-tween visual animation exists.** All `requestAnimationFrame` calls are focus management (App.jsx:148, CommandPalette.jsx:43, Sidebar.jsx:27, QrPasteModal.jsx:116). `setInterval` = API polling (App.jsx:73, ConverterView.jsx:458). Toast auto-dismiss setTimeout 2600ms (App.jsx:121-125); toast has CSS entrance (`toast-in` styles.css:2888) but is removed by conditional unmount (App.jsx:188) with no exit animation. JS state → CSS/inline styles: `data-playing` StudioPrimitives.jsx:200; inline widths/left for compare (:288), playhead (:205), file progress (:245), timeline fill (:68). One inline JS transition string: PdfPageOrganizer.jsx:378 `transition: 'transform 0.15s'` (the only transition defined in JSX). Per-element delays as inline custom props: AgentFanOut.jsx:41, 51 (`--fan-delay`).

### 6b. Motion gating

- Pre-paint bootstrap index.html:21-40: OS `prefers-reduced-motion` wins → stored `alpha-studio-motion` → device heuristic → default; sets `documentElement.dataset.motion`. index.html:38: `motion = lite ? 'balanced' : 'balanced'` — both branches assign `'balanced'`; the `lite` heuristic (:32-37) computes a value that never changes the outcome.
- Runtime hook src/hooks/useMotionPreference.js: `resolveMode` :30-35 (same heuristic; :33-34 also returns `'balanced'` on both paths); applies `<html data-motion>` :52-54; `data-power="low"` via Battery/saveData :57-77; re-resolves on OS PRM flip :80-86; syncs via CustomEvent + `storage` :89-108; `chooseMode` persists :110-122. Mounted App.jsx:63 and SettingsView.jsx:8; UI SelectField SettingsView.jsx:141-149; save mirrors to SQLite `animations` flag SettingsView.jsx:62-66.
- CSS keying: `full` opts INTO idle/infinite decoration — `html[data-motion="full"]` selectors at shell.css:104, dashboard.css:41, 109, 164, 275, workspaces.css:144, editors.css:121, 124, 146-154, insights.css:77, 146, controls.css:114. `balanced` is default-by-construction (no selector; motion-modes.css:9-10) with two explicit balanced selectors (motion-modes.css:64 blur; editors.css:120 sparse waveform). `reduced` = global `animation: none !important` (motion-modes.css:31-35) plus per-feature repeats (styles.css:3964-3966, 4799-4811, 5006-5008).
- Activity gating: src/hooks/useAnimationActivity.js:9-42 (IntersectionObserver + visibilitychange → `data-animation-active`) pairs with motion-modes.css:19-24 (`animation-play-state: paused !important`); its only consumer is AgentFanOut.jsx:19, a component imported nowhere — the entire activity-pause mechanism is currently unmounted.
- `html[data-power="low"]` kills liquid/progress-wave effects (styles.css:4772-4782); set only by useMotionPreference.js:57-77.
- OS PRM global kill styles.css:3184-3192 (`animation: none !important; transition-duration: 0.01ms !important; scroll-behavior: auto`); redundant per-feature PRM blocks also at styles.css:4785-4797, 5009-5011, 5242-5244. The two "reduced" paths differ: OS PRM neutralizes transitions (:3189) while explicit `data-motion="reduced"` preserves interaction transitions by design (motion-modes.css:30 comment) and only kills `animation`.

### 6c. Dead animation selectors (CSS animates classes no JSX renders)

- dashboard.css: `.stat-card` (:223-237), `.dashboard-quick-grid button` (:240-251), `.launch-art`/`.launch-card` (:254-260), `.data-table tbody tr` (:263-272), `.privacy-orb` (:275-277) — DashboardView renders `command-launch-tile`/`job-row` instead (DashboardView.jsx:169-196). Entire PART A `.agent-fan*` (:9-216) targets the unmounted AgentFanOut.
- editors.css: `.compare-divider` (:28), `.image-swatch label` (:38 — ImageView.jsx:148 swatch contains only `<img>`), `.thumbnail-row button` (:43-49), `.play-button` (:61-82), `.audio-track[data-playing]` equalizer (:120-126), `.track-content i` (:129-138), `.video-track[data-playing] b` (:141-143), `.mock-landscape`/`.video-gradient` (:146-154). The live `data-playing` flag is set on `.waveform` itself (StudioPrimitives.jsx:200), which no CSS selector targets — the equalizer animation can never run.
- workspaces.css: `.transport-line[data-playing]` shimmer (:54-78), `.pdf-module-card` (:83-101; base also dead styles.css:1356), `.pdf-page` (:106-122 — only `pdf-page-organizer-grid`/`pdf-page-canvas-panel` exist, PdfPageOrganizer.jsx:353, PdfView.jsx:344), `.mock-qr i.filled` (:159-165), `.qr-logo` (:173-175 — only `id="qr-logo"` exists, QrView.jsx:400), `.style-preset` (:186-210). `.file-dropzone.is-dragover` (:16, 26) never matches — `is-dragover` is only set on `.qr-paste-dropzone` (QrPasteModal.jsx:293).
- insights.css: `.timeline-marker.is-active` pulse (:77-81 — ActivityView.jsx:120 never adds `is-active`), `.legend-list span` (:92-98), `.donut-chart` (:88-90), `.profile-avatar-stage`/`.avatar-style-grid` (:142-160), `.feature-action-button`/`.workspace-tabs` (:166-186 — ModularWorkspaceView never imported).
- controls.css: `.segmented-control button.active`/`.tool-tabs button.active` pop (:83-92) — SegmentedControl uses `segmented-item is-active` (StudioPrimitives.jsx:25); `.tool-tabs` doesn't exist in JSX.
- styles.css: `.liquid-complete` pulse (:5003-5005) — class never applied in JSX; `.floating-window` blur rules (motion-modes.css:46-48, 64-68) — class unrendered.

### 6d. Consistency observations (factual, two-sites-differ)

1. `.file-dropzone` has two competing motion rules: workspaces.css:10-18 (`scale(1.012)` hover/focus/`is-dragover`, literal 200ms) vs styles.css:4463-4473 (`.liquid-drop`, `scale(1.01)` on `.is-active`/focus, `var(--duration-base/fast)` tokens) plus base hover styles.css:1076-1080. FileDropzone (Common.jsx:106) carries both classes; FilePicker (FilePicker.jsx:40) hits only workspaces.css/base. Two drag-active class conventions coexist: `is-active` (Common.jsx:106) vs `is-dragover` (QrPasteModal.jsx:293).
2. Two live indeterminate progress bars differ: `.progress-fill.is-indeterminate` translateX 1.15s ease-in-out (styles.css:3835-3842; ConverterView.jsx:1773, 1924) vs `.progress-wave.is-indeterminate .progress-wave-fill` 1.1s `var(--ease)` (styles.css:4517-4531; Workbench.jsx:113-121); a third dead variant at workspaces.css:64-78.
3. Two shimmer techniques: `skeleton-shimmer` animates `background-position` (styles.css:4587-4595); `wsp-progress-shimmer` animates `transform` (workspaces.css:70-78).
4. Two live-dot pulses: `shell-dot-pulse` 2.8s on `.status-dot` (shell.css:60-63, 104-106) vs `ctl-badge-pulse` 2.4s on `.status-badge.is-live::before` (controls.css:114-121) — different keyframes/timing, both full-gated.
5. Stagger implemented two ways: custom-prop calc `--fan-index * 45ms` (styles.css:585-594) + inline `--fan-delay` (AgentFanOut.jsx:41, 51) vs hardcoded nth-child delay ladders elsewhere (shell.css:83-91, controls.css:68-75, dashboard.css:228-251, 267-272, workspaces.css:37-42, 87-117, 190-195, insights.css:64-186, editors.css:46-49, 132-138) — 122 `animation-delay` lines total in animations/*.css.
6. Gating asymmetry: decorative infinite animations are full-gated (§6b list) while functional infinite animations run ungated in balanced: `progress-indeterminate` (styles.css:3837), `status-icon-spin`/`breathe` (:3957-3959), `progress-wave-slide` (:4519), `skeleton-shimmer` (:4589). Within editors.css, the equalizer is mode-gated (:120-126) while the playhead pulse in the same section gates only on `data-playing` (:141-143).
7. Reduced-mode overrides exist at two layers: global motion-modes.css:31-35 plus per-feature `html[data-motion="reduced"]` repeats (styles.css:3964-3966, 4799-4811, 5006-5008) that the global already covers; `.progress-fill.is-indeterminate` has no per-feature reduced rule and relies solely on the global kill (leaving a frozen `width: 32% !important` bar, styles.css:3836).
8. Duration/easing token adoption splits by layer: `--duration-fast/base/slow` (styles.css:61-63) used in exactly 8 declarations, all in styles.css (:4374, 4441, 4454, 4466, 4482, 4514, 4688, 5055 — the liquid subsystem); `--duration-slow` used zero times anywhere; all of src/animations/*.css hardcodes times (0 `var(--duration` hits; 184 declaration lines with literal ms). `var(--ease)` is shared (56 uses in animations/, 19 in styles.css) but raw `ease`/`ease-in-out`/`linear` appear in 16 animations/ declarations plus styles.css (e.g. :374, 1551, 3837, 4589); one one-off spring `cubic-bezier(0.34, 1.4, 0.6, 1)` (controls.css:97).
9. Property-less transition shorthand (`transition: 180ms ease`) at styles.css:374, 534, 1252, 1264, 1404, 3216, 3244, 3323, 3431, 3458, 3569, 4114 and `220ms/200ms var(--ease)` (:928, 1076, 1356) vs explicit property lists elsewhere (:644, 4441, 4466; controls.css:19-25; workspaces.css:11).
10. One JSX-inline transition (PdfPageOrganizer.jsx:378, `transform 0.15s`, no token, no easing) while every other transition lives in CSS.
11. index.html bootstrap duplicates the hook's motion resolver (index.html:22-39 vs useMotionPreference.js:16-35); in both, the device-heuristic branch is a no-op (`lite ? 'balanced' : 'balanced'`, index.html:38; parallel useMotionPreference.js:33-34).

## Appendix: recorded defects (file:line, not fixed)

1. `FileDropzone` emits `is-disabled` (src/components/Common.jsx:106) — no `.file-dropzone.is-disabled` rule in src/styles.css or src/animations/*.css.
2. `TimelineRange` emits `is-disabled` (src/components/StudioPrimitives.jsx:66) — no matching CSS rule.
3. `WaveformStrip` mode classes `mode-idle/loading/ready/fallback` (StudioPrimitives.jsx:196) have no per-mode CSS selectors (only `.waveform-status` styles.css:5135).
4. QrPasteModal `phase === 'result'` (QrPasteModal.jsx:20, 235) immediately calls `onClose()` (:236) — declared-but-unrendered state.
5. Legacy CSS block for a previous QrPasteModal markup styles.css:3868-3923: `.qr-paste-drop` (:3868), `.qr-paste-preview` (:3878), `.qr-paste-actions` (:3898), `.qr-paste-error` (:3904), `.qr-paste-result` (:3909) are absent from JSX (dead); `.qr-paste-meta` (:3890, responsive :3923) IS rendered (QrPasteModal.jsx:344) and is a live competing definition vs :2718; `.qr-paste-modal` itself duplicated (:2603 vs 3847).
6. Dead component AgentFanOut retains live CSS (animations/dashboard.css:9-216) and is the sole consumer of src/hooks/useAnimationActivity.js (AgentFanOut.jsx:3, 19), leaving the activity-pause mechanism (motion-modes.css:19-24) unmounted.
7. `JobResultBody` `ImageBody` declares a `notify` parameter it never references (JobResultBody.jsx:195-206).
8. `.waveform` receives `data-playing` (StudioPrimitives.jsx:200) but no CSS selector targets it; the equalizer animation targets `.audio-track[data-playing]` (editors.css:120-126) and can never run.
9. `.file-input-card`/`.file-row-card` referenced at styles.css:4832-4833 but never defined and never used.
10. index.html:38 and useMotionPreference.js:33-34: device-heuristic branch assigns `'balanced'` on both paths (no-op).
11. ModularWorkspaceView (src/views/ModularWorkspaceView.jsx:29) and extraToolConfigs (src/views/extraToolConfigs.js) have zero imports under src/ while remaining referenced by server struct tests (server/tests/ui-workspaces-redesign-struct.test.ts:50, ui-capability-honesty-struct.test.ts:12-13).
