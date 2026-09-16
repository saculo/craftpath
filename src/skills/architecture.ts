/** The `architecture` skill, written to `.claude/skills/architecture/SKILL.md` by `craftpath init`. */
export const ARCHITECTURE_SKILL = `---
name: architecture
description: Decide a technical question inside one task's boundary and write the decision down — the options, what each costs, what was rejected and why, the trust and failure boundaries it implies, and what it obliges of dependent tasks. Use when a task carries a \`design:\` block of kind \`architecture\`, when a mechanism has more than one defensible shape, or when a choice will be expensive to reverse once code exists. Not for work-level boundary design — a decision that would change the task list belongs in design.md before the decomposition, not in a task. This skill decides and specifies; \`backend\` and \`infrastructure\` build what it produces.
---

# Architecture design

Your output is a document that ends an argument. A task bound to this skill
exists because a dependent task cannot be built until a technical question is
settled, and settling it in the implementer's head — at speed, under pressure, in
a fresh subagent — is how a system acquires decisions nobody remembers making.

## First: is this task-local at all?

Before writing anything, apply one test.

**Would a different answer change the task list?**

- **No** — it is task-local. This is your document.
- **Yes** — it is a boundary decision. It belongs in work-level \`design.md\`,
  before the decomposition, and reaching it *now* means the plan was approved on
  a false premise. Stop and say so. Running \`craftpath amend <id> --reason "<why>"\` on one task does
  not fix a decomposition built on the wrong shape.

Getting this wrong in the cheap direction costs a wave. Getting it wrong in the
expensive direction means amending an approved plan mid-execution, which is why
this test comes before the work rather than after it.

## Name the rejected alternatives, with reasons

**This is the load-bearing rule.** A design document is reviewable when it names
what was rejected and why. A design with one option is a decision nobody made —
it reads as inevitability, and the reviewer has nothing to push against.

For each option, state:

- **What it costs** — in operational burden, in failure modes, in what it
  forecloses. Not in lines of code.
- **What it assumes** — about load, about trust, about what the other system
  does when it is down.
- **Why it lost** — a specific consequence, not an adjective. "More complex" is
  not a reason. *"Requires a second write path that can diverge from the first,
  with no way to detect the divergence"* is.

The option that loses for a good reason is more valuable to a future reader than
the one that won. That is what stops the same argument being reopened in six
months, and what tells the reader whether the premises still hold.

## Say what happens when it fails

Every mechanism you specify crosses at least one boundary that can fail. Name
each one and its behavior:

- **Timeout** — what is the budget, and what does the caller see when it expires?
- **Partial failure** — the write succeeded and the notification did not. What
  is the state of the system, and who reconciles it?
- **Retry** — safe or not? If the operation is not idempotent, say what makes it
  safe to retry, or say it must not be retried.
- **Downstream unavailable** — degrade, queue, or refuse? All three are valid;
  choosing by accident is not.

A design that describes only the success path has specified the easy half. The
dependent task will implement exactly what you wrote and discover the rest in
production.

## Trust boundaries and authorization

Say where the boundary is and what is checked at it. Specifically:

- What is the caller, and how is that established?
- What is authorized at which layer — and where is the single place it is
  enforced, rather than the several places it is repeated?
- What data crosses the boundary that the other side must not be trusted with?
- What is logged, and what must never be logged?

If your design moves data across a trust boundary that it did not cross before,
that is the headline of the document, not a detail in it.

## Data and compatibility

Where the decision touches stored data, state the migration and the rollback in
the same breath:

- Is the change backward compatible for readers deployed before it?
- Is it forward compatible for readers deployed after a rollback?
- What is the expand-and-contract sequence, and which release does each half
  land in?

A schema change whose rollback story is "we would not roll back" is a decision
to be made deliberately at G2, not discovered during a deploy.

## Diagrams inline, as mermaid

When a sequence or a boundary is easier seen than read, put a mermaid block in
the document. Keep it inline — a diagram in a separate file drifts from the
prose that explains it, and the prose is what gets read.

Use one where the shape is the point: a call sequence with a failure branch, a
trust boundary, a state machine. Do not draw a box diagram of your module
structure; that is documentation of code, and the code already says it.

## What graduates to an ADR

Most design task output stays in the work folder. It is scoped to this work item
and its dependent tasks, and that is where it should live.

Promote a decision to an ADR in \`decisions/\` when **it constrains work that is
not part of this work item** — a convention future features must follow, a
technology commitment, a boundary others will build against. The test is whether
someone outside this work item would be wrong to contradict it.

A decision that graduates gets an ID and is referenced from the work document
rather than duplicated into it. One rule, two copies, guaranteed drift.

## What this obliges of dependent tasks

End with the acceptance criteria your decision implies, phrased so a dependent
task can bind a test to them. That is the handoff, and it is what makes this task
worth a wave of its own.

If a criterion you are now writing contradicts one approved at G2, stop and run
\`craftpath amend <id> --reason "<why>"\` on the affected task. Do not widen the dependent task quietly —
the plan was approved with a different shape, and the gate exists precisely to
catch this.

## Verifying the work

A design task's criteria are manual: its output is proven by a person reading it.
Before acknowledging one, check that a reader can answer, from the document
alone:

- What was being decided, what lost, and what specific consequence sank it?
- What happens on timeout, on partial failure, and when the downstream is down?
- What is enforced where, and what is not trusted?
- Which dependent task is obliged to do what, and against which criterion?

If the document would read the same with the alternatives section deleted, the
alternatives were decoration and the decision is unproven.
`;
