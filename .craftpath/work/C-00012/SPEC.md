# C-00012 — Module checks gate tasks

## Problem

Modules can declare only a test command. Consequently, linting, type checking, and other project checks do not prevent a task from completing or a review from starting, even when they fail. Maintainers must remember to run those checks themselves.

## Scenarios

### S1 — Complete a task only after its module check passes

- **Given** task `T-0001` touches module `app`, whose configured `test` command succeeds and whose configured `check` command succeeds
- **When** `complete.py C-00012 T-0001` runs
- **Then** it runs the module test followed by its check, ticks and commits `T-0001`; neither command failure is reported

### S2 — Keep a task open when its test fails

- **Given** task `T-0001` touches module `app`, whose configured test command exits `1` after printing `test failed`, and whose configured check command would print `check ran`
- **When** `complete.py C-00012 T-0001` runs
- **Then** it prints `test failed`, leaves `T-0001` unticked and uncommitted, and does not run the check command

### S3 — Keep a task open when its check fails

- **Given** task `T-0001` touches module `app`, whose configured test command succeeds and whose configured check command exits `1` after printing `check failed`
- **When** `complete.py C-00012 T-0001` runs
- **Then** it prints `check failed`, leaves `T-0001` unticked and uncommitted, and creates no task commit

### S4 — Preserve completion for modules without checks

- **Given** task `T-0001` touches module `app`, whose configured test command succeeds and which has no `check` setting
- **When** `complete.py C-00012 T-0001` runs
- **Then** it ticks and commits `T-0001` after the test succeeds, without refusing because `check` is absent

### S5 — Refuse review when a module check fails

- **Given** every task is complete, every configured module test succeeds, and module `app` has a configured check command that exits `1` after printing `check failed`
- **When** `/craftpath-review C-00012` runs
- **Then** it prints `check failed` and creates or updates no `REVIEW.md` or review commit

### S6 — Preserve review for modules without checks

- **Given** every task is complete and every configured module has a succeeding test command but no `check` setting
- **When** `/craftpath-review C-00012` runs
- **Then** it creates or updates `REVIEW.md` as it does today, without refusing because checks are absent

### S7 — Detect separate JavaScript lint and typecheck scripts for a fresh configuration

- **Given** a project without `.craftpath/config.toml` has a `package.json` with `lint` and `typecheck` scripts but no `check` script
- **When** `craftpath init` creates its configuration
- **Then** the generated module configuration sets `check = "bun run lint && bun run typecheck"`; it does not modify an already-existing configuration

### S8 — Prefer a JavaScript check script for a fresh configuration

- **Given** a project without `.craftpath/config.toml` has a `package.json` with `check`, `lint`, and `typecheck` scripts
- **When** `craftpath init` creates its configuration
- **Then** the generated module configuration sets `check = "bun run check"`, not a command that separately invokes `lint` or `typecheck`

### S9 — Omit an undetected check from a fresh configuration

- **Given** a project without `.craftpath/config.toml` has a `package.json` with none of `lint`, `typecheck`, or `check` scripts
- **When** `craftpath init` creates its configuration
- **Then** its generated module configuration has no `check` key

## Out of scope

- Detecting check commands for non-JavaScript stacks.
- Running module checks in parallel.
- Mutation testing or coverage gates.
- Changing an existing `.craftpath/config.toml` during `craftpath init`.

## Assumptions

- A module check runs in that module's configured directory and stops task completion or review at the first failing command, matching the existing module test runner; this preserves relative-command behavior and its failure boundary.

## Open questions

None
