# C-00008 — Decisions

## T-0001 — List DECISIONS.md among what review prints

- Kept only the `review.py` copy and its manifest hash from `init`, and restored the other refreshed copies -- they are outside this task's Touches, and other tasks in the wave may be changing those skills at the same time.
- In the tests, the "directly after the `plan:` line" check is a small `afterPlan(out)` helper that returns the next line of stdout -- it checks the position exactly, which `toContain` would not.
- Put `work / "DECISIONS.md"` into one local variable `decisions_md`, used both for the commit and for the printed line -- it removes the repeated path, and the existing `decisions` variable already holds the commit line.
- Updated the `review.py` docstring to list the spec, the plan and DECISIONS.md among what it prints -- the docstring lists what the script prints, so it should match what it does.

## T-0002 — Have the reviewer check recorded decisions

- The A2 and A3 tests require exactly one paragraph or bullet in *How to review* to name `DECISIONS.md`, and check all the phrases there -- A3 speaks of "the paragraph naming DECISIONS.md", so pinning it to one paragraph keeps the rule in one place.
- A1 checks the "change no file but REVIEW.md" part by the literal phrase "no other file -- only `REVIEW.md`" -- it is the existing wording, so the test fails if the instruction is ever loosened.
- Kept only the two review-skill copies from `init` and reverted every other installed copy it refreshed -- they lie outside this task's Touches and other tasks are changing those modules in parallel.
