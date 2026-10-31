## T-0001 — Ship the modern-cli-tools skill

None

## T-0002 — Add AGENTS.md search rule, import it in CLAUDE.md

- A2 compares `CLAUDE.md` with `git show master:CLAUDE.md`, with the `@AGENTS.md` line removed from both and blank-line runs collapsed -- this keeps the test valid after merge and the import line can sit as its own paragraph.
- `@AGENTS.md` goes after the first block and before the `---` separator -- the spot the task's Notes suggested.
- `AGENTS.md` has a small heading, "Searching and navigating", above the single rule -- it gives the file a title and adds no tool-by-tool guidance.
