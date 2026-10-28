# C-00013 — Review open points become tasks: plan

## Goal

`/craftpath-review-fix <id>` (and `/skill:craftpath-review-fix` on pi) turns every
open review point into open `fix` tasks appended to a finished plan -- each
carrying `Fixes: R<n>` and test-proven criteria -- without touching ticked
tasks or `REVIEW.md`, so `/craftpath-work <id> all` fixes them test-first.

## Approach

Data shapes first: the new task-file field `- **Fixes:** R1, R3`, and a "new
task" defined as one absent from `PLAN.md` at HEAD (T-0003). The parts are
built in the order the step runs them: the guard (T-0001), the script that
commits `REVIEW.md` and prints where fix tasks go (T-0002), the deterministic
`check.py review-fix` in three slices -- coverage of open points (T-0003),
finished work untouched (T-0004), new tasks after the plan and open (T-0005) --
and last the step file and README that wire them together (T-0006), so no
installed step ever calls a missing script or check.

This repository has one module (`app`, the whole tree), so every task touches
it and each sits in its own wave; T-0002 and T-0003 do not depend on earlier
tasks, but cannot share a wave. The check was split in three to keep each task
at five criteria or fewer.

Decisions (overturn any in one edit): the script, not the agent, commits
`REVIEW.md` as `docs(<id>): add review`, so the check can prove it unchanged
against HEAD (T-0002); a point may be named by more than one fix task (T-0003);
`review.md`'s closing report is left as it is (T-0006). S8 is already
`work.py`'s behaviour, so its test is a regression guard proven able to fail by
breaking work.py's open-task filter (T-0002 Notes).

## Tasks

### Wave 1

- [x] T-0001 — Refuse review-fix until a point can be fixed

### Wave 2

- [ ] T-0002 — List open review points for fix tasks

### Wave 3

- [ ] T-0003 — Check fix tasks cover every open point

### Wave 4

- [ ] T-0004 — Check fix tasks leave finished work untouched

### Wave 5

- [ ] T-0005 — Check fix tasks follow the finished plan

### Wave 6

- [ ] T-0006 — Install the review-fix step on both harnesses
