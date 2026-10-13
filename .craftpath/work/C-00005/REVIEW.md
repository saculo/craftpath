# C-00005 — Work records decisions in DECISIONS.md: review

- **Reviewed at:** daf9c259809b355a79bac4b3925eb8eacc637bef

## Points

- [-] R1 [minor] assets/scripts/checks.py:14 -- the placeholder check now strips code spans wrapped across a line break, a change to `check.py`'s behaviour (with its test in test/steps/plan.test.ts) that no task's Touches covers and no scenario asks for; it came in as an unplanned fix commit (daf9c25), so it was never specified or planned (won't fix: the user asked for this fix in this PR -- it is what let the review guard accept C-00005's plan)
