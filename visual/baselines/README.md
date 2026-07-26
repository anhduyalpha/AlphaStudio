# Visual baselines — append-only

Committed screenshot baselines for `npm run visual:diff`.

- Added ONLY via `npm run visual:accept -- <capture-id>` (refuses overwrite;
  no force flag exists).
- Never edited, replaced, or deleted by the agent harness — enforced by the
  PreToolUse hooks in `.claude/hooks/` (file writes AND shell commands).
- Replacing a stale baseline is a deliberate human act: delete the file
  manually, review the new capture, re-accept.
- Baselines are platform-specific (captured on Windows, Chromium, 1440×900,
  DPR 1, dark+light, motion=reduced, animations frozen). Do not compare
  captures from another platform against them.

State at harness creation (2026-07-26): empty. Nothing in the repo matches
SPEC.md yet — the rebuild has not started (all PLAN.md units todo), so there
is nothing that can honestly be baselined. Units add baselines as they build
the surfaces the manifest defines.
