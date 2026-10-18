# C-00007 — Test behaviour principle: plan

## Goal

Initialized Claude Code and pi repositories provide one concise behaviour-testing principle wherever work is specified, implemented, or reviewed, while the retired `testing` skill is no longer installed or referenced.

## Approach

One cohesive initializer-and-assets change owns the new shared skill, every workflow loading point, the retirement cleanup, and its installation-level proofs. It remains one task because these changes jointly form the observable installed skill set and all touch the repository's single `app` module, so splitting would serialize coupled partial states rather than enable parallel work.

## Tasks

### Wave 1

- [x] T-0001 — Install behaviour-testing principle
