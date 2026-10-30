---
name: craftpath-verify-fix
disable-model-invocation: true
description: Turn a work item's open [fix] points into fix tasks -- added to the finished plan, not run
argument-hint: <work id>
---
**Run this whole step in a fresh subagent.** Call the `Agent` tool (from
pi-subagents-lite) with agent `general-purpose`, `run_in_background: false`,
and as its prompt everything below this paragraph followed by the user's
request exactly as given after this skill. Then report the subagent's result
to the user, word for word, and stop. Do not do the step yourself.

# Turn open [fix] points into fix tasks

This step handles `[fix]` points only: a `[you]` or `[noted]` point gets no task.

Load the `never-block-on-the-human` skill before you do anything else.
Load the `test-first` skill before you do anything else.
Load the `sequence-verifiable-units` skill before you do anything else.

1. Run `python3 .craftpath/scripts/verify-fix.py "<the user's request>"`. It prints the work item's files, the
   open `[fix]` points, the last task, the highest wave and the wave the fix
   tasks start at. **If it is refused or fails, stop and report the reason
   word for word. Do nothing else.**
2. Plan the fixes. Change no code and no other file -- only `PLAN.md` and the
   new task files. Read `SPEC.md`, `PLAN.md`, the task files and `VERIFY.md`,
   then the code each open point names, in the work item's worktree. Follow
   *How to plan the fixes* below.
3. Add every fix task with `python3 .craftpath/scripts/task.py <work id> --wave <n> --type fix "<task title>"`,
   in the wave the script said fix tasks start at or later. It numbers the
   task, writes its file from the template and lists it in `PLAN.md` under its
   wave. Then fill the task file.
4. Run `python3 .craftpath/scripts/check.py verify-fix <work id>` and fix what it reports.
5. Stop. Do not run `complete.py` or `/skill:craftpath-work`, tick no task and make no
   commit: the step only adds tasks. Report the new tasks by wave, the points
   each fixes, and the check's result. The next step, after the user has read
   the new tasks: `/skill:craftpath-work <work id> all`, then `/skill:craftpath-verify <work id>`
   again to mark the points solved.

The user's request: the user's request, given after this skill

## How to plan the fixes

Every open `[fix]` point in `VERIFY.md` is handled; a closed point (`[x]` or `[-]`) is
never named. The finished plan stays as it is: never change, reopen or
renumber a ticked task, never edit its task file, and never edit `VERIFY.md`.

### One task per testable point

A testable point is one an integration or e2e test can prove fixed. Each gets
a task that a fresh agent can implement from its file alone:

| Field | What goes there |
|---|---|
| Type | `fix`, set by `task.py --type fix` |
| Wave | the wave the script said fix tasks start at, or later |
| Depends on | `none`, or fix tasks from earlier waves whose result this one needs |
| Touches | the files or modules the fix changes |
| Scenarios | the `SPEC.md` scenarios whose behaviour the fix corrects |
| Fixes | `- **Fixes:** F<n>, ...`, on its own line after Scenarios: the points it fixes |
| Acceptance criteria | derived from its points: `- **A1** <behaviour> — proven by integration test \`<name>\`` |

Each criterion states the behaviour the point says is wrong, as it must be once
fixed -- one trigger, a concrete outcome, and what must not happen -- and names
the integration or e2e test that proves it. That test is the first thing the
implementer writes and watches fail.

Points that touch the same module go in different waves, as in any plan; two
points in the same place may share one task when one fix solves both.

### Untestable points ride along

An untestable point -- README wording, a stale comment, anything no test can
prove -- is put in the `Fixes` of a task for a testable point, never in a task
of its own: a task whose every criterion needs a test cannot be built around a
point no test proves. Pick the task whose Touches is closest to it and say in
its Notes what to change.

With only untestable points open, add no task: tell the user to fix them by
hand or mark them won't fix (`[-]`), then run `/skill:craftpath-verify <work id>` again.
