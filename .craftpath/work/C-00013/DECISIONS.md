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
