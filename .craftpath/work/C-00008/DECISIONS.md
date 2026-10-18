# C-00008 — Decisions

## T-0001 — List DECISIONS.md among what review prints

- Kept only the `review.py` copy and its manifest hash from `init`, and restored the other refreshed copies -- they are outside this task's Touches, and other tasks in the wave may be changing those skills at the same time.
- In the tests, the "directly after the `plan:` line" check is a small `afterPlan(out)` helper that returns the next line of stdout -- it checks the position exactly, which `toContain` would not.
- Put `work / "DECISIONS.md"` into one local variable `decisions_md`, used both for the commit and for the printed line -- it removes the repeated path, and the existing `decisions` variable already holds the commit line.
- Updated the `review.py` docstring to list the spec, the plan and DECISIONS.md among what it prints -- the docstring lists what the script prints, so it should match what it does.
