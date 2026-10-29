## T-0001 — Require a failure scenario in every verify point

- The messages read `F1 has no failure scenario` and `F2 has no file:line`, and the tests assert those phrases -- the task named what must be reported, not the wording; these follow review's `<id> is ...` style.
- A line that doesn't fit the point shape, including an `R<n>` id or a missing ` -- `, is reported once as `not a point`, quoting the line, and gets no location or scenario check -- this is how review handled such lines, and with the wrong shape there is no location or scenario to check.
- `check_verify` copies `check_review`'s loop instead of sharing a helper with it -- T-0007 deletes `check_review`, so sharing would mean changing review code that is about to go.
- `given` may start with a capital or lowercase letter (`[Gg]iven`), but must be the first word after ` -- ` -- that is my reading of the plan's "either case", and it keeps the check mechanical.

## T-0002 — Refuse verify until every task is committed

- Duplicated `review.py` into `verify.py` instead of sharing the checks in a common helper -- a shared helper would mean editing `review.py`, which is outside Touches, and T-0007 deletes `review.py` anyway.
- Defined a local `verify(tree)` path helper in the test file instead of adding one to `kit.ts` -- `kit.ts` is outside Touches, and other tasks in the wave may be editing it.
- A4 writes `.craftpath/work/C-00001/notes.md` as its uncommitted file inside the work item -- the criterion names no file, and `VERIFY.md` is the script's output, so any other file is a cleaner example.

## T-0003 — Run tests first, then bind VERIFY.md to HEAD

- Added `verify.py` to the expected list of the "only review, learn and pr name DECISIONS.md" test in `test/steps/review.test.ts`, rather than stopping or avoiding the literal filename in `verify.py` -- A5 requires `verify.py` to commit `DECISIONS.md`, so the test could not stay green otherwise; the edit is one line and T-0007 moves the test anyway.
- Kept the `  decisions: <short sha> <subject>` line when `verify.py` commits `DECISIONS.md` -- the task notes allow it, and it shows that the commit happened without giving the path.
- Wrote the A6 test as one test covering both halves (closed record commits; open point makes no commit) -- the criterion names one test for both.

## T-0004 — Install the verify step: find, then refute

- The finder's and refuter's briefs are separate `##` sections after the steps, block-quoted the way work's brief is, and the tests split the installed text at those headings -- this follows work.md's shape and lets each test check what each agent gets.
- The refuter answers `confirmed` or `refuted` per finding, with the finding repeated verbatim, and the step adds only the `confirmed` ones -- this gives the step a clear rule for "could not refute".
- The finder proposes findings already in point form (`[major|minor] <file:line> -- given ..., ...`) and leaves out any it has no failure scenario for -- the step can then copy a confirmed finding straight into an `F<n>` point.
- The step's report also lists the findings the refuter refuted, and they are written into no file -- the user can see what was dropped without breaking S8.
- I added the `startsSubagents` helper next to `forPiSubagents` instead of repeating `source.includes("{{SUBAGENT}}")` at each of the three uses -- the plan asks for one rule shared by both harnesses.
- The README row says verify needs "tests and checks green" -- verify.py from T-0003 runs module checks as well as tests.

## T-0005 — Gate learn on VERIFY.md

- The A2 test writes `REVIEW.md` directly instead of running `review.py` and doesn't import kit's `review` helper -- so the test keeps working when other tasks remove the review step.
- The skill-text test now expects `VERIFY.md` instead of `REVIEW.md`, and its name says "verification" -- the task changes learn.md to read VERIFY.md, so the old assertion would describe the wrong behaviour.

## T-0006 — Gate the pull request on VERIFY.md (stuck)

- A5's test checks the `No points.` case (the body's Verify section with `None`), and the existing P4 test checks that point lines are carried into the body -- P4 already covered point lines, so A5 adds only the empty case and the absence of `## Review`.
- The solved point in the P4 fixture says "given a POST request" rather than "a HEAD request" -- the test swaps the literal `HEAD` for a sha, and the word HEAD in the text would have been replaced instead.
- I did not edit `evals/llm/fixture.ts` to make E5 green -- it is in T-0007's Touches, not this task's, so I reported the gap instead of crossing the boundary.

