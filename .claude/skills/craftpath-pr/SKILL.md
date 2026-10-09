---
name: craftpath-pr
disable-model-invocation: true
context: fork
background: false
description: Open the pull request for a reviewed work item -- or push new commits to the open one
argument-hint: <work id>
---
# Open the pull request

1. Run `python3 .craftpath/scripts/pr.py "$ARGUMENTS"`. It commits `REVIEW.md`, pushes the work
   item's branch and opens the pull request into the base branch, with a
   title and body built from `SPEC.md`, `PLAN.md` and `REVIEW.md`. When the
   branch already has a pull request, the push adds the new commits to it.
   **If it is refused or fails, stop and report the reason word for word. Do
   nothing else.**
2. Stop. Report the pull request's link as the script printed it. Write no
   description of your own and change nothing: the body is the files.

The user's request: $ARGUMENTS
