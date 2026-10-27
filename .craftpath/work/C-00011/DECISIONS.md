# C-00011 — Decisions

## T-0001 — Refuse an over-long subject in the plan check

- The A4 fixture adds T-0002 with `task.py`, then rewrites its task file from `completeTask` while keeping the 40-character heading -- `kit.ts` is outside Touches, so `planned()` was not extended to take a title.
- Test titles are fixed strings of real words, and each test asserts the subject's length -- this follows the task's Notes, so a slip in a fixture shows up as a wrong length rather than a puzzling result.
- The A5 test changes T-0001's title in PLAN.md and runs `check.py plan` (asserting exit 0) before `complete.py` -- the criterion's Given requires a title that passed the plan check, and this makes that a checked step rather than an assumption.

## T-0002 — Require a known --type when adding a task

- Updated `evals/llm/fixture.ts` even though it is not in Touches -- the task's Notes say existing callers are updated in this task, the suite (and so `complete.py`) is red without it, and wave 2 holds only this task, so nothing else is editing that file.
- Left `plan.py`'s printed `task.py` hint unchanged and recorded it in Notes -- it is outside Touches, and no criterion needs it changed.
- Parsed `--wave` and `--type` with one shared `option()` helper that gives the same usage refusal for a missing option or value -- the Notes ask for `--type` to be parsed the way `--wave` is, and one helper avoids repeating that code.
- A3's test checks that T-0003 is listed under `### Wave 1` by looking at the text between the Wave 1 and Wave 2 headings -- that checks it is under the right wave without depending on how `PLAN.md` is laid out otherwise.
