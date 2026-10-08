---
description: Plan a work item -- its tasks, their acceptance criteria, and the waves they run in
argument-hint: <work id> [extra instructions]
---
{{DELEGATE}}
# Plan a work item

1. Run `{{SCRIPT:plan}} {{ARGS}}`. It creates `PLAN.md` from the template
   (or points at the existing one) and prints where the work item's files are.
   **If it is refused or fails, stop and report the reason word for word. Do
   nothing else.**
2. Plan the work. Write nothing else -- no code. Read `SPEC.md` (and
   `DESIGN.md`, if listed) and the code they concern, in the work item's
   worktree. Follow *How to plan well* below.
3. Add every task with `{{SCRIPT:task}} <work id> --wave <n> "<task title>"`.
   It numbers the task, writes its file from the template and lists it in
   `PLAN.md` under its wave. Then fill the task file.
4. Fill `PLAN.md`'s Goal and Approach, and delete the guidance comments.
5. Run `{{SCRIPT:check}} plan <work id>` and fix what it reports.
6. Stop. Report where `PLAN.md` is, the tasks by wave, and the check's result.
   The next step, after the user has reviewed the plan: `{{CMD:work}} <work id>
   wave 1`, or `all`.

Extra instructions from the user, if any, follow the work id: {{REQUEST}}

## How to plan well

You are turning a reviewed `SPEC.md` into tasks that someone else will execute.
Each task may run in a fresh agent that sees its task file, the spec, and
nothing else you were holding in your head.

Plan for that reader. Every ambiguity you leave becomes a guess made later by
someone with less context than you have right now.

### Why the plan deserves real effort

The user reads the plan before any code exists. That is the last point where a
misunderstanding costs a sentence instead of a rebuilt feature.

So the goal is not a plan that looks thorough. It is a plan the user can
disagree with -- specific enough that they can say "no, split T-0003" before any
code exists.

### The files

- `PLAN.md` -- the Goal, the Approach, and the task list by wave. The task list
  is written by `task.py`; never edit task lines by hand.
- `tasks/T-0001.md`, ... -- one file per task, created by
  `task.py <work id> --wave <n> "<title>"` from the template. You fill in:

  | Field | What goes there |
  |---|---|
  | Type | `feat`, `fix`, `test`, `refactor`, `docs`, `perf` or `chore` -- it becomes the commit type |
  | Wave | set by `task.py`; tasks in one wave run in parallel |
  | Depends on | `none`, or tasks from earlier waves whose result this one needs |
  | Touches | the files or modules this task changes |
  | Scenarios | the `SPEC.md` scenarios it implements (`S1, S2`) |
  | Acceptance criteria | `- **A1** <behaviour> — proven by integration test \`<name>\`` |

`check.py plan <work id>` tells you what is still missing. Run it before you
stop.

### What a task is

One focused change and one commit. If you cannot describe what "done" looks
like in a sentence, it is two tasks.

A good task:

- changes one behaviour a user or caller can observe
- can be verified without waiting for another unfinished task
- leaves the codebase working if the next task never happens

That last one is the sharpest test. A task that leaves the system broken until
its sibling lands is not a task; it is half of one.

### Acceptance criteria are the whole job

A criterion is a statement about observable behaviour, paired with the test
that proves it. Vague criteria are the most common way a plan fails: nobody can
object to them, and they prove nothing.

**Weak:** "Avatar upload works correctly"
**Strong:** "Uploading a TIFF returns 415 and writes nothing to storage"

The strong one names an input, an output, and a side effect that must not
happen. It can fail. That is what makes it worth writing.

#### Proven at integration or e2e level

Every criterion names the **integration or e2e test** that proves it. Unit
tests are welcome while implementing, but they are never the proof of a
criterion: a criterion is about behaviour someone outside the code can observe,
and only a test at that level can show it.

#### The shape that makes a criterion testable

> **Given** a precondition · **When** one trigger · **Then** an observable outcome

- **Exactly one trigger.** Two actions in one criterion means two tests, or a
  test that cannot say which action broke.
- **Concrete values, not adjectives.** "Rejects large files" is untestable;
  "a 5 MB + 1 byte upload returns 413" is a test. "Quickly", "properly",
  "correctly" and "gracefully" mean the author had not decided yet.
- **Domain language, not implementation.** Name the behaviour, not the class
  that will provide it.
- **Include the negative half.** "Returns 415" is half a criterion when the
  real requirement is "returns 415 *and writes nothing to storage*". The half
  that says what must **not** happen is the one most often dropped.

Cover four dimensions per behaviour, and notice which one you skipped: the
happy path, the error case, the boundary value, and the alternative path that
also succeeds.

#### Written before the code, which is the point

The test that proves a criterion is the first thing the implementer writes,
before any production code, and watches fail -- see `{{RULE:tdd.md}}`. So ask of
every criterion: *could someone write a failing integration or e2e test for
this, right now, knowing nothing but this sentence?* If not, it is not finished.

#### Every scenario is covered

Every scenario in `SPEC.md` is named by at least one task's Scenarios, and its
Given / When / Then appears in that task's criteria.

### Waves and dependencies

Tasks in the same wave run in parallel, in the same worktree. So:

- **Tasks in one wave must not touch the same files.** Fill in Touches honestly;
  it is how the user checks this.
- A task may depend only on tasks in **earlier** waves. Put a task in a later
  wave only when it would actually fail if run first -- not for narrative order.
  Every unnecessary wave serializes work that could run in parallel.

### When a decision is still open

Some tasks cannot be given testable criteria because a decision has not been
made. Do not paper over it with a vague criterion. Ask: **would a different
answer change the task list?**

- **Yes** -- it is a boundary decision. It belongs in `DESIGN.md`, before the
  plan. Stop and tell the user; the design step comes first.
- **No** -- it is local to one task. Record the choice and why in that task's
  Notes, and write the criteria for the chosen answer.

### Skills for the implementer

Name what the implementer needs in the task's Notes when it is not obvious:
`backend`, `frontend` or `infrastructure` for the discipline, and `testing` only
when testing is the task's subject -- an e2e journey, which level an assertion
belongs at, a flaky suite. A task that seems to need three discipline skills is
crossing too many boundaries; split it.

### Sizing

Too big:

- the title contains "and"
- more than about five criteria
- it touches both a data model and a user interface

Too small:

- it cannot be verified on its own
- its commit would say nothing meaningful
- it only sets up the next task with no observable behaviour change

**Deciding not to split is also a planning output.** When the work is one
coherent change, say so in the Approach and say why -- one sentence is enough.

Be wary of a split that ships a half-guarded system: an endpoint in one task and
its validation in the next means the branch carries an unvalidated write path
until the second task lands. Accept-and-reject usually belong together.

### Before you stop

Fix what fails rather than noting it:

1. Every `SPEC.md` scenario is covered by at least one task
2. Every criterion names the integration or e2e test that proves it
3. Every criterion could be written as a test that fails today
4. Every criterion states one trigger and a concrete, observable outcome
5. Every criterion that forbids an effect says so explicitly
6. Tasks in one wave touch different files
7. Every dependency is on an earlier wave, and would actually fail if violated
8. No task title contains "and"
9. `check.py plan <work id>` reports the plan complete

### After the user reviews it

The user edits the plan or asks you for changes. Once work starts, the plan is
what is being built: when work shows the plan was wrong, stop and tell the user
rather than quietly changing it.
