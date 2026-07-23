# UX/UI Redesign — Composition Audit (Corrective C0)

**Branch:** `ux-ui-redesign`  
**HEAD at audit:** `19f2ec1`  
**Base:** `origin/main` `ed460ee`  
**Method:** `git diff --numstat origin/main...HEAD` + source inspection of JSX return trees.  
**Not used as proof of quality:** state `phaseStatus`, self-scores, `data-testid` alone.

## Diff concentration

| Path | + / − vs main | Verdict |
|------|---------------|---------|
| `src/styles.css` | +769 / −5 | Bulk of visual system |
| `src/views/DashboardView.jsx` | +182 / −148 | Real structural rewrite |
| `src/components/Workbench.jsx` | +126 / 0 | New primitives |
| `src/components/Common.jsx` | +150 / −27 | API redesign + adapters |
| `src/views/ModularWorkspaceView.jsx` | +123 / −141 | Generic shell re-skin |
| `src/views/MediaView.jsx` | +56 / −46 | Workbench wrap; weak timeline |
| `src/views/ImageView.jsx` | +46 / −48 | Workbench wrap; weak canvas |
| `src/views/ConverterView.jsx` | +22 / −13 | Header + class names only |
| `src/views/PdfView.jsx` | +21 / −14 | Header + class names only |
| Audio/Archive/Text/Color/Security views | ~0 product JSX | 6-line modular wrappers |

## Per-route composition

| Route | Primary object in DOM today | Purpose-built? | Classification |
|-------|----------------------------|----------------|----------------|
| dashboard | Ops strip + resume/active/recent lists | Yes (operational) | **KEEP** |
| shell | Rail + health + command palette | Yes | **KEEP** |
| converter | File cards + group cards + summary aside | No (old grid) | **IMPROVE heavily** |
| pdf | Form grid + tabs; organizer secondary | No | **IMPROVE heavily** |
| image | FilePicker + single preview + form rail | Partial | **IMPROVE** |
| media | FilePicker + native media + form rail | Partial | **IMPROVE** |
| qr | Dual encode/decode (prior) + header | Partial | **IMPROVE** lightly |
| audio | Modular FeatureRail + generic options | No | **REPLACE** |
| archive | Modular FeatureRail + generic options | No | **REPLACE** |
| text | Modular FeatureRail + generic options | No | **REPLACE** |
| color | Modular FeatureRail + generic options | No | **REPLACE** |
| security | Modular FeatureRail + generic options | No | **REPLACE** |
| developer | Utility list + IO panes + header | Partial | **IMPROVE** |
| activity | Timeline rows + header | Partial | **IMPROVE** |
| profile/settings | Forms + header | Partial | **IMPROVE** |

## ModularWorkspaceView (shared failure mode)

```text
WorkspaceHeader → WorkspaceTabs → CapabilityBanner?
→ stage: FilePicker + Progress + JobOutputCard
→ rail: FeatureRail + Processing preset + Output name + Preserve metadata + Summary
→ runbar: primary CTA
```

Used by: Archive, Text, Audio, Color, Security.

## Screenshots

Baseline corrective captures: `docs/ux-ui-redesign/screenshots/baseline-corrective/`  
(Filled by C0 harness.)

## Conclusion

Prior phases delivered a usable **shell + dashboard + design tokens**, then largely **wrapped** tool routes. Corrective program must rebuild purpose-built workspaces without discarding shell foundations.
