# C-00009 — PR body lists work decisions: plan

## Goal

When `/craftpath-pr` opens a pull request for a work item that has a
`DECISIONS.md`, the body carries those decisions in a `## Decisions` section
directly after `## Tasks`, task headings nested at `###`; without the file the
body is exactly what it is today.

## Approach

One task. The whole change is one function in `assets/scripts/pr.py`
(`body()`) and its tests in `test/steps/pr.test.ts`, and S1 and S2 are the
accept and absent halves of the same behaviour -- splitting them would ship a
`pr.py` that crashes or emits an empty section when the file is missing. The
repo has a single `app` module, so there is nothing to parallelise anyway. The
step text `assets/steps/pr.md` is left unchanged (see T-0001's Notes).

## Tasks

### Wave 1

- [ ] T-0001 — Carry DECISIONS.md into the pull request body
