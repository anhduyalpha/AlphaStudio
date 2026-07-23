<phase>
Phase 2 — Design foundations and complete shared-component redesign
</phase>

<context_from_previous_phase>
Read state, blueprint, decisions, component matrix, Phase 1 handoff, and both required skills before editing.
</context_from_previous_phase>

<objective>
Implement the new visual and interaction foundation without yet restructuring every route.

The application must remain fully runnable at the end of the phase.
</objective>

<component_scope>
Audit and redesign, split, replace, or explicitly retain:

- buttons;
- icon buttons;
- inputs;
- textareas;
- selects;
- checkboxes;
- radios;
- switches;
- tabs;
- segmented controls;
- badges;
- tooltips;
- menus;
- dropdowns;
- dialogs;
- drawers;
- toasts;
- cards and panels;
- tables;
- file rows;
- upload dropzones;
- progress indicators;
- skeletons;
- empty states;
- error states;
- capability-unavailable states;
- result items;
- player controls;
- timeline primitives;
- page-thumbnail primitives;
- shell layout primitives.

Do not merely restyle existing primitives when their API or composition is unsuitable.
</component_scope>

<tasks>
1. Implement semantic design tokens based on the selected blueprint.
2. Keep color expressive and restrained; do not produce a monochrome-only system.
3. Implement responsive typography, spacing, density, elevation, focus, and state tokens.
4. Implement motion tokens and reduced-motion handling.
5. Create a liquid-effect utility layer with:
   - progressive enhancement;
   - static fallback;
   - scoped performance;
   - no text distortion.
6. Redesign shared components and update their accessibility contracts.
7. Build a development-only component gallery or Storybook-equivalent route using existing project conventions.
8. Add component-level tests and visual snapshots.
9. Update the component matrix with final decisions.
10. Create `docs/ux-ui-redesign/PHASE_2_HANDOFF.md`.
</tasks>

<quality_gate>
Reject the phase if it only adds CSS variables and leaves unsuitable component APIs untouched.

Every shared component must have evidence of redesign or an explicit justification.
</quality_gate>

<validation>
Required minimum:

```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

Run a local smoke test of the component gallery and existing production routes.
</validation>

<commit>
```text
[ux-ui-redesign:phase-2] rebuild design foundations and components
```

Push before stopping.
</commit>
