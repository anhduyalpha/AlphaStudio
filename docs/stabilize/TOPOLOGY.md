# Git topology (integrated stabilize baseline)

**Captured:** 2026-07-25  
**Branch:** `stabilize/alphastudio-stable-baseline`  
**Base commit (program start):** `ed460ee763663eef3f0aae9080eeb5e15c68fe1c` (`main`)

## Branch tips (authoritative after integration)

| Ref | SHA | Notes |
|-----|-----|--------|
| `origin/main` | `ed460ee…` | Unchanged; do not mutate without approval |
| `origin/ux-ui-redesign` | `a73f065…` | Verified independently; **ancestor** of stabilize |
| `origin/stabilize/alphastudio-stable-baseline` | `c32629f…` | Integrated tip; local HEAD must equal remote |

## Ancestry

```text
git merge-base --is-ancestor origin/ux-ui-redesign origin/stabilize/alphastudio-stable-baseline
# must exit 0
```

Stabilize is a **descendant** of the verified UX tip. The pre-integration divergence between the branches is closed by merge commit `492bf7f` and subsequent tip commits on stabilize.

## Stacked PR order only

```text
1. ux-ui-redesign                         -> main
2. stabilize/alphastudio-stable-baseline  -> updated main
```

Do **not** merge stabilize into `ux-ui-redesign` first.

## Policy

- Do **not** modify `main`, force-push, hard-reset, or rewrite published history.
- Do **not** create a stable tag without explicit user approval.
- Process and product commits for this program land on `stabilize/alphastudio-stable-baseline` and/or `ux-ui-redesign` only.
