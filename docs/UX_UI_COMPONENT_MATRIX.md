# Component Matrix — UX/UI Redesign

| Component | Decision | Target API / composition | A11y notes | Phase |
|-----------|----------|--------------------------|------------|-------|
| PageIntro | **replace** | `WorkspaceHeader` title/meta/actions/status | one h1 per route | 2–3 |
| PrimaryButton | **redesign** | size sm/md, liquid-press, busy | disabled aria-busy | 2 |
| SecondaryButton | **redesign** | ghost/outline variants | same | 2 |
| icon-button | **redesign** | 40–44px hit target | aria-label required | 2 |
| StatusBadge | **redesign** | maps to job/health status | no decorative-only dots without label | 2 |
| TextField / SelectField | **redesign** | label above, error below | for/id association | 2 |
| ToggleRow | **redesign** | switch role | aria-checked | 2 |
| WorkspaceTabs | **redesign** | tablist/tab/tabpanel | roving tabindex | 2 |
| FeatureButton | **redesign** | FeatureRail item | selected state | 2 |
| FileDropzone | **redesign** | liquid-drop zone | keyboard activate | 2 |
| FilePicker | **redesign** | file rows + actions | list semantics | 2 |
| EmptyState | **redesign** | type: empty/offline/unavailable/error | live polite when needed | 2–7 |
| JobOutputCard | **redesign** | ResultItem + actions | focus after complete | 2–4 |
| Sidebar | **redesign** | rail groups, active indicator | nav landmark | 3 |
| Topbar | **redesign** | title + utility cluster | landmark | 3 |
| CommandPalette | **redesign** | dialog, focus trap | Esc, arrow keys | 3 |
| Brand / Icon / StatusIcon | **keep+polish** | token colors | decorative vs meaningful | 2 |
| ModularWorkspaceView | **split** | WorkbenchLayout + pattern props | preserve job runner | 2–6 |
| PdfPageOrganizer | **keep+shell** | logic untouched | keyboard page ops | 4 |
| surface-card | **recompose** | panel / stage / rail classes | — | 2 |
| toast | **redesign** | bottom-end, role=status | no focus steal | 2–3 |
| progress | **redesign** | wave variant | aria-valuenow | 2–8 |
| skeleton | **add** | layout-matching | aria-hidden | 2–7 |
| WorkbenchLayout | **add** | stage + rail + runbar | responsive stack | 2 |
| WorkspaceHeader | **add** | replaces PageIntro | heading level | 2 |
| ResultPanel | **add** | list of ResultItems | — | 2–4 |
| CapabilityBanner | **add** | unavailable reason | — | 2–7 |

## Removed / discouraged patterns

- Marketing `IllustrationCard` as primary dashboard content (demote)
- Equal 3-column feature card rows as default workspace chrome
- Eyebrow-on-every-section (`PageIntro` eyebrows)

## Explicit keep (already optimal enough)

- `useJobRunner`, `useWorkspace`, `useCapabilities` hooks (logic)
- API client contracts
- PdfPageOrganizer interaction model (visual shell only)
