---
description: Write the optional design for a work item -- the decisions that change how it splits into tasks
argument-hint: <work id>
---
{{RUN:design}}

Write the design for the work item above: the decisions that change how the
work splits into tasks. Write nothing else -- no plan, no code. If no such
decision exists, say so and stop; this step is optional.

1. Read `SPEC.md` above and the code it concerns, in the work item's worktree.
2. Use the `architecture` skill for how the system is put together, and the
   `ux` skill for what a person experiences.
3. Fill `DESIGN.md`: for every decision, the options, the one chosen and why,
   and what was rejected and why. Delete the guidance comments.
4. Anything you cannot decide goes back to the user as a question. Do not
   invent an answer.
5. Check your work: run `{{SCRIPT:check}} design <work id>` and fix what it
   reports.
6. Stop. Tell the user where `DESIGN.md` is and show the check's result. The
   next step, after they have reviewed it, is `{{CMD:plan}} <work id>`.

Extra instructions from the user, if any: $ARGUMENTS
