# C-00004 — Spec Assumption Sections: plan

## Goal

New work-item specifications visibly separate decisions an agent can make from
unresolved product questions: assumptions record the former with reasons, while
only scope-, intent-, or user-visible-behavior-changing uncertainty blocks
planning.

## Approach

One focused asset-and-guard change updates the source specification template,
the installed specification-step instructions, and completeness checking
alongside integration coverage. These pieces must land together: a template
section without instructions or enforcement would not reliably distinguish the
two kinds of uncertainty, and changing the required sections requires updating
the shared complete-spec fixtures. The repository has one configured `app`
module, so no tasks can run in parallel.

## Tasks

### Wave 1

- [ ] T-0001 — Record specification assumptions
