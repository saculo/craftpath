---
description: Start a work item -- its worktree, branch and SPEC.md -- and write its specification
argument-hint: <title>
---
{{RUN:spec}}

Write the specification for the work item created above. Write nothing else:
no plan, no design, no code.

1. Open the `SPEC.md` at the path above. Read the code it concerns in the
   work item's worktree first, so the spec describes this project.
2. Fill every section from the user's request: $ARGUMENTS
3. Express every behaviour as a scenario with **Given / When / Then** that an
   integration or e2e test could prove. Number them S1, S2, ...
4. Anything you cannot decide from the request and the code goes under
   **Open questions**. Do not invent answers.
5. Delete the guidance comments as you fill each section.
6. Check your work: run `{{SCRIPT:check}} spec <work id>` and fix what it
   reports. Open questions you could not resolve stay listed -- the user
   resolves them.
7. Stop. Tell the user where `SPEC.md` is, show the check's result and the open
   questions, and say the next step, after they have reviewed the spec: an
   optional `{{CMD:design}} <work id>` when a decision changes how the work
   splits into tasks, otherwise `{{CMD:plan}} <work id>`.
