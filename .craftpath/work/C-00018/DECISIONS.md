## T-0001 — Ship the modern-cli-tools skill

None

## T-0002 — Add AGENTS.md search rule, import it in CLAUDE.md

- A2 compares `CLAUDE.md` with `git show master:CLAUDE.md`, with the `@AGENTS.md` line removed from both and blank-line runs collapsed -- this keeps the test valid after merge and the import line can sit as its own paragraph.
- `@AGENTS.md` goes after the first block and before the `---` separator -- the spot the task's Notes suggested.
- `AGENTS.md` has a small heading, "Searching and navigating", above the single rule -- it gives the file a title and adds no tool-by-tool guidance.

## T-0003 — Recommend the four tools in the README

- Made it a `###` subsection under `## Install` instead of a new `##` -- the task said "under or right after `## Install`", and the tools are part of what to install.
- The new test checks structure, not wording: each tool has a line with a non-trivial reason, plus the words "optional" and "works without" -- it would pass for any phrasing with those words.

## T-0004 — Guard that init and doctor ignore the tools

- A3 lives in `test/init/init.test.ts` and spawns `guard.py` directly, not through the kit `guard` helper -- the helper cannot pass an env, and the `process.env.PATH` route was shown not to reach the child process.
- The `barePath()` helper and the `SEARCH_TOOLS` regex are duplicated in both test files -- only those two files are in Touches, so there is no shared module to put them in.
- A1 proves "no other file written" by comparing the installed file list under the bare PATH with the list under the normal PATH -- this checks behaviour without hardcoding the packaged file list.

## T-0005 — Share barePath and SEARCH_TOOLS between guard tests

None

## T-0006 — A3 guard test proves the guard allows the command

- Delete the planned item's `PLAN.md` to trigger the refusal in A2 -- it is the simplest way to make work.py's guard refuse, and the guard's own message says "There is no PLAN.md yet".
- Put `runGuard` and the `WORK` command constant inside the `describe` block -- the task asked for a small local function, and nothing else uses them.

## T-0007 — CLAUDE.md check does not depend on a master branch

- Test the check through an in-file helper called against scratch directories, rather than copying the test file into a scratch dir and running `bun test` there -- the test file imports `../src/cli` and the README, so it can't run in isolation, and Touches allows no other file.
- Emit a first-differing-line message instead of a full diff -- it is enough to say what changed, with no new dependency.
- Strip the `@AGENTS.md` line and collapse 3+ blank lines in both the fixture and CLAUDE.md before comparing -- this reuses the old `without` normalisation, so the fixture stays exactly master's text.
