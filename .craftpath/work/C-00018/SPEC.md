# C-00018 — Modern search tools rule

## Problem

Agents working in this project (on Claude Code and on pi) search and navigate
with the base tools `grep`, `find` and `cd` by habit, although `rg`, `fd`,
`zoxide` and `ast-grep` are faster, respect `.gitignore` and find code by
structure. Nothing the agents always read tells them to prefer these tools, no
skill carries the guidance (one exists on the unmerged C-00017 branch), and the
README does not tell a user which tools are worth installing. Maintainers and
users of craftpath get no hint.

## Scenarios

### S1 — init installs the modern-cli-tools skill

- **Given** a project not yet initialised, using Claude Code
- **When** the user runs `craftpath init`
- **Then** `.claude/skills/modern-cli-tools/SKILL.md` exists with a
  `modern-cli-tools` name and description, names `rg`, `fd`, `zoxide`,
  `ast-grep` and `sg`, and names the plain fallback (`grep`, `find`, `cd`) for
  when a tool is not installed

### S2 — The same skill reaches pi

- **Given** a project initialised for Claude Code and pi
- **When** the user runs `craftpath init`
- **Then** `.pi/skills/modern-cli-tools/SKILL.md` has exactly the content of the
  Claude Code copy, and no copy is placed under `.craftpath/`

### S3 — Re-running init keeps the skill current

- **Given** an initialised project whose installed skill was edited by hand
  and an earlier packaged version differing from the current one
- **When** the user runs `craftpath init` again
- **Then** an unedited older copy is replaced by the packaged content, while a
  hand-edited copy is kept and the packaged content is written beside it as
  `SKILL.md.new`, as for the other installed skills

### S4 — AGENTS.md carries one general search rule

- **Given** the craftpath repository
- **When** a reader opens `AGENTS.md` at the repository root
- **Then** it contains one general rule saying to load the `modern-cli-tools`
  skill and use it when searching or navigating the project; it names no
  individual tool-by-tool instructions beyond that pointer

### S5 — CLAUDE.md imports AGENTS.md

- **Given** the craftpath repository
- **When** Claude Code loads `CLAUDE.md`
- **Then** `CLAUDE.md` contains a line `@AGENTS.md`, so the rule of S4 reaches
  Claude Code, and its existing content is otherwise unchanged

### S6 — README recommends the four tools

- **Given** the craftpath README
- **When** a reader looks for what to install
- **Then** a section recommends `rg`, `fd`, `zoxide` and `ast-grep`, each with
  a one-line reason, and says they are optional and that craftpath works
  without them

### S7 — Nothing else changes

- **Given** a machine without any of the four tools
- **When** the user runs `craftpath init` and `craftpath doctor`
- **Then** init installs no tool and no step instruction is altered, doctor
  prints no line about the four tools and its exit code is unchanged, and no
  script or guard refuses because a tool is absent

## Out of scope

- Editing any step's instructions to load the skill (no step edits).
- Any change to `craftpath doctor`, including warnings for missing tools.
- Installing the tools themselves, from init or anywhere else.
- Hooks that block or rewrite `grep`, `find` or `cd`.
- Creating or changing `AGENTS.md` / `CLAUDE.md` in a user's project: the rule
  and the import are for this repository only.
- Any tool beyond the four named; configuring them (aliases, zoxide database).

## Assumptions

- "Pull existing changes from C-00017" means the `modern-cli-tools` skill
  (`assets/skills/modern-cli-tools/SKILL.md`), its installed copies for the
  two harnesses, the manifest entries and the init tests for it. The step
  edits and doctor changes on that branch were reverted and are not taken.
- "Nothing installed by init" refers to the tools, and to rules in user
  projects; init keeps installing the skill like the other skills, since the
  rule in `AGENTS.md` points to it and the request asks for the skill.
- `AGENTS.md` does not exist yet at the repository root; it is created with the
  single rule, and `CLAUDE.md` gets `@AGENTS.md` added without other changes.
- The README section lists the tools as recommendations, not requirements,
  because the skill already falls back to the base tools.

## Open questions

None
