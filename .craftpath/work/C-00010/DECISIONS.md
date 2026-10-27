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

## T-0004 — Plan step loads the planning principles instead of naming skills

- One "Load the `<name>` skill before you do anything else." line per new principle, rather than one combined sentence -- this follows the plan step's existing lines and the review step's pattern, and the A1 test looks for that exact wording.
- Checked that A3 can fail by adding a principle to the plan step for one run, since a test that only forbids text passes before any change -- the test-first skill requires seeing a test fail before trusting it.

## T-0005 — Drop every pointer to the discipline skills

- Put the A1 and A2 tests in the existing `the engineering principles` describe block -- it already has an `installed()` helper for a `claude-code,pi` install, and these tests belong to the same work item.
- `test-first` gives each principle a one-line gloss on how it bears on tests, and the line about who owns the tests became a short paragraph -- the old bullets explained what each skill was for, so a bare list of names would have lost that.
- `sequence-verifiable-units` is left out of `test-first` but named in `CLAUDE.md` -- `test-first` lists what the implementer loads, which does not include the plan step's sequencing principle, while A3 requires all five in `CLAUDE.md`.
- `ux` and `architecture` say "the task that builds it — the work step's implementer" with em dashes -- that is the wording the Notes suggest, and both files already use em dashes rather than `--`.
