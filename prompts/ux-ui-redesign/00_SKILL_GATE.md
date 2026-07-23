<mandatory_skill_gate>
Before performing design or implementation work, discover and read the installed skill documentation matching:

```text
ux-ui-pro-max
taste
```

Use the environment's official skill-discovery method. Search exact names first, then close canonical matches.

Required behavior:

1. Locate the canonical skill file or command for `ux-ui-pro-max`.
2. Locate the canonical skill file or command for `taste`.
3. Read both skill documents completely.
4. Execute any required setup, audit, checklist, or workflow described by them.
5. Record exact skill paths/names in `.ux-ui-redesign-state.json`.
6. Record the concrete principles applied in the current phase handoff.
7. Use the skills again whenever their workflow requires a review pass.

Do not claim a skill was used merely because its name appears in this prompt.

If either skill is unavailable:

- search once using reasonable exact-name variants;
- do not invent its contents;
- record the missing skill as a blocker;
- keep the repository on the last green commit;
- do not begin visual implementation while pretending the skill requirement was satisfied.
</mandatory_skill_gate>

<skill_precedence>
Apply instructions in this order:

1. user request and this prompt pack;
2. repository-local `AGENTS.md`, contribution, security, and architecture instructions;
3. `ux-ui-pro-max` and `taste` skill instructions;
4. ordinary engineering judgment.

If skill advice conflicts with real backend capability or accessibility, backend truth and accessibility win.
</skill_precedence>

<skill_evidence_required>
Every phase handoff must include:

```text
Skills read:
Exact paths or canonical identifiers:
Skill workflows executed:
Design decisions derived from ux-ui-pro-max:
Design decisions derived from taste:
Quality issues found by skill review:
Corrections made:
```
</skill_evidence_required>
