# C-00011 — Decisions

## T-0001 — Refuse an over-long subject in the plan check

- The A4 fixture adds T-0002 with `task.py`, then rewrites its task file from `completeTask` while keeping the 40-character heading -- `kit.ts` is outside Touches, so `planned()` was not extended to take a title.
- Test titles are fixed strings of real words, and each test asserts the subject's length -- this follows the task's Notes, so a slip in a fixture shows up as a wrong length rather than a puzzling result.
- The A5 test changes T-0001's title in PLAN.md and runs `check.py plan` (asserting exit 0) before `complete.py` -- the criterion's Given requires a title that passed the plan check, and this makes that a checked step rather than an assumption.
