---
description: Plan a work item -- its tasks, their acceptance criteria, and the waves they run in
argument-hint: <work id>
---
{{RUN:plan}}

Plan the work item above. Write nothing else -- no code.

1. Read `SPEC.md` (and `DESIGN.md`, if listed above) and the code they concern,
   in the work item's worktree.
2. Use the `planning` skill: it says what a good task and a good criterion are.
3. Add every task with `{{SCRIPT:task}} <work id> --wave <n> "<task title>"`.
   It numbers the task, writes its file from the template and lists it in
   `PLAN.md` under its wave. Then fill the task file.
4. Tasks in one wave run in parallel, so they must not touch the same files. A
   task may depend only on tasks in earlier waves.
5. Every criterion is proven by an integration or e2e test, and every SPEC.md
   scenario is covered by at least one task.
6. Fill `PLAN.md`'s Goal and Approach, and delete the guidance comments.
7. Check your work: run `{{SCRIPT:check}} plan <work id>` and fix what it
   reports.
8. Stop. Tell the user where `PLAN.md` is, list the tasks by wave, and show the
   check's result. The next step, after they have reviewed the plan, is
   `{{CMD:work}} <work id> wave 1` -- or `all`.

Extra instructions from the user, if any: $ARGUMENTS
