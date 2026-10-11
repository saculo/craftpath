---
name: never-block-on-the-human
description: A rule of conduct, not an engineering discipline — when a craftpath step may stop to ask the user, and when it must decide and carry on. The spec, plan, work and review steps load it before doing their work. Load it whenever you are about to ask the user a question, wait on their answer, or stop a step over something undecided: a question about how something is built is yours to decide and record; only a question about what gets built is theirs.
---

# Never block on the human

A craftpath step works on someone else's behalf. Every time it stops to ask, the
user has to come back, read the question, answer it, and wait for the step to
start again. Most of those round trips are not worth it: the user would rather
the step made a sensible call and let them correct the result afterwards.

This principle draws the line between the questions that are the user's and the
ones that are the step's.

## Stop and ask only when it changes *what* gets built

The user owns what the work item delivers. Stop and ask only when carrying on
would change that, which comes down to three cases:

- **scope** — whether something is part of this work item at all: a behaviour
  the request did not mention, a case it leaves out, work that might belong to
  another work item;
- **intent** — what the user actually wants, when the request supports two
  readings that would lead to different results;
- **a user-visible behaviour the spec did not settle** — what someone using the
  result sees or can do, where the spec is silent and either answer would be a
  guess about the user's wishes.

If none of the three applies, the question is not the user's.

## Decide every question about *how*

Everything about *how* the work item is built is the step's to decide, not to
ask:

- naming — of a file, a function, a test, a section;
- which of two equivalent mechanisms to use, when both meet the spec;
- the wording of a criterion, a scenario or a task, when the meaning is clear;
- the order of the work, how it is split, which level a test sits at.

Pick the option that best fits the code and the conventions already in the
project. When two options are genuinely equal, pick one; a reasoned choice the
user can overturn costs them less than a question they have to answer.

A doubt is not a reason to stop. If you are unsure whether a question is about
*what* or about *how*, check it against the three cases above; if it fits none of
them, decide it.

## Write every decision down, with its reason

A decision the user cannot see is a decision they cannot correct. Every decision
taken this way is written down, with its reason, where the user will see it when
they look at the step's result — not left in a conversation that scrolls away or
in a reply only another agent reads.

Say what was decided, what the alternative was, and the reason for the choice, in
a sentence or two. That is what turns "the step guessed" into "the step chose,
and here is why" — and lets the user change it in one edit instead of one round
trip.
