# C-00018 — Modern search tools rule: plan

## Goal

Agents on Claude Code and pi are told, by one rule in `AGENTS.md` (imported by `CLAUDE.md`), to load the `modern-cli-tools` skill that `init` installs, and the README recommends the four tools as optional. Nothing else about init, doctor or the steps changes.

## Approach

Four tasks, one per concern: the skill and its install (S1-S3), the AGENTS.md rule and import (S4, S5), the README section (S6), and a guard that nothing else changed (S7). The repo has a single `app` module, so tasks cannot share a wave; each gets its own, ordered by dependence: the rule points at the skill, so the skill ships first. The skill is pulled verbatim from the C-00017 branch rather than rewritten. T-0004 is a guard test and passes on first run by design; its task file says how to see it fail.

## Tasks


### Wave 1

- [x] T-0001 — Ship the modern-cli-tools skill

### Wave 2

- [x] T-0002 — Add AGENTS.md search rule, import it in CLAUDE.md

### Wave 3

- [x] T-0003 — Recommend the four tools in the README

### Wave 4

- [ ] T-0004 — Guard that init and doctor ignore the tools
