# Converter C0 handoff — matrix freeze

## Scope
Documentation and inventory only. No product behavior change.

## Delivered
- `docs/converter/FORMAT_ENGINE_MATRIX.md` — live-adapter-derived source→target→engine matrix with honesty labels
- `.converter-complete-state.json` — phases C0–C8 tracker
- `fixtures/converter/*` — tiny text/image/data samples + README inventory

## Validation
- Focused converter tests, typecheck, build (see commit)

## Next
Phase C1: multi-select files, convert selected / group / all, real job progress on runbar.
