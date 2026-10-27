# C-00010 — Decisions

## T-0001 — Ship the five engineering principles as skills

- Appended the new `describe` block at the end of `test/init/init.test.ts` -- that is where it disturbs the existing blocks least, and the task gives no position.
- One table of name to required statements drives all four tests -- it keeps each criterion's check identical across the five skills and both harnesses.
- A4's "no `craftpath-<name>` folder" check uses `dirExists` and runs on both harnesses -- it is a directory, and `Bun.file().exists()` does not report directories.
- In `fix-root-causes`, the advice for a cause outside the task's reach is a stated stopgap plus a written note -- this keeps it in line with `boundary-discipline` instead of encouraging a fix outside the task.

## T-0002 — Work brief loads the implementer's principles

- The brief says "load the" again before each principle, instead of one "load the `a` skill, the `b` skill…" list -- A1 asks for the literal phrase ``load the `<name>` skill`` for each name, and a single list failed it.
- The principles are loaded after `never-block-on-the-human` and before `test-first`/`test-behaviour-not-implementation` -- this keeps the exact test-first wording an existing test checks, and that sentence still ends the instruction.
- The new tests sit in the existing `the engineering principles` describe block and reuse its `installed()` and `words` helpers -- that block already covers these skills, so no new setup was needed.

## T-0003 — Review step loads the review principles

- Added the two optional *How to review* bullets (Root causes, Smallest change) -- the task's Notes welcomed them, and they tell the reviewer what each principle asks it to look for, not just to load it.
- Put the new tests inside the existing `describe("the engineering principles")` block, reusing its `installed`/`words`/`DIRS` helpers -- that block already holds the matching tests for the work step, so the review tests sit next to them.
- Worded the load lines "before you do anything else", like the existing never-block and test-first lines -- both principles shape the whole review, not one part of it.
