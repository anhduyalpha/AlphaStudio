# Copy-paste prompts for agents

## Agent đầu tiên — tạo branch và chạy Phase 0

```text
Work directly on this repository:

https://github.com/anhduyalpha/AlphaStudio

Required base branch:
origin/main

Required working branch:
ux-ui-redesign

Do not create a worktree, duplicate clone, alternate branch, or modify main directly.

The prompt pack is located at:
prompts/ux-ui-redesign/

Before editing, read completely:

- prompts/ux-ui-redesign/00_GLOBAL_CONTEXT.md
- prompts/ux-ui-redesign/00_SKILL_GATE.md
- prompts/ux-ui-redesign/QUALITY_RUBRIC.md
- prompts/ux-ui-redesign/01_PHASE_0_PREFLIGHT_BASELINE.md
- prompts/ux-ui-redesign/STATE_TEMPLATE.json
- every repository-local AGENTS.md or contributor instruction

You MUST discover, read, and apply the installed skills matching:

- ux-ui-pro-max
- taste

Do not claim skill usage if the skills were not actually found and read.

Execute Phase 0 only.

Create or resume branch ux-ui-redesign, establish a green baseline, capture screenshots, create the state and handoff documents, run the required checks, commit with the exact Phase 0 message, and push.

Do not begin Phase 1.

Finish by reporting:
- baseCommit
- skill paths/identifiers
- phase commit
- remote HEAD
- tests
- screenshot locations
- exact nextAction
```

## Agent tiếp theo — chạy đúng một phase

```text
Continue the AlphaStudio UX/UI redesign on:

https://github.com/anhduyalpha/AlphaStudio

Required branch:
ux-ui-redesign

Execute only the next incomplete phase recorded in:
.ux-ui-redesign-state.json

Do not create another branch, worktree, or clone.
Do not modify main.
Do not force-push.
Do not begin the following phase.

Before editing:

1. Fetch origin.
2. Checkout ux-ui-redesign.
3. Pull with --ff-only.
4. Read:
   - .ux-ui-redesign-state.json
   - prompts/ux-ui-redesign/00_GLOBAL_CONTEXT.md
   - prompts/ux-ui-redesign/00_SKILL_GATE.md
   - prompts/ux-ui-redesign/QUALITY_RUBRIC.md
   - docs/UX_UI_REDESIGN_BLUEPRINT.md when present
   - docs/UX_UI_REDESIGN_DECISIONS.md when present
   - docs/UX_UI_COMPONENT_MATRIX.md when present
   - the latest phase handoff
   - the prompt file for the next incomplete phase
5. Verify the previous phase commit exists locally and remotely.
6. Re-run the relevant ux-ui-pro-max and taste workflows required for this phase.
7. Resume from the exact nextAction.

This must be a structural product redesign, not a reskin.

Changing only colors, CSS variables, typography, spacing, radius, blur, shadows, glass, animation, or class names does not count.

Every phase must end with:
- a runnable application;
- passing required build/tests;
- updated state;
- updated handoff;
- a green commit;
- a push to origin/ux-ui-redesign;
- local HEAD equal to remote HEAD.

When credits or context are low, stop only after the smallest green checkpoint has been committed and pushed.

Report:
- phase completed
- routes/components changed
- structural before/after summary
- skill evidence
- tests
- screenshots
- commit SHA
- remote HEAD
- exact nextAction
```

## Một agent chạy toàn bộ — không khuyến nghị nhưng có sẵn

```text
Read and execute:

prompts/ux-ui-redesign/MASTER_EXECUTION_PROMPT.md

Work only on branch ux-ui-redesign from origin/main.

Use the required ux-ui-pro-max and taste skills exactly as documented by the installed environment.

Execute all phases in order. Every phase must be independently buildable, committed, and pushed before the next begins. Never leave the remote branch in a broken state. Do not merge into main.
```
