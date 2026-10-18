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

## T-0004 — Point learn at decisions as knowledge sources

- A3's test compares the `[ADR]` section in lower case -- the case-sensitive version did not fail when "Every decision becomes an ADR." was written in, so it did not guard the rule.
- In A1's test, the "sources" instruction is the numbered instruction containing "Change nothing but `KNOWLEDGE.md`", and every required phrase is checked inside it -- this ties the new sources to the same instruction that keeps the read-only rule, as A1 asks.
- A2 is worded as "a decision a subagent recorded in `DECISIONS.md`, or an assumption in `SPEC.md`'s `## Assumptions`", followed by "has to pass the same *worth keeping* test as any other candidate; most will not" -- it extends the existing "typically …" list instead of adding a separate paragraph, and "most will not" pushes against turning every decision into an ADR.
- Kept the two learn skill copies and their manifest hashes, and reverted every other change `init` made -- other tasks are changing those modules in parallel, and the hashes stop a later `init` from treating the learn copies as edited by hand.
- Renamed the `work.test.ts` invariant test to "only work, which writes DECISIONS.md, and review and learn, which read it, name it" -- the old name would have been wrong once learn was allowed to name the file.
