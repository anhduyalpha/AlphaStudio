<phase>
Phase 4 — Converter and PDF purpose-built workspaces
</phase>

<context_from_previous_phase>
Read state, blueprint, decisions, Phase 3 handoff, relevant route/backend code, and both required skills.
</context_from_previous_phase>

<objective>
Redesign the two highest-risk workspaces while preserving mature upload and job logic.
</objective>

<converter_requirements>
- uploaded files and detected groups are the primary surface;
- conversion target, engine, and relevant settings are contextual;
- irrelevant controls disappear;
- queue, active items, failures, and results are distinct;
- resumable uploads remain intact;
- batch actions map to real backend paths;
- output management is first-class;
- no fake preview;
- no global quality/metadata setting when an engine ignores it.
</converter_requirements>

<pdf_requirements>
- document pages and selected operation are central;
- page thumbnails, selection, reordering, ranges, and operation controls form one workspace;
- operation-specific controls appear contextually;
- preview cancellation and PDF.js lifecycle remain safe;
- completed output remains visible and manageable;
- unsupported or optional-binary operations are honest.
</pdf_requirements>

<implementation_rules>
- extract presentation around existing business logic;
- do not rewrite upload, job, persistence, SSE, cancellation, or recovery unless a verified bug requires it;
- add green checkpoint commits after Converter and PDF separately when the phase is too large.
</implementation_rules>

<tasks>
1. Implement the blueprint for Converter.
2. Run focused tests and build.
3. Create an optional green checkpoint commit.
4. Implement the blueprint for PDF.
5. Run focused tests and build.
6. Add route-specific responsive and state behavior.
7. Capture before/after screenshots.
8. Create `docs/ux-ui-redesign/PHASE_4_HANDOFF.md`.
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
Required final phase commit:

```text
[ux-ui-redesign:phase-4] redesign converter and PDF workspaces
```

Push all green commits.
</commit>
