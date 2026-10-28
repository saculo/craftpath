# C-00013 — Decisions

## T-0001 — Refuse review-fix until a point can be fixed

- The refusal for A3/A4 reads "Nothing to fix: no review point is open in REVIEW.md." -- it contains the phrase the criteria require and says plainly why nothing will happen.
- When there is no `REVIEW.md`, the guard does not first check for a missing `PLAN.md` -- a review cannot exist without a plan, so that check would never be reached.
- A5 was proven by changing the code and watching the test fail, not by watching it fail before the code existed -- a "let through" test cannot fail before its guard exists, and the change shows it can catch a broken open-point check.
- A2's test ticks T-0001 in `PLAN.md` by editing the file directly, without completing it -- the guard only reads the ticks, and the review tests set up the same state this way.

## T-0002 — List open review points for fix tasks

- The fix-task wave line reads `fix tasks start at wave {highest + 1}` and the hint prints `--wave <n>` -- the agent may need more waves than one (S4 puts tasks touching the same module in waves 3 and 4), so the script states only where they start.
- In A1, "contains neither `R2` nor `R3`" is checked as a whole word (`/\bR2\b/`) -- the random scratch directory names in printed paths could otherwise contain "R2" by chance and make the test flaky.
- The A5 test fills T-0002 from the kit's `completeTask` fixture, with its type changed to `fix` and a `- **Fixes:** R1` line added -- this reuses the shared fixture instead of writing a new task template.

## T-0003 — Check fix tasks cover every open point

- The problems are reported in this wording: `<T>: fixes no review point -- ...`, `<T>: fixes <R>, which is not an open review point in REVIEW.md`, and `<R> is open, but no new task fixes it -- ...` -- the criteria only say the task or point must be named, and these follow the `<id>: <problem> -- <remedy>` style `checks.py` already uses.
- The test fixture commits `REVIEW.md` itself rather than running `review-fix.py` -- this keeps the check test separate from the script T-0002 already tests, and lets a `[x]` point carry a real commit sha.
- The A4 test covers R2 as `[x]`, R2 as `[-]`, and R3 as `[-]` -- the criterion names both closed states for R2 and then R3, so all three cases are tested.

## T-0004 — Check fix tasks leave finished work untouched

- `at_head` reads HEAD's copy with `git show` directly instead of the `craftpath.git` helper -- that helper strips trailing whitespace from its output, so a change at the end of a file would slip through the byte-for-byte comparison.
- The finished-work and `REVIEW.md` checks run even when no task was added -- in S3 the files must also stay unchanged, and with no changes they pass, so A1 still exits 0.
- Each kind of change gets its own message (plan line, task file, `REVIEW.md`), naming the task or file -- so the user can see exactly which file to restore.
