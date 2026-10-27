# C-00012 — Module checks gate tasks: plan

## Goal

Configured module checks run after module tests and before a task can complete
or a review can start. Fresh JavaScript configurations detect an available
check command without changing existing configurations.

## Approach

First extend the shared module command runner and prove task-completion gating,
including the no-check compatibility path. Review then uses that proven runner
and gets its own refusal coverage. Finally, add fresh-configuration detection.
The repository has one `app` module, so all three tasks are serial waves even
though detection has no behavioural dependency on the first two: same-wave
tasks may not share a module. The installed Python copies and manifest follow
the changed assets by re-running `bun bin/craftpath.ts init`; they are not
edited directly.

## Tasks

### Wave 1

- [x] T-0001 — Gate task completion with module checks

### Wave 2

- [ ] T-0002 — Gate reviews with module checks

### Wave 3

- [ ] T-0003 — Detect JavaScript module checks
