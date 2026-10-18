# C-00007 — Test behaviour principle

## Problem

The current `testing` skill is long and stack-specific, and workflow steps load it
only when a plan explicitly names it. Engineers can therefore write tests without
the testing guidance that makes those tests meaningful.

## Scenarios

### S1 — Install the behaviour-testing principle

- **Given** a repository initialized from the craftpath assets
- **When** the initializer installs its skills for Claude Code and pi
- **Then** each harness has a `test-behaviour-not-implementation` principle skill
  whose guidance requires tests to exercise real boundaries, mock only systems
  the project does not own, make one observable behaviour claim per test, name
  the test after that behaviour, and run independently of test order.

### S2 — Load the principle while specifying work

- **Given** an initialized repository and a user invoking the spec workflow
- **When** the workflow gives the spec agent its instructions
- **Then** those instructions load the `test-behaviour-not-implementation`
  principle so its scenarios describe observable behaviour rather than
  implementation details.

### S3 — Load the principle while implementing work

- **Given** a planned task in an initialized repository
- **When** the work workflow gives its implementation subagent the task brief
- **Then** the brief loads the `test-behaviour-not-implementation` principle
  before the subagent writes its test-first implementation.

### S4 — Load the principle while reviewing work

- **Given** an initialized repository and a user invoking the review workflow
- **When** the workflow gives the review agent its instructions
- **Then** those instructions load the `test-behaviour-not-implementation`
  principle when assessing the tests that prove the work.

### S5 — Retire the testing skill

- **Given** a repository initialized from the updated craftpath assets
- **When** the initializer installs workflow skills and the plan workflow is
  rendered
- **Then** neither harness contains the `testing` skill and the plan instructions
  do not name `testing` as a skill for implementers.

## Out of scope

- Changing the backend, frontend, or infrastructure skills.
- Moving the behaviour-testing craft into `CLAUDE.md` or `AGENTS.md`.
- Changing the test-first requirement or its scope.

## Assumptions

- The principle is named `test-behaviour-not-implementation`, following the
  requested phrase in a filesystem-safe skill name, so steps can load the same
  named skill on both harnesses.
- The implementation changes `assets/` and regenerates installed copies with the
  initializer, because repository guidance identifies `assets/` as the source of
  installed skills and steps.

## Open questions

None
