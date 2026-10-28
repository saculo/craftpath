# C-00013 — Decisions

## T-0001 — Refuse review-fix until a point can be fixed

- The refusal for A3/A4 reads "Nothing to fix: no review point is open in REVIEW.md." -- it contains the phrase the criteria require and says plainly why nothing will happen.
- When there is no `REVIEW.md`, the guard does not first check for a missing `PLAN.md` -- a review cannot exist without a plan, so that check would never be reached.
- A5 was proven by changing the code and watching the test fail, not by watching it fail before the code existed -- a "let through" test cannot fail before its guard exists, and the change shows it can catch a broken open-point check.
- A2's test ticks T-0001 in `PLAN.md` by editing the file directly, without completing it -- the guard only reads the ticks, and the review tests set up the same state this way.
