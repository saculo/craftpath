# C-00005 — Work records decisions in DECISIONS.md

## Problem

C-00003 made the work step's task subagents load `never-block-on-the-human`:
when a task does not answer a question about *how*, the subagent decides it
and carries on, and the principle says such a decision is written down where
the user will see it. Today nothing says where that is for the work step. The
brief in `assets/steps/work.md` asks the subagent to put "decisions you made,
anything surprising" under Notes in its task file, mixed with everything
else, and in practice the decisions end up only in the subagent's reply in
the chat -- which is gone once the session ends. The user, and the review
that follows, have no single place listing what work decided on its own.

The record cannot be written by the task subagents themselves: the tasks of a
wave run in parallel, each confined to its own modules, and must not share a
file.

## Scenarios

Each scenario holds on Claude Code and on pi alike.

### S1 — every task subagent reports its own decisions

- **Given** craftpath installed
- **When** the brief the installed `craftpath-work` skill gives each task's
  subagent is read
- **Then** it tells the subagent to end its report with the decisions it made
  on its own -- each with its reason -- or `none` when it made none, before
  the final `DONE` or `STUCK: <reason>` line
- **And** it no longer sends decisions to the task file's Notes; Notes keep
  what else the reviewer should know

### S2 — a task subagent never writes DECISIONS.md

- **Given** craftpath installed
- **When** the brief for a task's subagent is read
- **Then** it tells the subagent not to create or edit `DECISIONS.md`

### S3 — the work step gathers a wave's decisions into DECISIONS.md

- **Given** craftpath installed
- **When** the installed `craftpath-work` skill is read
- **Then** it tells the step, once every subagent of a wave has finished and
  the wave's tasks have been through `complete.py`, to write the decisions
  each subagent reported into `DECISIONS.md` in the work item's folder
  (`.craftpath/work/<work id>/DECISIONS.md`, next to `SPEC.md`), creating it
  when it does not exist
- **And** the decisions are grouped under one heading per task id, holding
  that task's decisions, or `None`
- **And** it covers every task of the wave, done or stuck

### S4 — DECISIONS.md grows across waves

- **Given** craftpath installed
- **When** the installed `craftpath-work` skill is read
- **Then** it tells the step to append each wave's decisions after what
  `DECISIONS.md` already holds -- from earlier waves or an earlier run of the
  step -- and never to rewrite or remove what is there

### S5 — the review step commits DECISIONS.md

- **Given** a work item whose `DECISIONS.md` exists and is not committed, and
  every module's tests pass
- **When** `review.py <work id>` runs
- **Then** it commits `DECISIONS.md` alone as `docs(<work id>): add decisions`,
  as each step commits the file of the step before it
- **And** no other uncommitted file goes into that commit

### S6 — no DECISIONS.md, no commit

- **Given** a work item with no `DECISIONS.md`, or one already committed and
  unchanged
- **When** `review.py <work id>` runs
- **Then** it makes no decisions commit and does not fail because of it

### S7 — only the work step writes DECISIONS.md

- **Given** the craftpath sources
- **When** the step sources in `assets/steps/` and the scripts in
  `assets/scripts/` are read
- **Then** only `work.md` tells anyone to write `DECISIONS.md`, and
  `complete.py` is unchanged by this work item

### S8 — re-running init updates an installed project

- **Given** a project where an earlier craftpath release is installed
- **When** `craftpath init` runs again with this release
- **Then** the installed `craftpath-work` skill and `review.py` carry the
  behaviour above, and no other installed file the user edited is overwritten

## Out of scope

- Who reads `DECISIONS.md` -- the review step, the PR description, a later
  spec: later specs.
- Decisions taken by other steps (spec, plan, design, review): they record
  theirs elsewhere, or later specs say where.
- Changing `complete.py`. A side effect follows: in a project where a module's
  path is the whole project (`.`), the next wave's `complete.py` stages
  everything under it, so `DECISIONS.md` from an earlier wave may go into that
  task's commit instead of the review step's. That is accepted, not fixed here.
- A format check of `DECISIONS.md` (`check.py` or a guard): the step's text
  binds by reading.
- Committing `DECISIONS.md` from `work.py` itself, on a re-run of the work
  step: the next step is review, and review commits it.

## Open questions

None
