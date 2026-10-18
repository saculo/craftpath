# C-00008 — Review and learn read decisions

## Problem

The work step records every decision its subagents made on their own in
`.craftpath/work/<id>/DECISIONS.md`, and the spec step records its own under
`## Assumptions` in `SPEC.md`. Nobody reads either one afterwards. `review.py`
commits `DECISIONS.md` but neither prints it as something to review nor does the
review step tell the reviewer to read it, so a wrong call a subagent made is
never challenged. `learn.py` lists `SPEC.md`, `DESIGN.md`, the task files and
`REVIEW.md` as sources, but not `DECISIONS.md`, and the learn step never points
at the spec's Assumptions -- so a decision worth an ADR is lost. For the user, a
recorded but unchecked decision is just a log: the record exists so someone can
correct it, and no step does.

## Scenarios

### S1 — Review lists DECISIONS.md as something to review

- **Given** a work item whose tasks are all done and committed, with tests
  green, and a `DECISIONS.md` next to its `SPEC.md`
- **When** `review.py <work id>` runs
- **Then** it exits 0 and its output names the path of `DECISIONS.md` among
  what to review, next to the spec and the plan
- **And** it still commits `DECISIONS.md` as the decisions, as it does today

### S2 — Review without DECISIONS.md is not an error

- **Given** the same work item but with no `DECISIONS.md`
- **When** `review.py <work id>` runs
- **Then** it exits 0, creates `REVIEW.md` and prints what to review as usual
- **And** its output names no `DECISIONS.md` path and prints no error or
  warning about it, and no `DECISIONS.md` is created

### S3 — The review step tells the reviewer to check every decision

- **Given** craftpath installed by `bun bin/craftpath.ts init`, on Claude Code
  and on pi
- **When** the installed review skill (`craftpath-review`) is read
- **Then** it tells the reviewer to read `DECISIONS.md` when it exists,
  alongside `SPEC.md`, `PLAN.md` and the task files
- **And** it says that any recorded decision may be raised as a point, in the
  usual point form, when the decision is wrong for the spec or the code
- **And** it says that a missing `DECISIONS.md` is not itself a point

### S4 — Learn lists DECISIONS.md as a source

- **Given** a reviewed work item with no open point and a committed
  `DECISIONS.md`
- **When** `learn.py <work id>` runs
- **Then** it exits 0 and lists the path of `DECISIONS.md` under "Learn from:",
  together with `SPEC.md` and `REVIEW.md`

### S5 — Learn without DECISIONS.md is not an error

- **Given** a reviewed work item with no open point and no `DECISIONS.md`
- **When** `learn.py <work id>` runs
- **Then** it exits 0, creates `KNOWLEDGE.md` and lists its other sources
- **And** it lists no `DECISIONS.md` path, prints no error about it, and creates
  no `DECISIONS.md`

### S6 — The learn step proposes knowledge from decisions, assumptions and review

- **Given** craftpath installed by `bun bin/craftpath.ts init`, on Claude Code
  and on pi
- **When** the installed learn skill (`craftpath-learn`) is read
- **Then** it tells the agent to read `DECISIONS.md` when it exists, the
  `## Assumptions` section of `SPEC.md`, and `REVIEW.md` when proposing
  candidates
- **And** it names a recorded decision or assumption as a possible source of an
  `[ADR]` candidate, under the same "worth keeping" test as any other

## Out of scope

- The pull request body: `/craftpath-pr` does not start quoting or summarising
  `DECISIONS.md` or the Assumptions.
- How `DECISIONS.md` is written: the work step's format and its append-only
  rule stay as they are.
- Review checking the spec's Assumptions -- the request gives review only
  `DECISIONS.md`; the spec's Assumptions are already reviewed by the user
  before planning.
- Any new check in `check.py` for decision points: a point against a decision
  is an ordinary review point.

## Assumptions

- **A point against a decision uses the existing point form**, anchored at the
  code the decision shaped or at `DECISIONS.md:<line>`, with the usual
  `major`/`minor` rules. Alternative: a separate decision-point kind. Reason:
  `<file:line>` already fits, and a new kind would need new checks for no gain.
- **The test "review is the only script that names DECISIONS.md" is widened to
  review.py and learn.py.** Alternative: learn finds the file without naming
  it. Reason: the invariant that test guards is that only work writes it and
  only review commits it; learn only reads it, and S4 needs it to print the
  path.
- **Learn reads the Assumptions through `SPEC.md`, which it already lists**;
  no separate source line is printed for the section. Reason: the section
  lives in a file already listed, and the step text (S6) is where the agent is
  told to read it.

## Open questions

None
