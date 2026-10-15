# C-00006 — Test-first as a principle skill: plan

## Goal

Test-first ships as the `test-first` skill on both harnesses, loaded by the
plan, review and work steps and named by the engineering skills, and craftpath
installs no rule: no `.claude/rules/`, no pi `tdd` skill, no `{{RULE:` token.
This repo's `CLAUDE.md` and `README.md` point at the skill.

## Approach

Add the new home first, move every pointer to it, then remove the old one, so
the branch works after each task: T-0001 ships the skill beside the rule;
T-0002 has the three steps load it and drops their rule pointers; T-0003 does
the same for the engineering skills and adds the sweep that nothing installed
or shipped points at a rule; T-0004 removes the rule and its `{{RULE:}}`
plumbing from `init` and `harness.ts`; T-0005 updates this repo's docs and
refreshes its installed copies. Steps and engineering skills are split because
they prove different scenarios (S3-S5 vs S7) and each is a reviewable commit;
removing the rule is its own task because it is the only one that deletes code.
The repo has one `app` module, so every task is its own wave and they run in
order; each dependency is real (see each task's Notes).

## Tasks

### Wave 1

- [ ] T-0001 — Ship the test-first principle skill

### Wave 2

- [ ] T-0002 — Load test-first in the plan, review, work steps

### Wave 3

- [ ] T-0003 — Point the engineering skills at test-first

### Wave 4

- [ ] T-0004 — Stop installing the tdd rule

### Wave 5

- [ ] T-0005 — Point this repo's docs at test-first
