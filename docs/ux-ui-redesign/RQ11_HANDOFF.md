# RQ11 Handoff — Liquid fallbacks

## Delivered
- `prefers-reduced-transparency` solid surfaces
- `@supports not (backdrop-filter)` solid fallback
- `html[data-power=low]` kills decorative liquid/progress animation
- Battery API + saveData set `data-power` from useMotionPreference

## Tests
- `ui-liquid-fallbacks-struct.test.ts`
