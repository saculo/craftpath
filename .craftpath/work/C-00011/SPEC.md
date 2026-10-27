# C-00011 — Task commit subject length limit

## Problem

`complete.py` commits each finished task as `<type>(<work id>/<task id>): <title>`,
taking the type from the task file and the title from the task's line in
PLAN.md. Nothing limits how long that title is, so nothing stops the subject
from passing 72 characters -- the limit CI's `pr-standards` job enforces on
every commit of a pull request. The overrun only shows up once the branch is
pushed: CI rejected two of C-00005's task commits and the branch had to be
rewritten. Whoever plans a work item gets no warning at the point where
shortening a title costs nothing.

With a work id like `C-00011` and a task id like `T-0001`, the prefix
`<type>(C-00011/T-0001): ` is 22 characters for `feat` and 26 for `refactor`,
leaving 50 and 46 characters for the title.

## Scenarios

### S1 — The plan check refuses a task whose subject would be too long

- **Given** work item C-00011 whose plan is otherwise complete, with task T-0002
  of Type `feat` listed in PLAN.md under a 51-character title, so its commit
  subject would be 73 characters
- **When** the user runs `check.py plan C-00011`
- **Then** it exits 1 and lists a problem that names T-0002, says its commit
  subject would be 73 characters and that the limit is 72
- **And** it does not say PLAN.md is complete, and PLAN.md and tasks/T-0002.md
  are unchanged

### S2 — A subject of exactly 72 characters passes the plan check

- **Given** the same work item, with T-0002 of Type `feat` under a 50-character
  title, so its commit subject would be exactly 72 characters
- **When** the user runs `check.py plan C-00011`
- **Then** it exits 0 and says PLAN.md is complete, reporting no problem about
  T-0002's subject length

### S3 — The task's type counts towards the length

- **Given** the same work item, with T-0002 under the same 50-character title
  as in S2 but of Type `refactor`, so its commit subject would be 76 characters
- **When** the user runs `check.py plan C-00011`
- **Then** it exits 1 and lists a problem that names T-0002 and says its commit
  subject would be 76 characters, limit 72

### S4 — A title lengthened by hand in PLAN.md is caught

- **Given** task T-0002 of Type `feat`, added by `task.py` under a 40-character
  title, whose line in PLAN.md was then edited to a 51-character title
- **When** the user runs `check.py plan C-00011`
- **Then** it exits 1 and lists a problem that names T-0002 and says its commit
  subject would be 73 characters, limit 72 -- the length measured is that of
  the title in PLAN.md, the one `complete.py` commits

### S5 — Adding a task whose subject would be too long is refused

- **Given** work item C-00011 with a PLAN.md listing T-0001 and T-0002
- **When** the user runs
  `task.py C-00011 --wave 1 --type refactor "<a 47-character title>"`
- **Then** it exits 1 and prints, in the same words the plan check uses, that
  T-0003 is refused because its commit subject would be 73 characters, limit 72
- **And** no tasks/T-0003.md is created and PLAN.md is unchanged

### S6 — Adding a task whose subject fits records its type

- **Given** the same work item as S5
- **When** the user runs
  `task.py C-00011 --wave 1 --type refactor "<a 46-character title>"`, so its
  commit subject would be exactly 72 characters
- **Then** it exits 0, creates tasks/T-0003.md whose Type is `refactor`, and
  lists T-0003 under wave 1 in PLAN.md with that title
- **And** `check.py plan C-00011` reports no problem about T-0003's Type

### S7 — Adding a task without a type is refused

- **Given** the same work item as S5
- **When** the user runs `task.py C-00011 --wave 1 "Add the length check"`,
  with no `--type`
- **Then** it exits 1 and prints a usage line that shows `--type <type>` as
  required
- **And** no tasks/T-0003.md is created and PLAN.md is unchanged

### S8 — Adding a task with an unknown type is refused

- **Given** the same work item as S5
- **When** the user runs
  `task.py C-00011 --wave 1 --type feature "Add the length check"`
- **Then** it exits 1 and says the type must be one of feat, fix, test,
  refactor, docs, perf, chore -- the same list the plan check accepts
- **And** no tasks/T-0003.md is created and PLAN.md is unchanged

### S9 — Completing a task that passed the plan check commits its subject unchanged

- **Given** a task T-0001 of Type `feat` whose 50-character title passed
  `check.py plan`, and whose modules' tests pass
- **When** the user runs `complete.py C-00011 T-0001`
- **Then** it commits with the subject `feat(C-00011/T-0001): <that title>`,
  exactly 72 characters, neither truncated nor reworded

## Out of scope

- Subjects of commits made outside `complete.py`: review fixes, the docs commits
  of the review and PR steps, and anything the user commits by hand.
- Changing CI's 72-character limit or the `pr-standards` workflow.
- `complete.py` checking, shortening or rewording a subject at commit time.
- Rewriting already-committed history or titles of earlier work items such as
  C-00005.
- Limiting the length of work item titles (`spec.py`) or anything other than a
  task's commit subject.
- A way to change an existing task's type through `task.py`; the planner edits
  the Type in the task file, and the plan check re-measures it.
- Adding a type to tasks already planned in earlier work items.

## Assumptions

- **task.py measures the subject with the type it is given.** `task.py` now
  takes the task's type with `--type` and writes it into the task file, so the
  subject it measures is the one `complete.py` will commit. If the planner later
  edits the Type in the task file, the plan check (S1-S4) measures again with
  the type then in the file.
- **`--type` is accepted anywhere among the arguments, like `--wave`,** and is
  validated against the plan check's list of types, so `task.py` and
  `check.py plan` never disagree about what a valid type is.
- **The plan step's instructions (`assets/steps/plan.md`, and the PLAN.md
  template's guidance) are updated to call `task.py` with `--type`**, since
  without it the step's documented command would be refused (S7).
- **The title measured is the one in PLAN.md**, not the heading of the task file,
  because that is the title `complete.py` puts in the subject.
- **Length is counted in characters**, matching CI's `${#subject}`.
- **The limit is 72 inclusive**: a 72-character subject passes, 73 fails, as in
  CI's `-gt 72`.
- **The change is made in `assets/scripts/`** and installed with
  `bun bin/craftpath.ts init`, as CLAUDE.md requires; the guards that apply the
  plan check before the work step therefore refuse an over-long subject too,
  with no change of their own.

## Open questions

None
