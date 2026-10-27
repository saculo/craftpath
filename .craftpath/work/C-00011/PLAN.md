# C-00011 — Task commit subject length limit: plan

## Goal

A task whose commit subject `<type>(<work id>/<task id>): <title>` would pass
72 characters is caught while planning -- by `check.py plan`, and by `task.py`
when the task is added -- so `complete.py` never commits a subject CI's
`pr-standards` job rejects.

## Approach

The length rule lives once, in `assets/scripts/checks.py`, and both callers
use it, so the plan check and `task.py` never disagree on the limit or the
words.

- **T-0001** adds the rule and the plan check's use of it. It is the guard that
  matters on its own: every plan already passes through it before work starts,
  including titles edited by hand in PLAN.md. It also pins down that
  `complete.py` commits a 72-character subject unchanged (S9), which needs no
  code change.
- **T-0002** makes `task.py` take a required, validated `--type` and write it
  into the task file, and moves the plan step's instructions, the template and
  the test fixtures onto it in the same commit -- otherwise the documented
  command and the existing tests would be refused (S7) between tasks.
- **T-0003** makes `task.py` refuse a task whose subject would be too long,
  measuring with the type from T-0002 and the rule from T-0001.

Requiring `--type` (T-0002) and measuring the length at add time (T-0003) were
kept apart: each is observable on its own, and T-0002 leaves a working
`task.py` if T-0003 never lands. Accept and reject of each stay together in
their task.

Waves are serial because `.craftpath/config.toml` has one module, `app`
(`./`), so any two tasks would share it; T-0002 does not depend on T-0001 and
would otherwise run beside it.

## Tasks

### Wave 1

- [ ] T-0001 — Refuse an over-long subject in the plan check

### Wave 2

- [ ] T-0002 — Require a known --type when adding a task

### Wave 3

- [ ] T-0003 — Refuse adding a task whose subject is too long
