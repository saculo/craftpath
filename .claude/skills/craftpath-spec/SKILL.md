---
name: craftpath-spec
disable-model-invocation: true
context: fork
background: false
description: Start a work item -- its worktree, branch and SPEC.md -- and write its specification
argument-hint: <what you want>
---
# Specify a new work item

The user's request: $ARGUMENTS

1. Give the work item a short title -- three to six words naming the change,
   like `Local application infrastructure` -- and run
   `python3 .craftpath/scripts/spec.py "<short title>"`. It creates the work item -- its id, its
   worktree inside the project at `.craftpath/worktrees/<id>-<slug>/`, its
   branch, and `SPEC.md` from the template -- and prints where they are. **If
   it is refused or fails, stop and report the reason word for word. Do
   nothing else** -- except for a title it finds too long: then shorten it and
   run it once more.
2. Write the specification in that `SPEC.md`. Write nothing else: no plan, no
   design, no code. Read the code it concerns in the work item's worktree
   first, so the spec describes this project.
3. Fill every section from the request above.
   - **Problem:** what is wrong or missing today, and for whom -- not the
     solution.
   - **Scenarios:** every behaviour as **Given / When / Then**, each one
     something an integration or e2e test could prove. One trigger per
     scenario, concrete values, and what must *not* happen. Number them S1,
     S2, ...
   - **Out of scope:** what a reader would reasonably assume is included but
     is not.
   - **Open questions:** anything you cannot decide from the request and the
     code. Do not invent answers -- the user resolves these.
4. Delete the guidance comments as you fill each section.
5. Run `python3 .craftpath/scripts/check.py spec <work id>` and fix what it reports. Open
   questions you could not resolve stay listed.
6. Stop. Report the work item's folder (its worktree) and where `SPEC.md` is,
   the check's result and the open questions.
   The next step, after the user has reviewed the spec: `/craftpath-design <work
   id>` when a decision changes how the work splits into tasks, otherwise
   `/craftpath-plan <work id>`.
