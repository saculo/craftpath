# C-00009 — PR body lists work decisions

## Problem

The work step records what each task's subagent decided in the work item's
`DECISIONS.md`, but `/craftpath-pr` builds the pull request body from
`SPEC.md`, `PLAN.md`, the commits and `REVIEW.md` only. Whoever merges the pull
request cannot see what the agents decided without checking out the branch and
opening that file. The request is an experiment: try it and see whether the
section is worth keeping.

## Scenarios

### S1 — The body carries the recorded decisions

- **Given** a reviewed work item whose `DECISIONS.md` holds
  `## T-0001 — Add the endpoint` with the bullet `- Named the route /health -- it matches the spec`
  and `## T-0002 — Document it` with `None` underneath
- **When** `/craftpath-pr` opens the pull request
- **Then** the body has a `## Decisions` section, directly after `## Tasks`,
  holding `### T-0001 — Add the endpoint` followed by that bullet, and
  `### T-0002 — Document it` followed by `None`
- **And** the file's own `# … — Decisions` title line does not appear in the body
- **And** the `Problem`, `Scenarios`, `Tasks`, `Review`, `Knowledge` and
  `Out of scope` sections are the same as they would be without `DECISIONS.md`

### S2 — No decisions file, no section

- **Given** a reviewed work item with no `DECISIONS.md`
- **When** `/craftpath-pr` opens the pull request
- **Then** the body has no `## Decisions` heading and no `### T-…` headings
- **And** the rest of the body is the same as it is today

## Out of scope

- Changing any other section of the pull request body, its title, or the order
  of the existing sections.
- Updating the body of a pull request that is already open: when the branch
  already has one, `/craftpath-pr` still only pushes (P5).
- Changing how the work step writes `DECISIONS.md`, or how review and learn
  read it.
- Deciding whether to keep the section after the experiment -- that is a later
  call by the user.

## Assumptions

- The section goes directly after `## Tasks`, not at the end: decisions are made
  per task, so they read best next to the task commits. The alternative, after
  `Knowledge`, would separate them from the tasks they explain.
- The task headings are shown one level down (`### T-0001 — …`) and the file's
  `#` title line is dropped, so the decisions nest under `## Decisions` instead
  of breaking the body's heading structure. The bullets and `None` lines are
  carried over word for word -- they are already written for a reader.
- `DECISIONS.md` is read from the work item's folder in the worktree, where the
  work step writes it and the review step commits it; no other location is
  looked at.

## Open questions

None
