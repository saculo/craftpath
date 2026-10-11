# C-00001 — Model and effort per step: plan

## Goal

A user sets `model` and `effort` per step for Claude Code in
`.craftpath/config.toml`; after `craftpath init` the installed step runs with
them -- except `work`, whose setting goes to the subagent it starts per task --
while an unset step, and every pi step, is installed exactly as today.

## Approach

Three tasks, one observable behaviour each:

- **T-0001** introduces the config shape (`[steps.<step>.claude-code]`, keys
  `model` and `effort`, both optional) and turns it into front matter on every
  Claude Code step except `work`. It carries the "unset means unchanged", "only
  what is set" and "pi untouched" criteria, because those guard the same
  rendering path it adds.
- **T-0002** makes `work`'s setting reach its task subagents through a new
  `{{SUBAGENT}}` token in `assets/steps/work.md`, which renders to nothing when
  unset. Kept apart from T-0001 because it is a different mechanism (wording of
  the Agent call, not front matter) and T-0001 is complete without it: until
  T-0002 lands, a work setting is simply ignored, never misapplied.
- **T-0003** writes the commented-out example into a fresh config.toml and
  documents the table in the README.

The repo has a single module (`app`), so no two tasks can share a wave: the
three waves are forced by the module rule, not by order. Only T-0002 and T-0003
truly need T-0001 (its config reader and shape). Settings that cannot be
applied (unknown step, odd effort, unparseable TOML) are ignored, as the spec
leaves them open.

## Tasks

### Wave 1

- [x] T-0001 — Apply a step's configured settings to its Claude Code skill

### Wave 2

- [x] T-0002 — Pass work's configured settings to its task subagents

### Wave 3

- [x] T-0003 — Show the step settings commented out in a fresh config.toml
