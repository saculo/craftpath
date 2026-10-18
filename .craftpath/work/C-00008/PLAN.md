# C-00008 — Review and learn read decisions: plan

## Goal

`review.py` and `learn.py` print the path of `DECISIONS.md` when it exists, and
the installed review and learn steps tell the agent to read it: the reviewer may
raise any recorded decision as an ordinary point, and learn may propose a
recorded decision or a spec assumption as an `[ADR]` candidate. Without
`DECISIONS.md`, both steps behave exactly as today.

## Approach

Four tasks, one per surface: the review script (S1, S2), the review step text
(S3), the learn script (S4, S5), the learn step text (S6). Script and step text
are split because each proves different scenarios at a different level -- a
subprocess run versus the installed skill on both harnesses -- and each leaves
the branch working on its own: a script that prints the path without the step
naming it, or a step that names the file without the script printing it, are
both coherent. The repo has one `app` module, so every task is its own wave and
they run in order; none depends on another's result. T-0002 and T-0004 both
widen the same invariant test in `test/steps/work.test.ts` (which steps may name
`DECISIONS.md`); the one that runs second adds its step to the list, as their
Notes say.

## Tasks

### Wave 1

- [x] T-0001 — List DECISIONS.md among what review prints

### Wave 2

- [x] T-0002 — Have the reviewer check recorded decisions

### Wave 3

- [x] T-0003 — List DECISIONS.md among learn's sources

### Wave 4

- [ ] T-0004 — Point learn at decisions as knowledge sources
