<phase>
Phase 9 — Final audit, full validation, documentation, and Pull Request handoff
</phase>

<context_from_previous_phase>
Read all state, blueprint, decisions, component matrix, handoffs, screenshots, quality scores, and both skill review outputs.
</context_from_previous_phase>

<final_comparison>
Read `baseCommit` from `.ux-ui-redesign-state.json`.

Compare:

```text
<baseCommit>...HEAD
```

Do not compare against deleted UI branches.
</final_comparison>

<tasks>
1. Audit every route and every shared component.
2. Document:
   - old structure;
   - new structure;
   - workflow improvement;
   - component changes;
   - removed or corrected misleading controls;
   - backend mapping;
   - responsive result;
   - accessibility result;
   - motion/liquid behavior;
   - remaining limitations.
3. Quantify:
   - route/component JSX changes;
   - shared component changes;
   - global CSS/token changes;
   - tests added;
   - screenshots captured.
4. Verify every route scores at least 4/5.
5. Run the complete validation suite.
6. Verify a clean working tree.
7. Verify local HEAD equals `origin/ux-ui-redesign`.
8. Create:
   - `docs/UX_UI_REDESIGN_FINAL_REPORT.md`;
   - `docs/UX_UI_REDESIGN_TEST_REPORT.md`;
   - `docs/ux-ui-redesign/PHASE_9_HANDOFF.md`;
   - final screenshot index.
9. Prepare a Pull Request:
   - base: `main`;
   - head: `ux-ui-redesign`;
   - do not merge automatically.
</tasks>

<required_validation>
Run the repository's exact equivalents of:

```bash
npm run typecheck
npm test
npm run test:pdf
npm run test:maint
npm run test:e2e
npm run build
git diff --check
git status --short
```

Also run all newly added:

- accessibility tests;
- keyboard tests;
- responsive tests;
- visual-regression tests;
- reduced-motion tests;
- hydration/reconnect tests;
- job-state tests.
</required_validation>

<truthfulness_gate>
Do not claim:

- full redesign;
- production readiness;
- accessibility compliance;
- performance success;
- skill usage;
- backend support;
- visual-regression success;

without evidence.

List all remaining generic, optional, unavailable, mocked, untested, or binary-dependent behavior.
</truthfulness_gate>

<commit>
```text
[ux-ui-redesign:phase-9] complete final QA and PR handoff
```

Push and prepare the PR. Do not merge.
</commit>
