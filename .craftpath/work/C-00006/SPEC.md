# C-00006 — Test-first as a principle skill

## Problem

Test-first is the only guidance craftpath installs as a rule. `init` copies
`assets/rules/tdd.md` to `.claude/rules/tdd.md` on Claude Code and wraps it as a
`tdd` skill on pi, and every step and engineering skill that mentions it goes
through a `{{RULE:tdd.md}}` token that renders a different path per harness.
Everything else craftpath ships -- `never-block-on-the-human`, `backend`,
`testing` and the rest -- is a skill. So someone reading or extending craftpath
meets two forms of guidance and a harness-specific special case for one of them,
and the same discipline is named three ways: "the tdd rule", the pi `tdd` skill,
and the "watch it fail, then pass" check the engineering skills each restate.

## Scenarios

### S1 — init installs the test-first principle on both harnesses

- **Given** an empty project
- **When** `craftpath init --harness claude-code,pi` runs
- **Then** `.claude/skills/test-first/SKILL.md` and `.pi/skills/test-first/SKILL.md`
  exist, each with `name: test-first` in its front matter
- **And** neither is a step: there is no `.claude/skills/craftpath-test-first`
  and no `.pi/skills/craftpath-test-first`

### S2 — the principle holds the rule and the prove-it-works check

- **Given** a project initialised with `--harness claude-code`
- **When** `.claude/skills/test-first/SKILL.md` is read
- **Then** it states what the tdd rule states today: a criterion names its
  test before code exists; RED, GREEN, REFACTOR; a bug fix starts from a
  reproducing test; the spike exception; the stop signals; that only the
  green half is enforced by `complete.py`
- **And** it states the prove-it-works check: a test counts only once it has
  been seen to fail because the behaviour is missing, then seen to pass

### S3 — plan and review load the principle before their work

- **Given** a project initialised with `--harness claude-code,pi`
- **When** `craftpath-plan` and `craftpath-review` are read on either harness
- **Then** the text before each one's first numbered instruction says
  ``Load the `test-first` skill``

### S4 — work's brief tells each task's subagent to load the principle

- **Given** a project initialised with `--harness claude-code,pi`
- **When** the brief for each task's subagent in `craftpath-work` is read on
  either harness
- **Then** it tells the subagent to load the `test-first` skill alongside the
  engineering skills its Notes name

### S5 — no other step loads the principle

- **Given** a project initialised with `--harness claude-code,pi`
- **When** the `brainstorm`, `spec`, `design`, `pr`, `learn` and `learn-apply`
  steps are read on either harness
- **Then** none of them names `test-first`

### S6 — init installs no rules

- **Given** an empty project
- **When** `craftpath init --harness claude-code,pi` runs
- **Then** `.claude/rules/` does not exist and `.pi/skills/tdd/` does not exist
- **And** the manifest lists neither `.claude/rules/tdd.md` nor
  `.pi/skills/tdd/SKILL.md`

### S7 — nothing installed points at a rule

- **Given** a project initialised with `--harness claude-code,pi`
- **When** every installed step and skill is read
- **Then** none contains `{{RULE:`, `.claude/rules/` or `.pi/skills/tdd/`
- **And** no shipped asset under `assets/` contains a `{{RULE:` token
- **And** where the plan step and the `backend`, `frontend`, `infrastructure`
  and `testing` skills referred to the rule, they name the `test-first` skill

### S8 — this repo points at the principle

- **Given** this repository after the change
- **When** `CLAUDE.md` and `README.md` are read
- **Then** each names the `test-first` skill as where test-first lives
- **And** neither mentions `.claude/rules/tdd.md` or the pi `tdd` skill

## Out of scope

- Changing what test-first requires: the principle says what the tdd rule says
  today, plus the prove-it-works check; no requirement is added, loosened or
  dropped.
- Making test-first always on. It applies during the plan, review and work
  steps that load it; a user who wants it everywhere points their own
  `CLAUDE.md` at the skill.
- Removing copies installed by an earlier release. `init` has no mechanism to
  delete files it no longer ships, and this work adds none: a project
  initialised before keeps its `.claude/rules/tdd.md` or `.pi/skills/tdd/` until
  its user deletes them.
- Loading the principle in the spec, brainstorm, design, pr or learn steps.
- Rewriting the engineering skills beyond replacing their pointer to the rule.

## Open questions

None
