# Evidence — per-unit verification records

`evidence/unit-<n>.md` is written by `/next-unit` for every executed unit and
committed with the unit's merge into `rebuild`:

- tails of real verification command output (server suite, typecheck, client
  tests, `visual:checks`, `visual:diff`) — pasted, never paraphrased;
- every visual-judge verdict and observation, appended verbatim;
- accepted baseline ids added by the unit;
- any NOT-ASSESSABLE judge findings flagged `REWORD:` for SPEC.md.

The final rebuild → main PR links every file in this directory.
This directory is always writable in the harness (hook always-allow) so a
failing unit can still record why it failed.
