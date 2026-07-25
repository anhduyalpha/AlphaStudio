<phase>
Phase 3 — Application shell, navigation, command palette, and Dashboard
</phase>

<context_from_previous_phase>
Read state, blueprint, decisions, component matrix, Phase 2 handoff, and skill instructions. Verify the remote Phase 2 commit.
</context_from_previous_phase>

<objective>
Deliver the first production route with a visibly new information architecture.
</objective>

<tasks>
1. Redesign:
   - application shell;
   - sidebar/navigation;
   - topbar;
   - mobile navigation;
   - command palette;
   - route headers;
   - global overlays;
   - toast placement;
   - offline/capability entry points.
2. Redesign Dashboard as an operational command center.
3. Prioritize:
   - active jobs;
   - unfinished work;
   - recent results;
   - frequent tools;
   - system capability health;
   - meaningful quick actions.
4. Remove the generic marketing-hero/card-gallery feeling.
5. Use real API data only.
6. Create distinct empty and active dashboard compositions.
7. Add purposeful shell transitions and restrained liquid feedback.
8. Validate keyboard navigation, focus restoration, and mobile use.
9. Capture before/after screenshots.
10. Create `docs/ux-ui-redesign/PHASE_3_HANDOFF.md`.
</tasks>

<quality_gate>
Dashboard must not remain a uniform grid of equal cards.

The shell and Dashboard must look structurally different from the baseline, not merely recolored.
</quality_gate>

<validation>
```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```

Smoke-test all routes after the shell change.
</validation>

<commit>
```text
[ux-ui-redesign:phase-3] redesign shell navigation and dashboard
```

Push before stopping.
</commit>
