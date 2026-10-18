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

## T-0003 — List DECISIONS.md among learn's sources

- A1's test finds the last task line in the output rather than hard-coding T-0001, then checks that the next two lines are `DECISIONS.md` and `REVIEW.md` -- this checks the exact order the criterion asks for, and stays correct if the fixture gains more tasks.
- Reverted the extra changes `init` made and kept only the installed `learn.py` and its manifest hash -- the task's Touches covers only `.craftpath/scripts/learn.py`, other tasks are working in parallel, and the hash keeps a later `init` from treating `learn.py` as edited by hand.
