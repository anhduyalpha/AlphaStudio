# Audit: Frontend, browser, responsive, accessibility

**Program:** AlphaStudio stable baseline  
**Scope lane:** (c) Frontend, browser behavior, responsive behavior, accessibility only  
**Baseline audited:** mainline / stabilize tree under `src/` (shipped product UI)  
**Date:** 2026-07-24  
**Method class:** static inspection (no live browser session run for this audit)  
**Branch note:** `ux-ui-redesign` is **37 commits ahead of main** and is **out of scope** for this baseline. Claims below describe mainline `src/` as shipped, not redesign-branch UI.

---

## Scope

In scope:

- Shell: hash routing, sidebar/topbar, command palette, toasts (`src/App.jsx`, `src/components/Sidebar.jsx`, `Topbar.jsx`, `CommandPalette.jsx`)
- Views and shared job/upload UI (`src/views/*`, `ModularWorkspaceView.jsx`, `ConverterView.jsx`, `PdfView.jsx`, `QrView.jsx`)
- Shared components: `Common.jsx`, `EmptyState.jsx`, `FilePicker.jsx`, `JobOutputCard.jsx`, `QrPasteModal.jsx`, `pdf/PdfPageOrganizer.jsx`, `Icon.jsx`, `StatusIcon.jsx`
- Motion / animation gates: `src/hooks/useMotionPreference.js`, `useAnimationActivity.js`, `src/animations/*`, `index.html` bootstrap
- Live updates: `useWorkspaceEvents.js`, `useJobRunner.js`, `useWorkspace.js`, converter SSE wiring
- Styles: `src/styles.css` tokens, breakpoints, focus, reduced-motion, readability safety net
- Structural UI tests: `server/tests/ui-*.test.ts`
- Browser e2e support: `e2e/pdf-tools.spec.js`, `e2e/support/browser-audit.js`
- Entry / PWA surface: `index.html`, `public/manifest.webmanifest`, `vite.config.js` (dev proxy only)

Out of scope for this document:

- Backend job engine correctness (see audit 02)
- Security of API tokens / upload validation (see audit 07)
- Full test-coverage metrics (see audit 04)
- Product redesign work on `ux-ui-redesign`
- Any product code changes (this audit is documentation only)

---

## Method

1. **Static source inspection** of shell, components, views, hooks, CSS, and HTML bootstrap.
2. **Structural test review** of all `server/tests/ui-*.test.ts` files for what they assert about a11y/responsive/contrast/motion.
3. **E2E review** of Playwright PDF baseline for role-based selectors and browser error capture (not a full a11y run).
4. **No browser was launched** for this audit: no axe-core scan, no real keyboard walkthrough, no computed contrast measurement, no device-emulation screenshots. Severity of visual/contrast items is therefore **inferred from tokens and CSS**, not measured.

Confidence levels used below:

| Tag | Meaning |
|-----|---------|
| **S** | Source-proven (file/line pattern exists) |
| **T** | Covered by structural unit test (string match) |
| **I** | Inferred risk (pattern gap; needs runtime confirmation) |

---

## Evidence citations

### Entry, theme, motion bootstrap

| Item | Location |
|------|----------|
| `lang="en"`, viewport, theme-color, manifest, pre-paint theme + motion | `index.html` L2–L47 |
| Motion resolution: OS reduce wins → stored → balanced default | `index.html` L21–L40; `src/hooks/useMotionPreference.js` L28–L35, L45–L76 |
| App applies theme + motion; hash routing; Ctrl/Cmd+K; Escape closes palette; toast | `src/App.jsx` L47–L136 |
| Main landmark, route key remount | `src/App.jsx` L123–L127 |
| Vite dev proxy `/api` → `:8787` | `vite.config.js` L7–L14 |

### Navigation / shell

| Item | Location |
|------|----------|
| Sidebar `nav` labelled “Studio navigation”; mobile scrim + close | `src/components/Sidebar.jsx` L10–L54 |
| Active route is CSS class only (no `aria-current`) | `Sidebar.jsx` L43–L51 |
| Menu / theme / profile controls labelled | `src/components/Topbar.jsx` L8–L27 |
| Command search button text “Search tools”; **no `aria-label`** | `Topbar.jsx` L18–L22 |
| Mobile: search label + kbd **hidden** (`display: none`) | `src/styles.css` L2917–L2927 |
| Drawer at `max-width: 900px` | `styles.css` L2875–L2932 |
| Command palette dialog role + label; **no focus trap / restore** | `src/components/CommandPalette.jsx` L5–L9 |
| Escape closes command palette only via App window keydown | `App.jsx` L73–L83 |

### Focus, keyboard, ARIA patterns

| Item | Location |
|------|----------|
| Global `:focus-visible` outline (cyan) | `styles.css` L93–L100 |
| Resting control text colors + placeholder muted | `styles.css` L102–L135 |
| `WorkspaceTabs`: `role="tablist"` / `role="tab"` / `aria-selected` only | `src/components/Common.jsx` L124–L140 |
| QR tabs same incomplete tab pattern | `src/views/QrView.jsx` L286–L304 |
| QrPasteModal: dialog, labelled, Escape, **Tab focus trap**, focus restore | `src/components/QrPasteModal.jsx` L99–L179, L249–L263 |
| Structural a11y asserts for paste modal | `server/tests/ui-qr-paste-struct.test.ts` L28–L34 |
| Icons decorative by default; optional `label` → `role="img"` | `src/components/Icon.jsx` L34–L68 |
| Ambient chrome `aria-hidden` | `App.jsx` L118–L119 |
| PDF organizer `aria-pressed` / page move labels | `src/components/pdf/PdfPageOrganizer.jsx` L335–L389 |
| File queue move/remove labels | `src/components/FilePicker.jsx` L91–L122 |

### Motion / reduced motion

| Item | Location |
|------|----------|
| `html[data-motion="reduced"]` hard-stops animations | `src/animations/motion-modes.css` L26–L35 |
| `@media (prefers-reduced-motion: reduce)` kill-switch | `styles.css` L3103–L3113 |
| Activity gating pauses offscreen animation groups | `useAnimationActivity.js`; `motion-modes.css` L15–L24 |
| Contrast test asserts reduced-motion + fill-mode both | `server/tests/ui-contrast.test.ts` L113–L127 |
| Settings “Subtle animations” toggle **not wired** to `useMotionPreference` / `data-motion` | `src/views/SettingsView.jsx` L77–L82 vs `App.jsx` L60 |

### Job UI feedback, empty/error, live SSE

| Item | Location |
|------|----------|
| Global toast `role="status"`, auto-clear 2600ms | `App.jsx` L85–L88, L135 |
| `JobOutputCard` `aria-live="polite"`; failed/cancelled `EmptyState` | `src/components/JobOutputCard.jsx` L69–L92 |
| Shared empty states + optional live status | `src/components/EmptyState.jsx` L17–L21 |
| Dashboard offline empty | `src/views/DashboardView.jsx` (offline `EmptyState`) |
| Modular workspaces: busy badge, % text, `JobOutputCard` | `ModularWorkspaceView.jsx` L223–L257 |
| Converter progressbars: `role="progressbar"` + `aria-valuenow` only | `ConverterView.jsx` L1472–L1476, L1648–L1658 |
| SSE hook with backoff + reconnect callback | `src/hooks/useWorkspaceEvents.js` full file |
| Converter wires SSE + poll fallback | `ConverterView.jsx` L178–L182, L342+; `ui-live-converter-struct.test.ts` |
| Job runner status/progress/notify | `src/hooks/useJobRunner.js` |
| No UI connection-status indicator for SSE health | (absence across shell + converter) |

### Responsive breakpoints (shipped CSS)

| Breakpoint | Notable behavior | File |
|------------|------------------|------|
| 1260 / 1080 / 1180 / 820 / 560 | layout density | `styles.css` |
| **900px** | single column; sidebar off-canvas; menu button; search compact | `styles.css` L2875–L2932; `motion-modes.css` L40–L56 |
| **720px** | page intro stacks; grids → 1–2 col | `styles.css` L2935–L3008 |
| **520px** | hide topbar subtitle + avatar; ambient lights off | `styles.css` L3011+; `motion-modes.css` L58–L61 |
| 920 / 640 | asset gallery / empty compact | `styles.css` L4121–L4138 |
| `body { min-width: 320px }` | floor | `styles.css` L63–L66 |
| Primary controls `min-height: 44px` | touch target baseline | `styles.css` L555–L557 |

### Contrast / design-system tests

| Item | Location |
|------|----------|
| Dark/light text tokens asserted non-transparent | `server/tests/ui-contrast.test.ts` L53–L111 |
| Dark `--text: #f7f8fc`; light `--text: #111827` | `styles.css` L12–L14, L47–L49 |
| Muted tokens `#717b90` / `#6b7280` | `styles.css` L14, L49 |
| Readability safety net section | `styles.css` ~L3580+; test L129–L132 |
| Icon sprite + empty illustration a11y structure | `ui-assets-design-system.test.ts` L100–L152 |
| QR tablist / responsive 900px CSS | `ui-qr-lab-struct.test.ts` |
| PDF organizer `aria-pressed` | `ui-pdf-struct.test.ts` |

### E2E (browser behavior sample, not a11y suite)

| Item | Location |
|------|----------|
| Role-based nav to PDF Studio | `e2e/pdf-tools.spec.js` L8–L13 |
| Tabs, buttons, labels used as selectors | same file |
| Console/page/HTTP failure soft-asserts | `e2e/support/browser-audit.js` |

---

## Findings

Severity scale: **P0** ship-blocker for primary use/a11y · **P1** high impact primary path · **P2** medium / secondary path · **P3** polish · **P4** docs/tests/hygiene.

### Strengths (no severity)

| ID | Note | Evidence |
|----|------|----------|
| S1 | Pre-paint theme + motion bootstrap avoids FOUC / motion flash | `index.html` |
| S2 | OS `prefers-reduced-motion` wins over stored choice; dual CSS kill-switches | `useMotionPreference.js`, `motion-modes.css`, `styles.css` |
| S3 | Global `:focus-visible` and resting control colors (anti white-on-white) | `styles.css` |
| S4 | QrPasteModal is the best modal a11y implementation (trap, Escape, restore, alerts) | `QrPasteModal.jsx` |
| S5 | Empty/error illustration system + failed job cards | `EmptyState.jsx`, `JobOutputCard.jsx` |
| S6 | Icon registry is accessible-by-default (decorative unless labelled) | `Icon.jsx`, design-system test |
| S7 | Responsive drawer + multi-breakpoint layout exists with 44px button floor | `styles.css` |
| S8 | Structural UI tests freeze several a11y/contrast contracts | `ui-contrast`, `ui-qr-paste`, `ui-pdf-struct`, `ui-assets-*` |
| S9 | Converter live path: SSE + poll fallback + progress rows | `useWorkspaceEvents`, `ConverterView` |

---

### P0 — Critical

_No P0 identified from static inspection alone._  
(Nothing found that self-evidently makes the app unusable for all users without runtime confirmation. Several **P1** items would become P0 if runtime axe/keyboard audit confirms nameless controls or trapped focus.)

---

### P1 — High

| ID | Finding | Why it matters | Evidence | Confidence |
|----|---------|----------------|----------|------------|
| **F1** | **Command palette lacks focus management** | Dialog has `role="dialog"` + `aria-modal` but: no Tab trap, no focus return on close, no arrow-key result navigation, scrim is a focusable button in tab order. Background content remains keyboard-reachable. Violates modal expectations. | `CommandPalette.jsx` (single-line component); compare to `QrPasteModal.jsx` L99–L179 | **S** |
| **F2** | **Mobile command-search likely loses accessible name** | At `≤900px`, `.command-search span` and `kbd` are `display: none`. Visible child is decorative `Icon` (`aria-hidden` by default). Button has **no `aria-label`**. Screen-reader / name calculation may yield empty or icon-only empty control. | `Topbar.jsx` L18–L22; `styles.css` L2917–L2927; `Icon.jsx` L61 | **S** + **I** (runtime name needed) |
| **F3** | **Mobile nav drawer has no focus trap / Escape / inert background** | Scrim click + close button exist, but focus can leave drawer into main content; Escape does not close drawer (only command palette); no `aria-expanded` on menu button; no `aria-modal`/`role="dialog"` pattern for drawer. | `Sidebar.jsx`; `App.jsx` key handler only palette; `styles.css` L2875–L2915 | **S** |
| **F4** | **Settings “Subtle animations” is a dead control for real motion** | App motion is governed by `useMotionPreference` → `html[data-motion]`. Settings toggle persists SQLite `animations` flag only; never calls `setMode` / never reads OS preference. Users who open Settings to reduce motion (without OS flag) get false assurance. | `SettingsView.jsx` L77–L82; `App.jsx` L60; `useMotionPreference.js` | **S** |

---

### P2 — Medium

| ID | Finding | Why it matters | Evidence | Confidence |
|----|---------|----------------|----------|------------|
| **F5** | **Incomplete tab pattern** | `role="tablist"` / `tab` / `aria-selected` without: arrow-key roving tabindex, `aria-controls`, `role="tabpanel"`, or `id` associations. Affects `WorkspaceTabs` (many modular tools) and QR Lab. | `Common.jsx` L124–L140; `QrView.jsx` L286–L304 | **S** |
| **F6** | **Sidebar active route not exposed to AT** | Active item uses CSS `.active` only; no `aria-current="page"`. | `Sidebar.jsx` L46 | **S** |
| **F7** | **No skip link / route focus move** | Hash navigation remounts `<main key={route}>` but does not move focus into main or update `document.title`. Keyboard and SR users get weak context on “page change”. | `App.jsx` L101–L108, L123; no `document.title` usage in `src/` | **S** |
| **F8** | **Progressbars incomplete for AT** | Converter tracks expose `role="progressbar"` + `aria-valuenow` but omit `aria-valuemin`/`aria-valuemax` (and often accessible name). Modular/PDF show `%` text only (no progressbar role). | `ConverterView.jsx` L1472, L1648–L1652; `ModularWorkspaceView.jsx` L241; `PdfView.jsx` progress text | **S** |
| **F9** | **SSE / live reconnect is silent in UI** | Reconnect + snapshot merge exists; users never see “reconnecting / live / offline events” state in shell. Failures surface only via toast if higher-level notify fires. | `useWorkspaceEvents.js`; Converter reconnect handler swallows some errors | **S** + **I** |
| **F10** | **Settings theme/density largely decoupled from shell** | Appearance “Color theme” options write SQLite settings; live theme is `localStorage` + topbar toggle. Density option has no clear CSS consumer in shell. Confusing personalization story. | `SettingsView.jsx` L58–L74; `App.jsx` L54–L71 | **S** |
| **F11** | **Contrast guarantees are structural, not WCAG ratios** | `ui-contrast.test.ts` checks tokens are “solid-ish” and light text isn’t white; does **not** compute 4.5:1 / 3:1. `--text-muted` on dark/light glass surfaces may fail small-text contrast especially on translucent cards. | tokens `styles.css`; test L40–L80 | **T** + **I** |
| **F12** | **Glass/backdrop surfaces can drop contrast on unsupported or light themes** | `@supports not (backdrop-filter)` fallback exists for shell, but many translucent `rgba` surfaces remain. | `motion-modes.css` L70–L76; surface tokens | **I** |

---

### P3 — Low / polish

| ID | Finding | Evidence |
|----|---------|----------|
| **F13** | Toast is only global live region; auto-dismiss 2.6s may be too fast for SR users reading long errors | `App.jsx` L85–L88, L135 |
| **F14** | StatusBadge `live` class is visual; not an ARIA live region by itself | `Common.jsx` L36–L44 |
| **F15** | Hidden file input in `FilePicker` relies on dropzone button (good) but has no associated visible `<label for>` | `FilePicker.jsx` L66–L76 |
| **F16** | Hash routing without History API means limited “real URL” semantics; deep links work via `#/` but no title/meta per route | `App.jsx` `getRoute` |
| **F17** | `lang="en"` only; no i18n path (acceptable for local EN studio, note only) | `index.html` |
| **F18** | Profile avatar link hidden at `≤520px` (still reachable via sidebar Profile) | `styles.css` L3011–L3014 |
| **F19** | Suspense fallback “Loading workspace…” is plain text, not polite live/status | `App.jsx` L124 |

---

### P4 — Tests / process

| ID | Finding | Evidence |
|----|---------|----------|
| **F20** | No automated axe / `@axe-core/playwright` (or equivalent) gate | e2e only PDF functional + console audit |
| **F21** | No Playwright keyboard/mobile drawer suite | `e2e/pdf-tools.spec.js` only |
| **F22** | Structural a11y tests are regex on source — valuable but brittle and incomplete vs runtime | all `ui-*-struct.test.ts` |
| **F23** | `ux-ui-redesign` may already change shell a11y; do not merge without re-audit | `docs/stabilize/STATE.md` / TOPOLOGY |

---

## Proposed implementation plan

Ordered for stabilize baseline (fix-first, no redesign merge):

### Phase A — Keyboard & dialog correctness (P1)

1. **Command palette parity with QrPasteModal**  
   - Focus first control on open; Tab cycle within palette; restore focus on close.  
   - Mark scrim `tabIndex={-1}` or non-focusable; keep click-to-close.  
   - Optional: ↑/↓ to move among results; Enter to activate.  
   - Structural test: assert focus-trap keywords / handlers (like `ui-qr-paste-struct`).

2. **Topbar search accessible name**  
   - Always set `aria-label="Search tools"` (or `aria-labelledby`) on `.command-search`, independent of visible span.

3. **Mobile drawer**  
   - `aria-expanded` on menu button; Escape closes drawer when open; optional focus move into nav on open + restore on close; consider `inert` on main column while open (or simple focus trap).

### Phase B — Navigation semantics (P2)

4. `aria-current="page"` on active sidebar link.  
5. On `navigate()`, set `document.title` to `${label} · AlphaStudio` and optionally `mainRef.focus({ preventScroll: true })` with `tabIndex={-1}` on `<main>`.  
6. Add skip link: “Skip to main content” → `#main-content`.

### Phase C — Tabs & progress (P2)

7. Extend `WorkspaceTabs` + QR tabs: roving `tabIndex`, ArrowLeft/Right, Home/End; associate `tabpanel` regions.  
8. Progressbars: `aria-valuemin={0}` `aria-valuemax={100}` `aria-label` (file name or “Conversion progress”). Consider one shared `ProgressBar` component.

### Phase D — Motion settings honesty (P1)

9. Wire Settings appearance to real shell state:  
   - Motion select: Full / Balanced / Reduced → `useMotionPreference().setMode` (and clarify OS override).  
   - Theme select: apply `document.documentElement.dataset.theme` same as topbar, or remove misleading options.  
   - Or label Settings fields as “defaults for export/jobs only” if intentionally server-only (today’s copy says otherwise).

### Phase E — Live job feedback (P2–P3)

10. Optional compact “Live” / “Reconnecting…” indicator when workspace SSE errors (Converter first).  
11. Keep toasts for ephemeral notify; ensure hard failures also appear in-page (`role="alert"`) for converter/PDF (partially present via `role="alert"` unsupported block and JobOutputCard).

### Phase F — Contrast & verification (P2/P4)

12. Run computed contrast check (axe or custom) on dark + light for: body text, muted labels, secondary buttons, sidebar links, status badges on glass.  
13. Add Playwright smoke: open each primary nav target, assert no console errors (extend browser-audit), axe scan on Dashboard/Converter/PDF/QR.  
14. Add one keyboard e2e: open palette with Ctrl+K, Escape closes; open mobile menu (viewport 390), Escape closes.

### Phase G — Explicit non-work

15. **Do not** land `ux-ui-redesign` as a silent a11y fix. Re-audit after any merge.  
16. Do not expand visual redesign under stabilize checkpoints unless master plan opens a UI fix ticket.

---

## Dependencies

| Dependency | Notes |
|------------|--------|
| Shared modal focus primitive | Command palette + future dialogs should reuse QrPasteModal pattern (extract small `useFocusTrap`) |
| Settings vs shell state ownership | Needs product decision: client-local (`localStorage` / `data-motion`) vs SQLite settings |
| SSE UI status | Depends on client already exposing open/error (hook has onOpen/onError paths via api) |
| Playwright a11y | Add `@axe-core/playwright` or equivalent; CI currently has no workflow (see audit 08) |
| Design tokens | Contrast fixes may only need token tweaks in `styles.css` light/dark |
| Branch topology | Fixes target stabilize/mainline `src/`; redesign branch may conflict |

---

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| Focus trap regressions break paste/command flows | High | Structural tests + one Playwright keyboard test per modal |
| Raising muted contrast reduces “premium glass” aesthetic | Low | Adjust tokens only; keep dark/light pairs tested |
| Wiring Settings motion/theme may surprise users with existing SQLite rows | Medium | Migration: if OS reduce → reduced; else map `animations=false` → reduced |
| `inert` / focus trap on mobile drawer can trap if close control broken | Medium | Always keep scrim + Escape + close button; test disabled JS? N/A SPA |
| Over-asserting ARIA without behavior (tabs) confuses AT | Medium | Prefer correct pattern over incomplete roles; either full tabs or plain buttons |
| Redesign branch merge reverts stabilize a11y fixes | High | Re-audit on merge; protect with tests |

---

## Unknowns

1. **Runtime accessible names** for compact topbar controls after CSS `display: none` (needs browser computed name).  
2. **Actual WCAG contrast ratios** on translucent cards (needs pixel/token computation or axe).  
3. Whether **density** setting is consumed anywhere outside Settings UI.  
4. Behavior of **hash route + screen reader page announcements** across NVDA/VoiceOver (not tested).  
5. Whether job-level **SSE EventSource with API token** degrades to poll-only in some builds (`client.js` has token branches) and how UI should describe that.  
6. Content of **`ux-ui-redesign`** relative to these findings (not inspected).  
7. Touch devices: whether 42–44px control heights meet hit targets for all icon-only buttons (sidebar-close, queue actions) — static CSS only.

---

## Explicit non-claims

- This audit **does not** declare the frontend stable, accessible, or WCAG 2.x AA compliant.  
- **No browser was run** for this audit; no axe report, no screenshot set, no real keyboard session.  
- **No product code was modified**; only this document under `docs/stabilize/audits/`.  
- Structural `ui-*.test.ts` **passing** does not prove runtime accessibility.  
- Playwright PDF e2e **passing** does not prove responsive or a11y correctness beyond that flow.  
- **Contrast** findings about muted/glass are risk assessments, not measured failures.  
- **`ux-ui-redesign`** was not audited; mainline is the baseline.  
- Backend correctness of jobs/SSE payloads is assumed only as “UI consumes APIs”; protocol correctness is out of scope.  
- Security of file handling, tokens, and downloads is out of scope (audit 07).  
- Completeness of unit/e2e coverage metrics is out of scope (audit 04).

---

## Top findings (executive summary)

1. **P1 — Command palette is a fake modal:** dialog semantics without focus trap/restore (unlike `QrPasteModal`).  
2. **P1 — Mobile search control may be nameless** when label text is CSS-hidden and icon is decorative.  
3. **P1 — Mobile sidebar drawer** lacks Escape, focus containment, and expanded state on the menu button.  
4. **P1 — Settings “Subtle animations”** does not control real motion (`data-motion` / OS reduce path).  
5. **P2 — Tabs and progressbars** use partial ARIA (good intent, incomplete for AT).  
6. **P2 — Navigation** lacks `aria-current`, skip link, and route title/focus management.  
7. **P2 — Live SSE** reconnect is silent; job feedback is strong via cards/toasts but connection health is invisible.  
8. **Strength:** reduced-motion dual path, focus-visible, empty/error system, and QrPasteModal a11y are solid foundations to extend.  
9. **Tests:** structural contrast/a11y freezes exist; **no runtime a11y gate**.  
10. **Baseline:** mainline `src/` only; redesign branch excluded.

---

*End of audit 03 — Frontend, browser, responsive, accessibility.*
