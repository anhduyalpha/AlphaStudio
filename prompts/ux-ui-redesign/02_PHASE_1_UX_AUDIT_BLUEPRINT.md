<phase>
Phase 1 — UX architecture, visual concepts, component plan, and wireframes
</phase>

<context_from_previous_phase>
Before work:

1. fetch and checkout `ux-ui-redesign`;
2. pull with `--ff-only`;
3. read `.ux-ui-redesign-state.json`;
4. read `docs/UX_UI_REDESIGN_BASELINE.md`;
5. read `docs/ux-ui-redesign/PHASE_0_HANDOFF.md`;
6. verify Phase 0 commit exists locally and remotely;
7. re-run the relevant `ux-ui-pro-max` and `taste` audit workflows.
</context_from_previous_phase>

<objective>
Define the complete redesign before modifying production routes.

This phase must prove that the result will be a structural redesign, not a visual reskin.
</objective>

<tasks>
1. Create three distinct concept directions within the required premium minimalist/liquid identity.
2. Evaluate them with `ux-ui-pro-max`, `taste`, and `QUALITY_RUBRIC.md`.
3. Select one direction and explain why.
4. Define:
   - navigation architecture;
   - global shell;
   - typography hierarchy;
   - color and semantic color system;
   - density and spacing;
   - grid behavior;
   - elevation and glass rules;
   - iconography;
   - state language;
   - motion principles;
   - liquid-effect rules and fallbacks.
5. Define purpose-built workspace patterns:
   - command center;
   - conversion board;
   - document page workspace;
   - image canvas workspace;
   - media/audio timeline workspace;
   - archive tree workspace;
   - text editor/compare workspace;
   - inspector workspace;
   - result/history manager;
   - focused settings forms.
6. Assign a justified pattern to every route.
7. Produce desktop and mobile wireframes for every route.
8. Produce higher-fidelity prototypes for:
   - Dashboard;
   - Converter;
   - PDF;
   - Image;
   - Media;
   - Audio.
9. Define redesign decisions for every shared user-facing component.
10. Define which old components are removed, split, renamed, or replaced.
11. Create:
   - `docs/UX_UI_REDESIGN_BLUEPRINT.md`;
   - `docs/UX_UI_REDESIGN_DECISIONS.md`;
   - `docs/UX_UI_COMPONENT_MATRIX.md`;
   - `docs/ux-ui-redesign/PHASE_1_HANDOFF.md`.
</tasks>

<wireframe_requirements>
Every wireframe must show:

- major regions;
- reading order;
- primary and secondary actions;
- input area;
- settings area;
- preview or primary object;
- progress and status;
- result management;
- mobile behavior;
- empty and active composition differences.

A wireframe fails if the old DOM could remain unchanged with different CSS.
</wireframe_requirements>

<validation>
- prototypes build successfully;
- production behavior remains unchanged;
- screenshot comparison artifacts are generated;
- typecheck passes;
- build passes;
- `git diff --check` passes.
</validation>

<commit>
```text
[ux-ui-redesign:phase-1] define UX architecture and visual blueprint
```

Push before stopping.
</commit>
