# C-00014 — Module check command gates

## Problem

Craftpath modules declare only a test command, so a task can be completed and committed without running the module's linting, typechecking, or other configured checks. Review has the same gap. Maintainers must remember to run this repository's `bun run lint` and `bun run typecheck` separately, leaving quality gates inconsistently enforced.

## Scenarios

### S1 — Complete a task after passing checks

- **Given** a task touches a module whose configured `test` command prints `test passed` and whose `check` command prints `check passed`
- **When** `complete.py C-00014 T-0001` completes the task
- **Then** it prints the test output before the check output, ticks and commits `T-0001`, and does not leave the task open.

### S2 — Keep a task open when its test fails

- **Given** a task touches a module whose configured `test` command prints `test failed` and exits with status 1, and whose `check` command would print `check ran`
- **When** `complete.py C-00014 T-0001` attempts to complete the task
- **Then** it exits unsuccessfully with `test failed`, does not print `check ran`, does not tick or commit `T-0001`, and leaves the task open.

### S3 — Keep a task open when its check fails

- **Given** a task touches a module whose configured `test` command prints `test passed` and whose `check` command prints `check failed` and exits with status 1
- **When** `complete.py C-00014 T-0001` attempts to complete the task
- **Then** it exits unsuccessfully with `check failed`, does not tick or commit `T-0001`, and leaves the task open.

### S4 — Preserve modules without checks

- **Given** a completed task and its module configuration has a passing `test` command but no `check` key
- **When** `complete.py C-00014 T-0001` completes the task
- **Then** it succeeds after the test, ticks and commits `T-0001`, and does not require or report a check command.

### S5 — Review after every configured module check passes

- **Given** all modules have passing test commands and one module's configured `check` command prints `check passed`
- **When** `/craftpath-review C-00014` runs
- **Then** it prints `check passed` after that module's test output and creates or updates `REVIEW.md`, without refusing the review.

### S6 — Refuse review when a module check fails

- **Given** all module test commands pass and one module's configured `check` command prints `check failed` and exits with status 1
- **When** `/craftpath-review C-00014` runs
- **Then** it exits unsuccessfully with `check failed`, does not create or change `REVIEW.md`, and does not commit a review record.

### S7 — Detect JavaScript module checks on fresh initialization

- **Given** a project without `.craftpath/config.toml` has `package.json` scripts `test`, `lint`, and `typecheck`
- **When** `craftpath init` initializes the project
- **Then** the new root module configuration has `test = "bun run test"` and `check = "bun run lint && bun run typecheck"`, and does not omit the check command.

### S8 — Prefer a declared JavaScript check script

- **Given** a project without `.craftpath/config.toml` has `package.json` scripts `test`, `check`, `lint`, and `typecheck`
- **When** `craftpath init` initializes the project
- **Then** the new root module configuration has `check = "bun run check"`, and does not combine `lint` and `typecheck`.

### S9 — Omit an unavailable module check on fresh initialization

- **Given** a project without `.craftpath/config.toml` has a `package.json` test script but no `check`, `lint`, and `typecheck` scripts
- **When** `craftpath init` initializes the project
- **Then** the new root module configuration has its test command and no `check` key.

### S10 — Preserve existing module configuration

- **Given** a project already has `.craftpath/config.toml` with `check = "custom-check"` and `package.json` declares `test`, `lint`, and `typecheck` scripts
- **When** `craftpath init` runs again
- **Then** `.craftpath/config.toml` remains unchanged and does not replace `custom-check`.

## Out of scope

- Detecting checks for non-JavaScript stacks.
- Running tests or checks in parallel.
- Mutation testing.
- Coverage gates.

## Assumptions

- A generated JavaScript check combines `lint` and `typecheck` only when both scripts exist; a lone one is omitted. This follows the requested `&&` combination and the existing JavaScript command-detection convention.
- A configured module check uses the existing module gate order: that module's test runs before its check. This preserves the current per-module test-gate structure while adding the optional command.

## Open questions

None
