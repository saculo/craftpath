# C-00010 — Engineering principles replace discipline skills

## Problem

`init` installs three discipline skills -- `backend`, `frontend` and
`infrastructure` -- that hold broad, per-stack advice. They reach an
implementer only when the plan step picks one and names it in a task's Notes
("Name what the implementer needs in the task's Notes ... `backend`, `frontend`
or `infrastructure`"), and the work step's subagent brief loads "the engineering
skills its Notes name". So the advice depends on a planner's per-task guess, a
task that crosses stacks gets none or all of it, and the reasoning that matters
on every task -- fix the cause, keep the change small, settle data shapes
first, cut work into verifiable units -- is buried inside stack advice instead
of being loaded by the steps that need it. Every craftpath user, on Claude Code
and on pi, plans and implements with this gap.

## Scenarios

### S1 — init installs the five engineering principles

- **Given** a project with no craftpath installed
- **When** the user runs `craftpath init --harness claude-code,pi`
- **Then** both `.claude/skills/` and `.pi/skills/` hold `fix-root-causes`,
  `boundary-discipline`, `laziness-protocol`, `foundational-thinking` and
  `sequence-verifiable-units`, each a `SKILL.md` whose `name` is its folder name
- **And** each states its principle in craftpath's own words: `fix-root-causes`
  that a fix addresses the cause and not the symptom; `boundary-discipline` that
  a change stays inside the boundary its task owns; `laziness-protocol` the
  smallest change that meets the criteria, preferring deletion to addition;
  `foundational-thinking` that data shapes are settled first and the scaffold
  is built before the detail; `sequence-verifiable-units` that work is ordered
  as units each verifiable on its own
- **And** no installed principle contains an unrendered `{{` placeholder

### S2 — The work step's implementer loads its four principles

- **Given** a project initialised with `--harness claude-code,pi`
- **When** the user reads the installed `craftpath-work` step on either harness
- **Then** the brief each task's subagent receives tells it to load
  `fix-root-causes`, `boundary-discipline`, `laziness-protocol` and
  `foundational-thinking`, alongside `never-block-on-the-human`, `test-first`
  and `test-behaviour-not-implementation`
- **And** the brief no longer tells it to load "the engineering skills its
  Notes name", and does not load `sequence-verifiable-units`

### S3 — The review step loads its two principles

- **Given** a project initialised with `--harness claude-code,pi`
- **When** the user reads the installed `craftpath-review` step on either harness
- **Then** it tells the reviewer to load `fix-root-causes` and
  `laziness-protocol`, alongside the skills it loads today
- **And** it does not load `boundary-discipline`, `foundational-thinking` or
  `sequence-verifiable-units`

### S4 — The plan step loads its two principles and names no skills in Notes

- **Given** a project initialised with `--harness claude-code,pi`
- **When** the user reads the installed `craftpath-plan` step on either harness
- **Then** it tells the planner to load `foundational-thinking` and
  `sequence-verifiable-units`, alongside the skills it loads today
- **And** it no longer tells the planner to name skills in a task's Notes --
  the "Skills for the implementer" guidance is gone
- **And** it does not load `fix-root-causes`, `boundary-discipline` or
  `laziness-protocol`

### S5 — A fresh install ships no discipline skills, but keeps ux and architecture

- **Given** a project with no craftpath installed
- **When** the user runs `craftpath init --harness claude-code,pi`
- **Then** neither harness has a `backend`, `frontend` or `infrastructure`
  skill folder
- **And** both harnesses still have the `ux` and `architecture` skills

### S6 — Re-running init retires the unedited discipline skills

- **Given** a project initialised by an earlier craftpath that installed
  `backend`, `frontend` and `infrastructure` on both harnesses, none edited
  since
- **When** the user runs `craftpath init` again with this version
- **Then** all six `SKILL.md` files are removed, `init` reports
  `removed   <path>` for each, and `.craftpath/manifest.json` no longer lists them
- **And** no other skill is removed

### S7 — Re-running init keeps an edited discipline skill

- **Given** the same earlier project, where the user has edited
  `.claude/skills/backend/SKILL.md` after it was installed
- **When** the user runs `craftpath init` again with this version
- **Then** that file is left exactly as the user wrote it and `init` reports
  `kept      .claude/skills/backend/SKILL.md (edited)`
- **And** the unedited `frontend` and `infrastructure` skills are still removed

### S8 — Nothing installed points at a removed skill

- **Given** a project initialised with `--harness claude-code,pi`
- **When** the user searches every installed step and skill
- **Then** none names `backend`, `frontend` or `infrastructure` as a skill to
  load or defer to -- including the `test-first`, `ux` and `architecture`
  skills, which name them today

## Out of scope

- The `testing` skill and the `test-behaviour-not-implementation` principle:
  a separate spec covers them; this work changes neither.
- The content of `ux` and `architecture` beyond dropping their references to
  the removed skills (S8); they stay as design-step skills.
- Per-stack or per-language advice of any kind -- no replacement for what
  `backend`, `frontend` or `infrastructure` said about APIs, components or
  deploys.
- Copying pstack's text: its ideas are rewritten, not imported.
- The spec, design, pr, learn and learn-apply steps: none of them loads a new
  principle.
- The `## Notes` section of the task template: it stays for what the
  implementer needs that is not in the code; only the instruction to name
  skills there goes.
- Editing tasks already planned in existing work items whose Notes name a
  removed skill.

## Assumptions

- The five skills are named `fix-root-causes`, `boundary-discipline`,
  `laziness-protocol`, `foundational-thinking` and `sequence-verifiable-units`:
  kebab-case close to the request's own words, matching `test-first` and
  `test-behaviour-not-implementation`. Shorter names (`root-causes`,
  `smallest-change`) were possible; the request's wording is easier to trace.
- "Loaded by work" means the brief of each task's subagent, not the
  orchestrating session: the subagent is the one writing code, and it is where
  the brief already loads `test-first` and the other principles today.
- Retirement works exactly as it does for the retired `testing` skill: an
  unedited managed file (its hash matches the manifest) is removed, an edited
  one is kept and reported. Same rule, same reason -- a user's edit must
  survive an update.
- The skills are installed on both harnesses, like every other skill `init`
  ships, since craftpath supports Claude Code and pi from one asset set.
- This repository's own `CLAUDE.md`, which says detail lives in the `backend`,
  `frontend` and `infrastructure` skills, is updated to point at the principles
  instead. `init` does not install that file, so no scenario covers it, but
  leaving it would send craftpath's own contributors to skills that no longer
  exist.

## Open questions

None
