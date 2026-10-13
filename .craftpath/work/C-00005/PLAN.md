# C-00005 — Work records decisions in DECISIONS.md: plan

## Goal

Each task subagent ends its report with the decisions it made on its own; the
work step, after each wave, appends them to `.craftpath/work/<work id>/DECISIONS.md`
under one heading per task; and `review.py` commits that file alone as
`docs(<work id>): add decisions` -- on Claude Code and pi alike, and on re-init.

## Approach

Three tasks, one observable behaviour each, split along who acts on decisions:

- **T-0001** changes the brief: the subagent reports its decisions (with
  reasons, or `none`) before `DONE`/`STUCK`, keeps them out of Notes, and is
  told not to touch `DECISIONS.md`. It also fixes `work.md` as the only step
  naming the file (S7's step half). On its own it leaves the system working:
  decisions land in the chat, structured, as they do today unstructured.
- **T-0002** adds the gathering sub-step to `work.md`: after the wave's
  `complete.py` runs, write every task's decisions (done or stuck) to
  `DECISIONS.md`, appending, never rewriting. Kept apart from T-0001 because it
  is the step's own behaviour, not the subagent's, and it consumes the report
  format T-0001 decides.
- **T-0003** makes `review.py` commit `DECISIONS.md` alone through the existing
  `commit_files`, after the tests pass; it also carries S7's script half and
  S8's re-init test, which needs both `work.md` and `review.py` changed. Without
  it, an uncommitted `DECISIONS.md` sits inside the work item's folder, which
  the review guard already lets through.

The repo has one module (`app`, path `./`), so no two tasks can share a wave:
the three waves are forced by the module rule. Only T-0002 truly needs T-0001
(the report format), and T-0003's re-init test needs T-0002. Most criteria
check the installed step's text, since a step binds by reading; the paragraph-
and phrase-level checks are pinned in each criterion so the tests can fail
today. Tests that guard behaviour already present (T-0003 A3, A4, and A6's
"kept" half) may pass first; their Notes ask to show each can fail.

## Tasks

### Wave 1

- [x] T-0001 — Task subagents report their decisions instead of writing them

### Wave 2

- [ ] T-0002 — Work gathers each wave's decisions into DECISIONS.md

### Wave 3

- [ ] T-0003 — Review commits DECISIONS.md as the decisions
