---
description: Write the optional design for a work item -- the decisions that change how it splits into tasks
argument-hint: <work id> [extra instructions]
---
{{DELEGATE}}
# Design a work item

1. Run `{{SCRIPT:design}} "$ARGUMENTS"`. It creates `DESIGN.md` from the
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
6. Run `{{SCRIPT:check}} design <work id>` and fix what it reports.
7. Stop. Report where `DESIGN.md` is and the check's result. The next step,
   after the user has reviewed it: `{{CMD:plan}} <work id>`.

Extra instructions from the user, if any, follow the work id: $ARGUMENTS
