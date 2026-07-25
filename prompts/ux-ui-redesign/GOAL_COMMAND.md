# One-command /goal prompt

Use this after the prompt pack has been added to the repository at:

```text
prompts/ux-ui-redesign/
```

## Recommended command

```text
/goal Implement the complete plan in prompts/ux-ui-redesign/UX_UI_REDESIGN_IMPLEMENTATION_PLAN.md. Read and obey every prompt, state, handoff, quality rubric, and skill requirement referenced by the plan. Work only on branch ux-ui-redesign from origin/main. Discover and apply ux-ui-pro-max and taste. Resume from the first incomplete phase. Keep every phase and checkpoint buildable, commit and push every green checkpoint, and stop only with the remote branch in a runnable state. Do not modify or merge main.
```

## Short command

```text
/goal Implement prompts/ux-ui-redesign/UX_UI_REDESIGN_IMPLEMENTATION_PLAN.md
```

The short form is sufficient only when the agent supports repository-aware
`/goal` execution and follows referenced files automatically.

## Resume command

```text
/goal Resume prompts/ux-ui-redesign/UX_UI_REDESIGN_IMPLEMENTATION_PLAN.md from .ux-ui-redesign-state.json. Execute the next incomplete phase, use ux-ui-pro-max and taste, then test, commit, and push the next green checkpoint.
```
