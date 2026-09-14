export const DESIGN_TEMPLATE = `# Design — <work id>

<!-- guidance: BOUNDARY decisions only — the ones that determine how the work
     splits into tasks. If a decision is local to one task, it does not belong
     here: give that task a \`design:\` block instead and let it produce its own
     document.

     Test for this file: would a different answer change the task list? If no,
     it is task-local. -->

## Approach
<!-- guidance: what you are going to do, in a paragraph. -->

## Alternatives considered
<!-- guidance: at least one, with why it lost. An alternatives section with no
     alternatives means the decision was not really made. -->

## Decisions
<!-- guidance: each becomes either a spec requirement with an ID (checkable) or
     an ADR in .craftpath/decisions/ (explicitly advisory). Do not leave
     unverifiable prose here. -->

## Risks
`;

export const TASK_DESIGN_TEMPLATE = `# Design — <Dnnn> (<ux|architecture>)

<!-- guidance: produced by a task carrying a \`design:\` block. Scope is this
     task and the tasks that depend on it. A decision that changes the task
     list belongs in work-level design.md and needs an amendment, not a
     paragraph here. -->

## What is being decided
<!-- guidance: the question, in one sentence. If you cannot state it as a
     question, the design task was not needed. -->

## Options
<!-- guidance: at least two, each with what it costs. One option is a decision
     already made somewhere else. -->

## Decision
<!-- guidance: which one, and what made it win. -->

## What this obliges of dependent tasks
<!-- guidance: the acceptance criteria this decision implies. If any of them
     contradicts a criterion already approved at G2, stop and run
     \`craftpath amend\` — do not quietly widen the dependent task. -->

## Open questions
`;
