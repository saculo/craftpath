---
name: craftpath-work
disable-model-invocation: true
description: Implement a work item's tasks a wave at a time -- one subagent per task, each test first
argument-hint: <work id> wave <n> | all
---
# Work on a work item

You run this step in this session and start one subagent per task. Write no
code yourself.

1. Run `python3 .craftpath/scripts/work.py "<the user's request>"`. It lists the open tasks of the selected
   waves, by wave, with each task file and its modules' test commands. **If it
   is refused or fails, stop and report the reason word for word. Do nothing
   else.** If it says there is nothing to do, report that and stop.
2. For each wave it lists, in order:
   1. Start one subagent per task in the wave, **all at once, in parallel**,
      with the `Agent` tool (agent `general-purpose`). Give each the brief
      below, filled in for its task. Wait until every one has finished.
   2. For each task whose subagent ends with `DONE`, **one at a time**, run
      `python3 .craftpath/scripts/complete.py <work id> <task id>`. It runs the task's module
      tests, and only if they pass ticks the task and commits it. Never run
      two at once, and never commit or tick a task yourself.
   3. If any task of the wave is not ticked -- its subagent is stuck, or
      `complete.py` found its tests red -- stop after this wave: later waves
      build on it.
3. Stop. Report each task: done, with the commit `complete.py` printed; or
   not done, with the subagent's reason or what the tests reported. When a
   task is not done, the user decides what happens next; running
   `/skill:craftpath-work <work id> all` again picks up the open tasks. Once every
   task is done, the next step is `/skill:craftpath-review <work id>`.

The user's request: the user's request, given after this skill

## The brief for each task's subagent

> You implement task `<task id>` of work item `<work id>`. Work only in the
> worktree `<worktree>`: run every command there, and read and write files
> there.
>
> Read the task, `<task file>`, and the spec, `<spec>`. Load the engineering
> skills its Notes name. Follow `.pi/skills/tdd/SKILL.md` for every acceptance
> criterion, smallest first: write the integration or e2e test the criterion
> names, run the module's tests (`<test command>`) and see it fail because the
> behaviour is missing; then write the least code that makes it pass; then
> tidy up with the tests green.
>
> Change only what the task's Touches covers: other tasks are changing other
> modules at the same time. Do not commit, do not edit `PLAN.md`, and do not
> run `complete.py` -- the step does that after you finish. Write what the
> reviewer should know -- decisions you made, anything surprising -- under
> Notes in the task file.
>
> If the task cannot be done as written -- the plan contradicts the code, a
> criterion cannot be tested, something it needs is missing -- stop and say
> why rather than changing the plan or the criteria.
>
> End your reply with `DONE`, or with `STUCK: <reason>`.
