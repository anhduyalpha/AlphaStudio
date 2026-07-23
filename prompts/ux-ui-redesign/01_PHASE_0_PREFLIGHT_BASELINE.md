<phase>
Phase 0 — Branch, skills, repository baseline, and green checkpoint
</phase>

<context>
Read:

```text
00_GLOBAL_CONTEXT.md
00_SKILL_GATE.md
QUALITY_RUBRIC.md
STATE_TEMPLATE.json
```
</context>

<tasks>
1. Inspect repository status, remotes, branches, and recent commits.
2. Fetch `origin`.
3. If `ux-ui-redesign` does not exist:
   - fast-forward local `main` from `origin/main`;
   - record the exact `origin/main` SHA as `baseCommit`;
   - create `ux-ui-redesign` from that SHA;
   - push with upstream tracking.
4. If `ux-ui-redesign` already exists:
   - checkout it;
   - pull with `--ff-only`;
   - read existing state and resume safely.
5. Do not create a worktree or duplicate clone.
6. Discover and read `ux-ui-pro-max` and `taste` according to `00_SKILL_GATE.md`.
7. Inventory:
   - all routes;
   - shared UI components;
   - CSS/style entry points;
   - design tokens;
   - animations;
   - asset registry;
   - backend capability surfaces;
   - tests and screenshot infrastructure.
8. Capture baseline screenshots at:
   - 320;
   - 375;
   - 768;
   - 1024;
   - 1440;
   - 1920.
9. Capture available states without fabricating data:
   - empty;
   - populated;
   - running;
   - completed;
   - failed;
   - cancelled;
   - unavailable;
   - offline.
10. Create:
   - `.ux-ui-redesign-state.json`;
   - `docs/UX_UI_REDESIGN_BASELINE.md`;
   - `docs/ux-ui-redesign/PHASE_0_HANDOFF.md`.
</tasks>

<baseline_documents>
For every route record:

```text
Primary user goal:
Primary object:
Current layout:
Current hierarchy:
Current primary action:
Actual backend operations:
Misleading or decorative controls:
Reusable components:
Structural UX problems:
Responsive problems:
Motion problems:
Recommended workspace type:
High-risk logic to preserve:
```

For every shared component record:

```text
Component:
Used by:
Current problems:
Redesign requirement:
Keep / replace / split / remove:
Accessibility risks:
```
</baseline_documents>

<validation>
Run the repository's actual equivalents of:

```bash
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run build
git diff --check
```

Run a development smoke check confirming:

- Vite loads;
- server health endpoint responds;
- no import-resolution error;
- Dashboard renders.

Record any pre-existing failure without hiding it.
</validation>

<commit>
Required final phase commit:

```text
[ux-ui-redesign:phase-0] establish baseline and skill context
```

Push to:

```text
origin/ux-ui-redesign
```
</commit>

<stop_condition>
Do not begin Phase 1 in a phase-specific session.
</stop_condition>
