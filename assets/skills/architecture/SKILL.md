---
name: architecture
description: Decide a technical question and write the decision down in a work item's DESIGN.md — the options, what each costs, what was rejected and why, the trust and failure boundaries it implies, and what it obliges of the tasks that build it. Use during the craftpath design step, when a mechanism has more than one defensible shape, or when a choice will be expensive to reverse once code exists. This skill decides and specifies; `backend` and `infrastructure` build what it produces.
---

# Architecture design

Your output is a section of `DESIGN.md` that ends an argument. The design step
exists because the plan cannot be cut until a technical question is settled, and
settling it in an implementer's head — at speed, under pressure, in a context
that ends with the task — is how a system acquires decisions nobody remembers
making.

## First: does this belong in the design at all?

Before writing anything, apply one test.

**Would a different answer change the task list?**

- **Yes** — it is a boundary decision, and `DESIGN.md` is where it goes.
- **No** — it is local to one task. Leave it to planning: the task records the
  choice in its Notes. A design that only restates a task is ceremony.

Reaching a boundary decision *during work* means the plan was cut on a false
premise. Stop and tell the user; quietly reshaping tasks does not fix a
decomposition built on the wrong shape.

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
to be made deliberately in the design, not discovered during a deploy.

## Diagrams inline, as mermaid

When a sequence or a boundary is easier seen than read, put a mermaid block in
the document. Keep it inline — a diagram in a separate file drifts from the
prose that explains it, and the prose is what gets read.

Use one where the shape is the point: a call sequence with a failure branch, a
trust boundary, a state machine. Do not draw a box diagram of your module
structure; that is documentation of code, and the code already says it.

## What graduates to an ADR

Most design output stays in the work item's `DESIGN.md`. It is scoped to this
work item, and that is where it should live.

Promote a decision to an ADR in `decisions/` when **it constrains work that is
not part of this work item** — a convention future features must follow, a
technology commitment, a boundary others will build against. The test is whether
someone outside this work item would be wrong to contradict it.

Do not write the ADR yourself during design. Note in the decision that it is an
ADR candidate; the learn step at the end of the work proposes it, and the user
decides.

## What this obliges of the plan

End each decision with the behaviour it implies, phrased so planning can turn it
into acceptance criteria an integration or e2e test proves. That is the
handoff.

## Before you stop

The user reads `DESIGN.md` before anything is planned. Check that a reader can
answer, from the document alone:

- What was being decided, what lost, and what specific consequence sank it?
- What happens on timeout, on partial failure, and when the downstream is down?
- What is enforced where, and what is not trusted?
- Which dependent task is obliged to do what, and against which criterion?

If the document would read the same with the alternatives section deleted, the
alternatives were decoration and the decision is unproven.
