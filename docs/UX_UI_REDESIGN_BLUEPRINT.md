# AlphaStudio UX/UI Redesign Blueprint

**Selected direction:** **Studio Rail + Workbench** (Concept B)  
**Skills:** ux-ui-pro-max + taste redesign protocol  
**Dials:** VARIANCE 5 · MOTION 4 · DENSITY 6

## Three concepts evaluated

### Concept A — Monochrome Gallery

- Dense monochrome cards, single accent, heavy glass
- **Pros:** visually quiet  
- **Cons:** monochrome-only fails plan color rules; still card-gallery IA  
- **Rubric avg:** ~3.2 — rejected

### Concept B — Studio Rail + Workbench (SELECTED)

- Compact navigation rail with grouped tools
- Each route is a **workbench**: primary object stage + contextual rail + sticky run bar
- Selective family accents (converter purple, PDF cyan, image green, media pink, etc.)
- Restrained liquid only on press, drop, progress, completion
- **Pros:** structural IA change; route-specific patterns; backend-honest; not a reskin  
- **Cons:** requires component API work  
- **Rubric avg:** ~4.5 — selected

### Concept C — Marketing Command Deck

- Large hero, bento dashboard, kinetic type  
- **Pros:** distinctive  
- **Cons:** taste landing patterns on product UI; weak job-ops focus  
- **Rubric avg:** ~3.0 — rejected

## Navigation architecture

| Zone | Contents |
|------|----------|
| Rail brand | Mark + wordmark + collapse |
| Status chip | API online/offline (real health) |
| Primary nav | Studio · Core tools · More tools · Manage |
| Utility | Command (Ctrl/K), theme, motion |
| Mobile | Bottom sheet nav + scrim; top menu button |

Hash routes preserved (`#/converter`, etc.) for muscle memory and deep links.

## Global shell

```
┌──────── rail ────────┬──────── main column ──────────────────┐
│ brand                │ topbar: title · context · actions     │
│ health               ├───────────────────────────────────────┤
│ nav groups           │ workbench (route-specific)            │
│                      │                                       │
│ footer identity      │ sticky run / status when job active   │
└──────────────────────┴───────────────────────────────────────┘
```

## Typography hierarchy

| Role | Size | Weight | Use |
|------|------|--------|-----|
| Display | 1.75–2rem | 600 | Dashboard command title only |
| Title | 1.25–1.4rem | 600 | Workspace title |
| Section | 0.95–1.05rem | 600 | Panel headers |
| Body | 0.9375rem | 400 | Descriptions |
| Meta | 0.75–0.8125rem | 500 | Badges, captions |
| Mono | 0.8125rem | 500 | Digests, paths, codes |

Font: system UI stack with Inter as utility override (Linear-style). Avoid serif.

## Color and semantic system

**Base:** existing dark/light neutrals (not pure `#000` / `#fff`).

**Semantic:**

| Token | Role |
|-------|------|
| `--success` | completed |
| `--warning` | degraded / partial |
| `--danger` | failed / offline |
| `--info` | running / inspect |
| `--focus-ring` | keyboard focus |

**Family accents (selective, not monochrome):** purple converter, cyan PDF, blue QR, green image/security, pink media/audio, amber color/developer.

## Density and spacing scale

```
--space-1: 4px
--space-2: 8px
--space-3: 12px
--space-4: 16px
--space-5: 24px
--space-6: 32px
--space-7: 48px
```

Workbench gap: 16–24px. Control stacks: 8–12px.

## Grid behavior

- Shell: `rail | main` → single column < 900px
- Workbench: `1fr | 320px` settings rail → stack < 1024px
- Dashboard: asymmetric `2fr 1fr` ops grid, not equal cards

## Elevation and glass

| Level | Use |
|-------|-----|
| 0 flat | page background |
| 1 surface | panels |
| 2 raised | popovers, sticky run bar |
| glass | elevated chrome only (topbar/rail), never body text |

Rules: 1px inner highlight; solid fallback for `prefers-reduced-transparency`.

## Iconography

Keep sprite/Icon system; one stroke weight; no emoji icons.

## State language

| State | Visual |
|-------|--------|
| empty | illustration + one primary CTA |
| loading | skeleton matching layout |
| running | progress + cancel |
| completed | success strip + outputs |
| failed | error + retry |
| cancelled | neutral resume |
| unavailable | capability reason, no fake enable |
| offline | health chip + EmptyState offline |

## Motion principles

- 150–250ms transforms/opacity only
- Feedback: press scale, drop ripple, wave progress, completion pulse
- Honor `prefers-reduced-motion` via existing `data-motion`

## Liquid-effect rules

Approved: button press ripple, dropzone water response, progress wave, scoped glass refraction, completion micro.  
Forbidden: whole-page continuous liquid, text distortion, motion-required usability.

## Workspace patterns → routes

| Pattern | Routes |
|---------|--------|
| Command center | dashboard |
| Conversion board | converter |
| Document page workspace | pdf |
| Image canvas | image |
| Media/audio timeline | media, audio |
| Archive tree | archive |
| Text editor/compare | text |
| Inspector | qr, color, security, developer |
| Result/history manager | activity |
| Focused settings | profile, settings |

## Wireframe sketches (desktop → mobile)

### Dashboard (command center)

```
DESKTOP                          MOBILE
[Health | Resume strip]          [Health chip]
[Active jobs  | Quick launch]    [Resume]
[Recent results | Caps]          [Active jobs]
                                 [Quick launch grid]
                                 [Recent]
```

Reading order: health → unfinished → active → quick → recent.  
Primary: Resume / New conversion. No marketing hero.

### Converter (conversion board)

```
[Files stage ...........][Format & engine]
[Batch rows ............][Options disclosure]
[Run bar sticky ........][Results drawer]
```

Mobile: files → options accordion → run → results stack.

### PDF (document page)

```
[Pages canvas ..........][Operation rail]
[Thumbnails ............][Options]
[Run bar ..............][Outputs]
```

### Image canvas

```
[Preview stage .........][Transform rail]
[Compare / before-after ][Export options]
```

### Media / Audio timeline

```
[Player / waveform .....][Clip tools]
[Timeline scrub ........][Export]
```

### Archive / Text / Inspector / Activity / Settings

- Archive: tree + actions rail  
- Text: dual panes or single editor  
- Inspector: form primary + live preview  
- Activity: filterable result list  
- Settings: grouped forms, no card spam  

Empty vs active: empty shows CTA in stage; active fills stage with object and enables run.

## Higher-fidelity prototype notes

Prototypes are implemented as production code in phases 2–3 (foundations + shell/dashboard) rather than separate mock routes, keeping one source of truth.

## Component redesign summary

See `docs/UX_UI_COMPONENT_MATRIX.md`.
