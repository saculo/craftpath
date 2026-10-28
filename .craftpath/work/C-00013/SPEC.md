# C-00013 — Review open points become tasks

## Problem

After `/craftpath-review`, an open point in `REVIEW.md` (`- [ ] R<n> ...`) has
only two ways out: the user fixes it by hand, or marks it won't fix (`[-]`).
Nothing in the flow turns it into work. `/craftpath-review` only writes
`REVIEW.md`, `/craftpath-work` only runs open tasks in `PLAN.md`, and
`/craftpath-plan` would recreate a finished plan from scratch, putting its
ticked tasks at risk. The user who wants a review's findings fixed the same
test-first way as the rest of the work item has no step to do it with.

## Scenarios

### S1 — Each testable open point becomes one open fix task

- **Given** work item `C-00001` whose `PLAN.md` has `T-0001` and `T-0002`
  ticked in waves 1 and 2, and whose `REVIEW.md` has open points `R1` and
  `R2`, both provable by a test
- **When** the user runs `/craftpath-review-fix C-00001`
- **Then** `PLAN.md` gains two open tasks, `T-0003` and `T-0004`, each with its
  own task file carrying `Fixes: R1` and `Fixes: R2` respectively, and
  acceptance criteria derived from its point, each proven by a named
  integration or e2e test, so `check.py plan C-00001` passes; no other point
  and no other task is created

### S2 — An untestable point rides along with a testable one

- **Given** `REVIEW.md` has open points `R1` (a wrong exit code, provable by a
  test) and `R3` (README wording no test can prove), and every task is ticked
- **When** the user runs `/craftpath-review-fix C-00001`
- **Then** exactly one new open task is created, whose file says
  `Fixes: R1, R3`, and every one of its acceptance criteria is proven by a
  named integration or e2e test; no task exists whose `Fixes` names only `R3`

### S3 — Only untestable open points creates nothing

- **Given** every open point in `REVIEW.md` is one no test can prove (e.g.
  README wording), and every task is ticked
- **When** the user runs `/craftpath-review-fix C-00001`
- **Then** `PLAN.md` and the task files are unchanged, and the step tells the
  user to fix those points by hand or mark them won't fix

### S4 — New tasks are numbered and waved after the existing plan

- **Given** `PLAN.md` whose last task is `T-0003`, ticked, in wave 2 (the
  highest wave), and two open testable points that touch the same module
- **When** the user runs `/craftpath-review-fix C-00001`
- **Then** the new tasks are `T-0004` and `T-0005`, placed in waves 3 and 4
  (never in wave 1 or 2, never sharing a module within one wave), and
  `check.py plan C-00001` passes

### S5 — Closed points are never turned into tasks

- **Given** `REVIEW.md` with `R1` open, `R2` marked `[x]` (solved) and `R3`
  marked `[-]` (won't fix)
- **When** the user runs `/craftpath-review-fix C-00001`
- **Then** no new task's `Fixes` line names `R2` or `R3`, and `REVIEW.md` is
  unchanged

### S6 — Ticked tasks are never changed or reopened

- **Given** a plan whose tasks `T-0001` and `T-0002` are ticked
- **When** the user runs `/craftpath-review-fix C-00001` and it adds tasks
- **Then** the lines of `T-0001` and `T-0002` in `PLAN.md` are still `[x]`
  and their task files are byte-for-byte unchanged

### S7 — The step adds tasks and stops

- **Given** open testable points and every task ticked
- **When** the user runs `/craftpath-review-fix C-00001`
- **Then** no new task is ticked, no task commit is created, and the step's
  report names the new tasks and points to `/craftpath-work C-00001 all`

### S8 — Work then runs only the new open tasks

- **Given** a plan with ticked `T-0001` and `T-0002` and open fix tasks
  `T-0003` and `T-0004` added by review-fix
- **When** the user runs `/craftpath-work C-00001 all`
- **Then** the work script lists `T-0003` and `T-0004` to run and does not list
  `T-0001` or `T-0002`

### S9 — Refused without a review

- **Given** every task is ticked and there is no `REVIEW.md`
- **When** the user runs `/craftpath-review-fix C-00001`
- **Then** the guard refuses, saying there is no review yet and to run
  `/craftpath-review C-00001`, and nothing is written

### S10 — Refused while a task is still open

- **Given** `REVIEW.md` has an open point and `T-0002` is still open
- **When** the user runs `/craftpath-review-fix C-00001`
- **Then** the guard refuses, naming `T-0002` as not done, and nothing is
  written

### S11 — Refused when no point is open

- **Given** every task is ticked and every point in `REVIEW.md` is `[x]` or
  `[-]`, or Points says `None`
- **When** the user runs `/craftpath-review-fix C-00001`
- **Then** the guard refuses, saying no point is open, and nothing is written

### S12 — The same step on Claude Code and pi

- **Given** a project initialised with both harnesses
- **When** `craftpath init` installs the steps
- **Then** the step is installed as `/craftpath-review-fix` for Claude Code and
  `/skill:craftpath-review-fix` for pi, and both run the same script and guard

## Out of scope

- Running review-fix twice on the same point: no detection of duplicate or
  retry tasks for a point that already has one.
- A new state for points or tasks; the existing `[ ]`, `[x]`, `[-]` stay the
  only ones.
- Choosing a subset of points: there is no argument to pick points; every open
  point is handled.
- Running `/craftpath-work` automatically after the tasks are added.
- Any change to `checks.py`'s proof rule for acceptance criteria.
- Marking points solved: that stays the job of `/craftpath-review` re-run after
  the fix tasks are done.

## Assumptions

- The step runs as a delegated subagent like `/craftpath-plan` and
  `/craftpath-review`: a guard checks the preconditions (S9-S11), a script
  prints the open points, the last task id and the highest wave, and the agent
  writes the tasks with `task.py`. Reason: this is how every other step that
  writes agent-authored files is built, and `task.py` already numbers tasks
  and lists them under their wave.
- Agent-written content (S1, S2, S5, S6) is proven by the deterministic check
  the step runs on its result -- every open point is named by exactly the new
  open tasks' `Fixes` lines, no closed point is named, ticked tasks are
  unchanged -- in the same way `check.py spec`, `plan` and `review` prove the
  other steps' files. Reason: an integration test can drive a script and a
  check, not the agent's judgment.
- The `Fixes:` line sits with the task file's other header fields
  (`- **Fixes:** R1, R3`), and the new tasks have type `fix`. Reason: it keeps
  the task file's one header format, and `fix` is the existing type for
  correcting delivered behaviour.
- The new tasks are committed as a plan change by `/craftpath-work`'s existing
  plan commit, not by the review-fix step. Reason: S7 requires the step to
  create no commit, and `work.py` already commits `PLAN.md` and task files
  before running.

## Open questions

None
