---
name: craftpath-design
disable-model-invocation: true
description: Write the optional design for a work item -- the decisions that change how it splits into tasks
argument-hint: <work id> [extra instructions]
---
**Run this whole step in a fresh subagent.** Call the `Agent` tool (from
pi-subagents-lite) with agent `general-purpose`, `run_in_background: false`,
and as its prompt everything below this paragraph followed by the user's
request exactly as given after this skill. Then report the subagent's result
to the user, word for word, and stop. Do not do the step yourself.

# Design a work item

1. Run `python3 .craftpath/scripts/design.py "<the user's request>"`. It creates `DESIGN.md` from the
   template (or points at the existing one) and prints where the work item's
   files are. **If it is refused or fails, stop and report the reason word for
   word. Do nothing else.**
2. Write the design: the decisions that change how the work splits into tasks.
   Write nothing else -- no plan, no code. If no such decision exists, say so
   and stop; this step is optional.
3. Read `SPEC.md` and the code it concerns, in the work item's worktree. Use the
   `architecture` skill for how the system is put together, and the `ux` skill
   for what a person experiences.
4. Fill `DESIGN.md`: for every decision, the options, the one chosen and why,
   and what was rejected and why. Delete the guidance comments.
5. Anything you cannot decide goes back to the user as a question. Do not
   invent an answer.
6. Run `python3 .craftpath/scripts/check.py design <work id>` and fix what it reports.
7. Stop. Report where `DESIGN.md` is and the check's result. The next step,
   after the user has reviewed it: `/skill:craftpath-plan <work id>`.

Extra instructions from the user, if any, follow the work id: the user's request, given after this skill
