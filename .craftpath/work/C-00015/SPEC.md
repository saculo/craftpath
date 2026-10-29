# C-00015 — Verify replaces review

## Problem

`/craftpath-review` is one agent writing down whatever it thinks is wrong with
a work item. Its points can be guesses or matters of taste, nothing confirms
any of them before they land in `REVIEW.md`, and every open point blocks
`/craftpath-pr`. So the user has to read every point and sort the real
problems from the noise themselves. That costs them time and makes them trust
the step less.

## Scenarios

### S1 — The step is called verify on both harnesses

- **Given** a project with Claude Code and pi installed by an earlier
  `craftpath init` that put `craftpath-review` into `.claude/skills/` and
  `.pi/skills/`
- **When** the user runs `craftpath init` again
- **Then** `.claude/skills/craftpath-verify/SKILL.md` and
  `.pi/skills/craftpath-verify/SKILL.md` exist, `craftpath-review` is removed
  from both, and no installed step, script, template or the README tells the
  user to run `/craftpath-review` or `/skill:craftpath-review`

### S2 — Verify is refused under the same conditions review was

- **Given** a work item with a task that is not done
- **When** the user runs `/craftpath-verify C-00001`
- **Then** the guard refuses it and names the task, exactly as the review
  guard did. The same holds for a ticked task with no commit carrying its id
  and for uncommitted changes outside the work item. A refused verify creates
  no `VERIFY.md`

### S3 — Tests and checks run before anything is verified

- **Given** a work item whose tasks are all done and committed, and a module
  whose `test` or `check` command fails
- **When** the verify script runs
- **Then** it exits 1 with the failing command's output, and creates or changes
  no `VERIFY.md` and makes no commit

### S4 — VERIFY.md is bound to the commit verified

- **Given** a work item whose tests and checks are green, with no `VERIFY.md`
- **When** the verify script runs
- **Then** it creates `.craftpath/work/C-00001/VERIFY.md` with
  `- **Verified at:** <HEAD sha>`, prints the commit range, its commits and
  files, the open points and the next free point id, and creates no
  `REVIEW.md`

### S5 — A re-run keeps every point and moves the commit

- **Given** a `VERIFY.md` with points `F1` open and `F2` solved, verified at an
  older commit, and a newer commit on the branch
- **When** the verify script runs again
- **Then** `F1` and `F2` are still there, unchanged and in order,
  `Verified at` names the new HEAD, `F1` is listed as open and the next point
  id is `F3`

### S6 — A point without a concrete failure scenario does not pass the check

- **Given** a `VERIFY.md` with an open point that names a `file:line` and what
  is wrong but no input or state that makes it go wrong, and another point
  with no `file:line`
- **When** the user runs `check.py verify C-00001`
- **Then** it reports both points by id as missing their failure scenario or
  location. A point written as
  `- [ ] F1 [major] src/a.ts:12 -- given an empty list, total() returns NaN instead of 0`
  passes, and so does `None` under Points

### S7 — The step finds with one agent and refutes with a second one

- **Given** a project where `craftpath init` has installed the verify step
- **When** the user reads the installed `craftpath-verify` step, on Claude
  Code or on pi
- **Then** it tells the step to start one finder agent that reads `SPEC.md`,
  `PLAN.md`, the task files and the diff of the printed range, and proposes
  findings each stating input or state, what goes wrong, and `file:line`;
  then to start a second agent in a fresh context, given only the proposed
  findings and the worktree, that tries to refute each one by reading the
  code and, where it can, running it or writing a throwaway test that it
  deletes afterwards. It does not tell the finder to read `DECISIONS.md`

### S8 — Only confirmed findings reach VERIFY.md

- **Given** the installed `craftpath-verify` step
- **When** the user reads what it says to write into `VERIFY.md`
- **Then** only findings the second agent could not refute are added as new
  points; a finding without a failure scenario and a refuted finding are
  written nowhere -- not in `VERIFY.md`, not in another file; and style,
  naming and formatting are never findings

### S9 — Both agents run on verify's configured model

- **Given** a `config.toml` with `[steps.work.claude-code] model = "sonnet"`
  and `[steps.verify.claude-code] model = "opus"`, `effort = "high"`, and the
  same split under `[steps.work.pi]` and `[steps.verify.pi]`
- **When** the user runs `craftpath init`
- **Then** the installed verify step, on each harness, starts both the finder
  and the refuter with verify's model and effort (`opus`, `high`), never with
  work's

### S10 — Without a verify setting both agents run on the session model

- **Given** a `config.toml` that sets `[steps.work.claude-code]` and
  `[steps.work.pi]` but no `[steps.verify.*]`
- **When** the user runs `craftpath init`
- **Then** the installed verify step names no model or effort for the finder
  and the refuter, on either harness, so both run on the session's model --
  not on work's

### S11 — PR and learn follow the rename

- **Given** a work item whose `VERIFY.md` has an open point
- **When** the user runs `/craftpath-pr C-00001` or `/craftpath-learn C-00001`
- **Then** the guard refuses it, naming the open point and telling the user to
  run `/craftpath-verify C-00001`. With no open point and code committed after
  `Verified at`, the pr guard refuses and tells the user to verify again; with
  none of that, pr commits `VERIFY.md` and builds the pull request body with a
  `Verify` section listing its points

## Out of scope

- Triage categories for findings and an automatic fix loop -- spec 14.
- Giving the finder or the refuter `DECISIONS.md` to read.
- Several finder agents or review lenses run side by side.
- A benchmark or measurement of how accurate verify is.
- Keeping `/craftpath-review` as an alias or running it beside verify.
- Migrating an existing `REVIEW.md` in a work item already under way to
  `VERIFY.md`, or reading `[steps.review.*]` settings.
- A `/craftpath-review-fix` rename: no such step exists in this project.

## Assumptions

- **Points keep review's lifecycle.** Open `[ ]`, solved `[x]` with
  `(solved in <sha>)`, won't fix `[-]` with a reason, never deleted or
  renumbered, re-checked on every run, and an open point blocks pr and learn.
  The request changes how findings are produced, not how they are tracked.
- **Point ids are `F<n>` and keep `[major|minor]`.** `F` for finding, so a
  verify point is not mistaken for a review point; severity stays because the
  request leaves it alone and triage categories are spec 14's.
- **The failure scenario lives in the point's text** after `--`, as `given
  <input or state>, <what goes wrong>`, so `check.py` can tell a point that
  states one from one that does not, and the pr body carries it unchanged.
- **Verify still commits an uncommitted `DECISIONS.md`** before it starts, as
  review did, so learn and pr still find it; it just does not give it to the
  agents.
- **An old `[steps.review.*]` table is ignored, not migrated.** `config.toml`
  is the user's and `init` never rewrites it; the fresh config.toml example
  and the README show `[steps.verify.*]` instead.
- **A work item already under way with only a `REVIEW.md` must run verify.**
  The pr and learn guards read `VERIFY.md` only; the user runs
  `/craftpath-verify` once and gets a fresh `VERIFY.md`.
- **The commit that records VERIFY.md** is named `docs(<id>): add verify`,
  following review's `docs(<id>): add review`.
- **This project's own `CLAUDE.md` follows the rename** too: its line listing
  the flow names `/craftpath-verify`, since craftpath develops itself with it.

## Open questions

None
