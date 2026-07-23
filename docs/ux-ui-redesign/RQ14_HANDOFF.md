# RQ14 Handoff — test:maint script surface

## Delivered
- Align maint package.json script surface test with real scripts:
  - `runtime:prepare` is explicit and chained from `bootstrap`
  - do **not** require heavy `predev`/`prebuild`/`prestart` hooks

## Residual
Full `npm test` inventory still optional when tools/fixtures missing
