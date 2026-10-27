---
name: boundary-discipline
description: A principle, not an engineering discipline — a change stays inside the boundary its task owns. Load it whenever you implement a task, touch a file, or feel the pull to fix something nearby. The files, modules and behaviour a task names are its boundary; anything past it is someone else's work.
---

# Boundary discipline

A change stays inside the boundary its task owns. The task says what it
touches and what it must deliver; that is the boundary. Work past it -- a
neighbouring refactor, a rename across the codebase, a fix to an unrelated
module -- is not part of this task, however close it sits.

## Why

Other work runs alongside yours. A change that leaks past its boundary
collides with tasks editing the same code, makes the review harder to read,
and ships behaviour nobody specified or tested. A small, contained change is
one a reviewer can check against its criteria and one that can be reverted
without taking anything else with it.

## In practice

- Edit only what the task's scope covers. If meeting a criterion needs a change
  outside it, stop and say so -- that is a planning gap, not a licence.
- Keep a public contract as it is unless the task is about changing it: callers
  you cannot see depend on it.
- When you notice something wrong outside the boundary, write it down for later
  instead of fixing it now.
- Formatting, renames and tidy-ups follow the same rule: only inside the code
  the task already changes.
