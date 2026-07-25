# AlphaStudio UX/UI Redesign — Baseline Inventory

**Branch:** `ux-ui-redesign`  
**Base commit:** `ed460ee763663eef3f0aae9080eeb5e15c68fe1c`  
**Date:** 2026-07-23  
**Skills:** `ux-ui-pro-max` (`C:\Users\Duy\.codex\skills\ux-ui-pro-max`), `taste` / `design-taste-frontend` (`C:\Users\Duy\.codex\skills\taste-skills`, `C:\Users\Duy\.claude\skills\design-taste-frontend`)

## Design read (taste)

**Reading this as:** redesign-overhaul of a local-first desktop utility suite for power users and solo operators, with premium minimalist + restrained liquid/glass language, leaning toward the existing custom CSS token system (not a marketing landing page stack).

**Dials (product UI override of taste landing defaults):**

| Dial | Value | Rationale |
|------|-------|-----------|
| DESIGN_VARIANCE | 5 | Predictable tool layouts; asymmetric marketing patterns would harm workflow |
| MOTION_INTENSITY | 4 | Purposeful feedback only; no cinematic scroll hijacks |
| VISUAL_DENSITY | 6 | Daily-app density for multi-control workspaces |

## Stack and style entry points

| Area | Path |
|------|------|
| App shell / routing | `src/App.jsx` (hash routes) |
| Global styles / tokens | `src/styles.css` |
| Motion CSS | `src/animations/*.css` |
| Shared components | `src/components/*` |
| Views | `src/views/*` |
| Asset registry | `src/assets/registry.js` |
| Navigation data | `src/data/tools.js` |
| Hooks | `src/hooks/*` |
| API client | `src/api/client.js` |
| Backend | `server/src/*` |
| UI struct tests | `server/tests/ui-*.test.ts` |

## Route inventory (verified against `src/App.jsx` + `src/data/tools.js`)

| Route | View | Group | Primary user goal |
|-------|------|-------|-------------------|
| dashboard | DashboardView | Studio | See system health, resume work, launch tools |
| converter | ConverterView | Core tools | Batch convert files across formats |
| pdf | PdfView | Core tools | Merge/split/optimize/reorder PDF pages |
| qr | QrView | Core tools | Encode and decode QR codes |
| image | ImageView | Core tools | Resize, compress, crop, watermark images |
| media | MediaView | Core tools | Trim media, extract audio |
| archive | ArchiveView | More tools | Compress/extract archives |
| text | TextView | More tools | OCR, compare, clean text |
| audio | AudioView | More tools | Trim/normalize/convert audio |
| color | ColorView | More tools | Palettes, contrast, gradients |
| security | SecurityView | More tools | Hash, metadata, passwords |
| developer | DeveloperView | More tools | JSON, Base64, URL, hash helpers |
| activity | ActivityView | Manage | Job history and recovery |
| profile | ProfileView | Manage | Local profile identity |
| settings | SettingsView | Manage | Theme, motion, runtime prefs |
| assets (DEV) | AssetGalleryView | Development | Design asset gallery |

## Per-route baseline

### dashboard

- **Primary object:** operational overview (stats, jobs, health)
- **Current layout:** PageIntro + marketing-style hero card + equal stat cards + tool card gallery + recent jobs
- **Hierarchy:** hero dominates; operational data secondary
- **Primary action:** "New conversion" / "Launch converter"
- **Backend:** `api.stats()`, `api.listJobs()`, `api.health()`
- **Structural UX problems:** marketing hero/card gallery; weak unfinished-work focus; equal tool tiles
- **Recommended workspace type:** command center
- **High-risk logic:** health/offline EmptyState; real job list only

### converter

- **Primary object:** file batch + format/engine selection
- **Current layout:** workspace restore, file list, group/format selectors, run, results
- **Primary action:** Start conversion
- **Backend:** upload, detect, convert jobs, workspace recover/hydrate/patch
- **Structural UX problems:** dense controls compete with files/results; settings not progressive
- **Recommended workspace type:** conversion board
- **High-risk logic:** workspaceId, skipUploadEffect, hydrated files, engine/group routing

### pdf

- **Primary object:** PDF document + page thumbnails
- **Current layout:** operation tabs, file picker, options, page organizer, job output
- **Primary action:** Run selected PDF operation
- **Backend:** PDF job types, page selection, passwords, capabilities
- **Structural UX problems:** options and pages compete; multi-file vs page-organizer unclear
- **Recommended workspace type:** document page workspace
- **High-risk logic:** page selection, password redaction, organizer state

### qr

- **Primary object:** QR encode form / decode image
- **Current layout:** dual-panel encode/decode
- **Recommended workspace type:** inspector + focused form
- **High-risk logic:** paste modal, decode errors

### image / media / audio

- **Primary object:** media asset + transform controls
- **Recommended workspace types:** image canvas; media/audio timeline
- **High-risk logic:** capability gates, job options, preview URLs

### archive / text / security / developer / color

- **Pattern today:** ModularWorkspaceView + extraToolConfigs
- **Problems:** generic feature-button grid; weak primary-object focus
- **Recommended types:** archive tree; text editor/compare; inspector; focused settings forms

### activity / profile / settings

- **activity:** result/history manager
- **profile / settings:** focused settings forms

## Shared components (baseline)

| Component | Used by | Current problems | Redesign requirement | Keep/replace/split |
|-----------|---------|------------------|----------------------|--------------------|
| PageIntro | most views | marketing eyebrow rhythm | workspace header with actions | replace → WorkspaceHeader |
| PrimaryButton / SecondaryButton | global | ok API | liquid press, density variants | redesign in place |
| StatusBadge | global | decorative live dots risk | semantic status language | redesign |
| FileDropzone / FilePicker | workspaces | weak drag feedback | water response + file rows | redesign/split |
| WorkspaceTabs / FeatureButton | modular | equal tiles | progressive feature rail | redesign |
| EmptyState | global | limited lifecycle coverage | full lifecycle set | redesign |
| JobOutputCard | job routes | dense; weak result hierarchy | result item system | redesign |
| Sidebar | shell | long flat groups | denser rail + search/cmd | redesign |
| Topbar | shell | title-only | breadcrumbs, job pulse | redesign |
| CommandPalette | shell | basic | richer actions | redesign |
| ModularWorkspaceView | many tools | one-size-fits-all | pattern variants / split | split |
| PdfPageOrganizer | pdf | specialized — keep logic | visual shell only | keep + restyle |
| Brand / Icon / StatusIcon | shell | ok | token-aligned | keep + polish |

## Design tokens (current)

- Dark-first `:root` with light `data-theme="light"`
- Accents: purple, blue, cyan, green, pink, amber, danger
- Radii 12–30px; glass surfaces; Inter font (taste discourages Inter-as-default for marketing; acceptable for utility Linear-style override)
- Motion via `data-motion` + `useMotionPreference`

## Animations / assets

- `src/animations/{shell,dashboard,workspaces,controls,editors,insights,motion-modes,index}.css`
- Brand SVGs, tool illustrations, patterns under `public/assets/`

## Backend capability surfaces (UI must stay honest)

- Health, stats, jobs, workspace recover/hydrate
- Converter engines/groups, PDF ops, capabilities probe
- Resumable upload, SSE/WebSocket progress, cancel/retry

## Tests and screenshot infrastructure

- UI struct tests: `server/tests/ui-*.test.ts`
- Playwright e2e: `e2e/`, `npm run test:e2e`
- Contrast: `ui-contrast.test.ts`
- No dedicated visual regression baseline yet — screenshots under `docs/ux-ui-redesign/screenshots/`

## Baseline screenshots

Viewport targets: 320, 375, 768, 1024, 1440, 1920.  
Capture attempted during Phase 0; if headless capture is unavailable, structural inventory above is authoritative and screenshots are deferred to phase checkpoints with honest limitation notes.

## States observed (without fabricating data)

| State | How observed |
|-------|----------------|
| empty | Default empty file lists / EmptyState components in source |
| populated | Depends on local SQLite job history |
| running / completed / failed / cancelled | Job runner status strings + StatusIcon |
| unavailable | capability `isAvailable` false paths |
| offline | health null after failed `api.health()` |

## Pre-existing validation (Phase 0)

- `npm run typecheck` — pass
- `npm run build` — pass
- Tests run during phase commit checkpoint

## Skill workflows executed (Phase 0)

1. **ux-ui-pro-max:** design-system query for local-first utility suite (variance 5, motion 4, density 6); UX domain search for navigation/form/a11y/reduced-motion
2. **taste:** full redesign protocol (mode: overhaul), dial inference, anti-slop product constraints adapted for dense tool UI (Section 13 notes dashboards out of scope for marketing patterns; product shell follows blueprint density instead)
