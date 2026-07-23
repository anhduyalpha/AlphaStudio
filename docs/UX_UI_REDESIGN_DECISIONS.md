# AlphaStudio UX/UI Redesign — Decisions Log

## Direction

**Adopt Concept B: Studio Rail + Workbench.**

Rationale: forces structural IA change (workbench regions, sticky run, command-center dashboard) while preserving backend honesty and brand multi-accent color. Scores ≥4 on QUALITY_RUBRIC for workflow clarity, route specificity, backend honesty, and accessibility when implemented.

## Decisions

### D1 — Preserve hash routes and nav labels
Do not rename route ids (`converter`, `pdf`, …). Labels may shorten slightly in the rail but keep recognizability.

### D2 — Brand accents retained
Do not flatten to monochrome or adopt generic orange from design-system search. Family accents map tools; semantic colors map job states.

### D3 — PageIntro → WorkspaceHeader
Replace marketing eyebrow/title/description/actions with a denser workspace header: title, context meta, primary/secondary actions, optional status.

### D4 — ModularWorkspaceView splits into patterns
Keep a shared core (file stage, options, run, results) but compose via `WorkbenchLayout` regions. Feature grids become rails or segmented controls.

### D5 — Dashboard is operational, not marketing
Remove hero/gallery dominance. Prioritize health, resume, active jobs, recent results, compact tool launch.

### D6 — Liquid is progressive enhancement
Utilities in CSS (`liquid-press`, `liquid-drop`, `progress-wave`). Disabled under reduced motion / coarse-pointer optional simplification / missing filter support.

### D7 — Inter kept for utility identity
Taste ban on Inter is marketing-default; Linear-style utility override applies.

### D8 — Tests gate structure, not pixels
Primary gate: existing `ui-*-struct.test.ts` plus new structural assertions. Screenshots are evidence, not the only gate.

### D9 — No backend rewrite
Job types, workspace recover, capabilities, PDF options, upload sessions unchanged.

### D10 — Component gallery stays DEV-only
Extend AssetGallery / DEV route for foundations review; no production Storybook dependency.
