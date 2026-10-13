# C-00004 — Spec Assumption Sections

## Problem

When an agent prepares a work-item specification, `Open questions` currently
contains decisions the agent can make from the request and the concerned code.
The user must answer those implementation-level questions before planning can
begin, even though their answers do not change the requested product behavior.
The specification has no place to record those decisions for the user to
review.

## Scenarios

### S1 — New specifications include assumptions

- **Given** craftpath creates a new work item from its specification template
- **When** the agent opens the created `SPEC.md`
- **Then** it contains an `## Assumptions` section with guidance for recording
  decisions made while specifying
- **And** the section is positioned before `## Open questions` so both are
  visible together before planning

### S2 — A spec records decisions that do not change the product

- **Given** the agent is writing a specification and must settle a detail that
  does not change the work item's scope, intent, or user-visible behavior
- **When** it decides that detail from the request and concerned code
- **Then** it records the decision and its reason under `## Assumptions`
- **And** it does not put that decision in `## Open questions`

### S3 — Only product-changing uncertainties remain open

- **Given** the agent is writing or revising a specification
- **When** an uncertainty would change the work item's scope, intent, or
  user-visible behavior
- **Then** it remains under `## Open questions` for the user to resolve
- **And** an uncertainty that does not meet that condition is decided and
  recorded as an assumption instead

### S4 — Assumptions do not block a complete spec

- **Given** a `SPEC.md` has completed required sections, one or more recorded
  assumptions, and `None` under `## Open questions`
- **When** the spec completeness check and the plan guard evaluate it
- **Then** they treat the specification as complete, as they do a spec with no
  unresolved open questions
- **And** planning is not refused because the specification contains
  assumptions

## Out of scope

- Changing how the plan, work, or review steps decide or record their own
  decisions.
- Asking the user to approve individual assumptions before planning.
- Automatically verifying whether a written assumption truly changes the
  work item's scope, intent, or user-visible behavior.

## Assumptions

- Assumptions are the reader-visible record of decisions the spec agent made
  rather than questions it sent to the user.
- The user reviews assumptions in `SPEC.md` before choosing whether to plan
  the work item.
- `## Assumptions` is placed immediately before `## Open questions` in the
  template so both forms of uncertainty resolution are adjacent.

## Open questions

None
