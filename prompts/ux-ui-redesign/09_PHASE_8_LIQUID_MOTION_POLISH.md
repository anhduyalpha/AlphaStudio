<phase>
Phase 8 — Liquid motion, water effects, interaction polish, and taste review
</phase>

<context_from_previous_phase>
Read state, blueprint, motion rules, Phase 7 handoff, visual artifacts, quality rubric, and both required skills.
</context_from_previous_phase>

<objective>
Add premium motion and water-inspired interaction without compromising clarity, accessibility, or performance.
</objective>

<motion_hierarchy>
Use motion in three levels:

1. Micro:
   - hover;
   - press;
   - focus;
   - selection;
   - toggle;
   - copy/download confirmation.

2. Workflow:
   - upload acceptance;
   - panel transition;
   - job progress;
   - result arrival;
   - error recovery.

3. Signature:
   - a small number of high-value liquid interactions that define AlphaStudio's identity.

Signature motion must not appear on every surface.
</motion_hierarchy>

<tasks>
1. Audit all existing animations and remove redundant or distracting ones.
2. Implement liquid/ripple/refraction effects according to the blueprint.
3. Keep text, forms, and data surfaces readable.
4. Prefer transform and opacity for most motion.
5. Scope SVG filters, canvas, or WebGL to small contained regions.
6. Avoid permanent high-frequency animation.
7. Provide:
   - reduced-motion version;
   - low-power fallback;
   - touch/coarse-pointer fallback;
   - no-filter fallback.
8. Measure animation smoothness and check layout shift.
9. Run `ux-ui-pro-max` and `taste` final visual review over all routes.
10. Score every route using `QUALITY_RUBRIC.md`.
11. Fix every score below 4/5.
12. Capture final route montages.
13. Create `docs/ux-ui-redesign/PHASE_8_HANDOFF.md`.
</tasks>

<quality_gate>
Water effects fail when they:

- distract from primary actions;
- make text harder to read;
- run continuously without purpose;
- cause jank;
- break reduced-motion;
- become the main visual content instead of supporting the workflow.
</quality_gate>

<validation>
```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

Run dedicated motion, reduced-motion, responsive, and visual-regression checks.
</validation>

<commit>
```text
[ux-ui-redesign:phase-8] add liquid motion and interaction polish
```

Push before stopping.
</commit>
