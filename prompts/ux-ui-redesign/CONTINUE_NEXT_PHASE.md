<role>
Continue the AlphaStudio UX/UI redesign from the last green remote checkpoint.
</role>

<recovery>
1. Work in the existing repository folder.
2. Do not create another clone, branch, or worktree.
3. Fetch origin.
4. Checkout:

```text
ux-ui-redesign
```

5. Pull with `--ff-only`.
6. Read:
   - `.ux-ui-redesign-state.json`;
   - `docs/UX_UI_REDESIGN_BLUEPRINT.md`;
   - `docs/UX_UI_REDESIGN_DECISIONS.md`;
   - `docs/UX_UI_COMPONENT_MATRIX.md`;
   - latest handoff under `docs/ux-ui-redesign/`;
   - the next incomplete phase prompt;
   - `00_SKILL_GATE.md`;
   - `QUALITY_RUBRIC.md`.
7. Verify:
   - last green commit;
   - last pushed commit;
   - local HEAD;
   - remote HEAD;
   - working-tree status;
   - exact `nextAction`.
8. Preserve valid uncommitted work only when it belongs to the current phase and can be validated.
9. Do not repeat completed phases.
</recovery>

<execution>
Execute only the next incomplete phase.

Do not begin the following phase.

Before completion:

- run required tests;
- prove the application builds;
- update state;
- write handoff;
- commit;
- push;
- confirm local and remote HEAD match.
</execution>

<credit_guard>
When context or credits appear low:

- do not begin another large route;
- finish the smallest green checkpoint;
- build and test it;
- commit and push it;
- update `nextAction`;
- stop safely.
</credit_guard>
