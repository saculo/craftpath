# C-00001 — Model and effort per step

## Problem

On Claude Code every craftpath step -- and every task subagent `work` starts --
runs on the model and effort of the user's session. A user who wants a cheaper
model writing code and a stronger one reviewing it (say Sonnet for `work`'s
task subagents, Opus for `review`) has no way to say so: the installed steps
under `.claude/skills/craftpath-<step>/SKILL.md` carry no model or effort, and
editing those installed copies by hand is overwritten -- or parked as `.new` --
on the next `craftpath init`. `.craftpath/config.toml`, the one file the user
already edits, has no place for it.

## Scenarios

### S1 — A configured step runs with its model and effort

- **Given** a project installed for Claude Code whose `.craftpath/config.toml`
  sets model `opus` and effort `high` for the `review` step under Claude Code
- **When** the user runs `craftpath init`
- **Then** the installed `/craftpath-review` step runs with model `opus` and
  effort `high`, and every other installed step is byte-for-byte what `init`
  writes without the setting

### S2 — work's setting applies to its task subagents, not to work itself

- **Given** `.craftpath/config.toml` sets model `sonnet` and effort `medium`
  for the `work` step under Claude Code
- **When** the user runs `craftpath init`
- **Then** the installed `/craftpath-work` step starts each task's subagent
  with model `sonnet` and effort `medium`, and the `/craftpath-work` step
  itself carries no model or effort -- it still runs on the user's session
  model

### S3 — A step with no setting runs as today

- **Given** `.craftpath/config.toml` sets nothing for any step -- an existing
  config.toml from an earlier release, unchanged
- **When** the user runs `craftpath init`
- **Then** every installed step, `work` included, is identical to what this
  release writes today, and `init` reports no step as updated on account of
  the config

### S4 — Only what is set is applied

- **Given** `.craftpath/config.toml` sets model `opus` and no effort for the
  `review` step under Claude Code
- **When** the user runs `craftpath init`
- **Then** the installed `/craftpath-review` step runs with model `opus` and
  carries no effort, so the effort is the session's as today

### S5 — A change takes effect only after re-running init

- **Given** a project installed with no step settings, and the user then adds
  model `opus` for `review` to `.craftpath/config.toml`
- **When** the user re-runs `craftpath init`
- **Then** the installed `/craftpath-review` step is updated to run with model
  `opus`, and `.craftpath/config.toml` is byte-for-byte what the user wrote --
  `init` does not rewrite, reformat or add to an existing config.toml; before
  the re-run the installed step is unchanged

### S6 — A fresh config.toml shows the example, commented out

- **Given** a project with no `.craftpath/config.toml`
- **When** the user runs `craftpath init`
- **Then** the config.toml it writes contains, as commented-out lines, the
  setting for `work` with model `sonnet` and for `review` with model `opus`
  under Claude Code, and the steps `init` installs in the same run are
  identical to those of S3 -- the example applies nothing until uncommented

### S7 — A Claude Code setting does not touch pi

- **Given** a project installed for both Claude Code and pi, whose
  `.craftpath/config.toml` sets model `opus` for `review` under Claude Code
- **When** the user runs `craftpath init`
- **Then** the Claude Code `/craftpath-review` step runs with model `opus`,
  and every installed pi step (`.pi/skills/craftpath-<step>/SKILL.md`) is
  identical to what `init` writes without the setting

## Out of scope

- pi: no model or effort per step there, even if config.toml names it.
- Settings per task, or per wave -- one setting per step only.
- A warning when `review` and `work` (its task subagents) share a model.
- Applying a change without re-running `craftpath init`.
- Migrating an existing config.toml: `init` never adds the commented example to
  a config.toml that already exists.
- Validating settings `init` cannot apply (an unknown step name, an effort
  outside Claude Code's values, a malformed config.toml): no behavior is
  promised; the plan picks whatever is simplest.

## Open questions

None.
