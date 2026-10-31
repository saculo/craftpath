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
