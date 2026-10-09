---
name: craftpath-spec
disable-model-invocation: true
context: fork
background: false
description: Start a work item -- its worktree, branch and SPEC.md -- and write its specification
argument-hint: <title>
---
# Specify a new work item

1. Run `python3 .craftpath/scripts/spec.py "$ARGUMENTS"`. It creates the work item -- its id, its
   worktree next to the repository, its branch, and `SPEC.md` from the
   template -- and prints where they are. **If it is refused or fails, stop
   and report the reason word for word. Do nothing else.**
2. Write the specification in that `SPEC.md`. Write nothing else: no plan, no
   design, no code. Read the code it concerns in the work item's worktree
   first, so the spec describes this project.
3. Fill every section from the request: $ARGUMENTS
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
6. Stop. Report where `SPEC.md` is, the check's result and the open questions.
   The next step, after the user has reviewed the spec: `/craftpath-design <work
   id>` when a decision changes how the work splits into tasks, otherwise
   `/craftpath-plan <work id>`.
