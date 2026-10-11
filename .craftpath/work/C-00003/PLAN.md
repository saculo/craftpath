# C-00003 — Steps decide instead of asking: plan

## Goal

`craftpath init` installs a `never-block-on-the-human` skill on Claude Code and
pi -- a principle, not a step -- that says to ask the user only about *what*
gets built and to decide and record every *how*; the spec, plan and review
steps load it before their work, and work's brief has each task's subagent
load it, while the other steps do not.

## Approach

Two tasks, each one observable behaviour:

- **T-0001** ships the principle as `assets/skills/never-block-on-the-human/SKILL.md`.
  `init` already installs every skill under `assets/skills/` on each harness, so
  this is an asset plus the tests proving it installs as a model-loaded skill
  (not a step) with the content S3 requires. On its own it changes nothing a
  step does -- the skill is available but unnamed -- so the codebase is whole if
  T-0002 never lands.
- **T-0002** makes the four deciding steps name it with one sentence,
  ``Load the `never-block-on-the-human` skill``, and proves the pattern later
  principles follow (S7) and the re-run update (S8). spec/plan/review and work's
  brief are kept in one task: they are the same one-sentence change, S8 needs
  all four updated, and splitting would leave a branch where only some deciding
  steps load the principle.

The repo has one module (`app`), so the two tasks cannot share a wave; T-0002
also genuinely depends on T-0001, since its S7 test requires the skill's source
to exist. No `src/` change is expected in either task. The repo's own installed
copies under `.claude/` and `.pi/` are not refreshed by this work.

## Tasks



### Wave 1

- [x] T-0001 — Install the never-block-on-the-human principle

### Wave 2

- [x] T-0002 — Deciding steps load the principle
