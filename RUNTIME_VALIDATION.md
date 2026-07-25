# Runtime validation

## Status (stabilization honesty)

This file previously listed historical green counts for AlphaStudio 3.6.0
(2026-07-17), including `npm run test:audit` and `npm run audit:backend`.

**Those scripts no longer exist** (`scripts/audit/` is absent; removed from
`package.json` during the hygiene / clean-clone checkpoint on
`stabilize/alphastudio-stable-baseline`). Treat any historical “audit green”
claims below as **unverified narrative**, not current release gates.

Canonical current gates:

```text
npm ci
npm run typecheck
npm run build
npm test
npm run test:maint
npm run test:hygiene
npm run doctor          # environment snapshot; may report missing optional tools
```

Full external tool install is optional for core mode:

```text
npm run bootstrap       # or: npm run tools:install
```

Evidence for the hygiene checkpoint lives under `docs/stabilize/` and process
scratch logs — not in this file.

## Historical notes (2026-07-17 — not re-proven)

The following was claimed on 2026-07-17 and is retained only as archive context:

- `npm ci` / `npm run build` / `npm test` reported green on that host.
- Phase-3 resumable upload regressions and maint tests were claimed green.
- `test:audit` / `audit:backend` claims are **void** (targets missing).
- Optional Chromium and 7-Zip may be absent; capabilities stay gated.

Do not use this document as proof of stability without fresh command evidence.
