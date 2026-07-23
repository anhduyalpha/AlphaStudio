<phase>
Phase 6 — Archive, Text/OCR, Color, Security, Developer, Activity, Profile, and Settings
</phase>

<context_from_previous_phase>
Read state, blueprint, component matrix, Phase 5 handoff, route contracts, and both skills.
</context_from_previous_phase>

<critical_rule>
Do not force unrelated tools into one generic workspace composition.

Reuse primitives, not unsuitable complete page templates.
</critical_rule>

<route_requirements>
Archive:
- tree/list contents as focal object;
- distinct create, inspect, and extract flows;
- contextual safety and format capability.

Text/OCR:
- editor, compare, extract, and analyze workspace;
- distinguish browser-only tools from backend jobs;
- capability-aware OCR states.

Color:
- interactive palette, contrast, conversion, gradient, and image-extraction workspace;
- browser-only actions should not fake server jobs.

Security:
- inspector/result-driven layout;
- separate hashing, checksum comparison, metadata inspection, signature detection, and password generation.

Developer:
- deterministic input/output panels;
- clear transform history and copy/download actions.

Activity:
- job and output history manager;
- filtering, result access, retry, and honest deletion semantics.

Profile and Settings:
- focused forms;
- meaningful grouping;
- no dashboard-card imitation.
</route_requirements>

<tasks>
Implement route-sized substeps. Run build after every route group. Use green checkpoint commits when needed. Update screenshots and create `docs/ux-ui-redesign/PHASE_6_HANDOFF.md`.
</tasks>

<validation>
```bash
npm run typecheck
npm test
npm run build
npm run test:e2e
git diff --check
```
</validation>

<commit>
```text
[ux-ui-redesign:phase-6] redesign specialized utility workspaces
```

Push before stopping.
</commit>
