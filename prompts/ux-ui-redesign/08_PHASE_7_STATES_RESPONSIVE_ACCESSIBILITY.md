<phase>
Phase 7 — Cross-route lifecycle states, result management, responsive behavior, and accessibility
</phase>

<context_from_previous_phase>
Read state, blueprint, decisions, Phase 6 handoff, quality rubric, and both skill workflows.
</context_from_previous_phase>

<objective>
Unify semantics without making every route look identical.
</objective>

<tasks>
1. Standardize lifecycle semantics:
   - empty;
   - selected/input ready;
   - uploading;
   - inspecting;
   - queued;
   - running;
   - completed;
   - failed;
   - cancelled;
   - offline;
   - unavailable.
2. Redesign shared state and result primitives while allowing route-specific composition.
3. Ensure result actions map to real behavior:
   - download;
   - retry;
   - remove from visible list;
   - physical deletion only when a real backend endpoint exists;
   - batch download.
4. Test long filenames, large result lists, and missing metadata.
5. Validate viewports:
   - 320;
   - 375;
   - 430;
   - 768;
   - 1024;
   - 1280;
   - 1440;
   - 1920.
6. Test:
   - 200% text zoom;
   - keyboard-only navigation;
   - screen-reader labels;
   - focus restoration;
   - route changes during active jobs;
   - reload/hydration;
   - reconnect/offline behavior;
   - touch target sizing;
   - color contrast;
   - reduced motion.
7. Fix all violations.
8. Create `docs/ux-ui-redesign/PHASE_7_HANDOFF.md`.
</tasks>

<validation>
```bash
npm run typecheck
npm test
npm run test:pdf
npm run build
npm run test:e2e
git diff --check
```
</validation>

<commit>
```text
[ux-ui-redesign:phase-7] unify lifecycle responsive and accessible UX
```

Push before stopping.
</commit>
