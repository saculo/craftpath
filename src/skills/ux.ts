/** The `ux` skill, installed as `<skills-dir>/ux/SKILL.md` by `craftpath init`, per harness. */
export const UX_SKILL = `---
name: ux
description: Decide how an interface should behave before anyone builds it — the interaction model, what each state shows, what a destructive action asks for, and what the written spec must say so a dependent task can implement it without guessing. Use when a task carries a \`design:\` block of kind \`ux\`, when a screen has more than one plausible interaction model, when a flow spans several steps or can fail partway, or when someone asks what something should do rather than how to code it. This skill decides and specifies; it does not implement — \`frontend\` builds what this produces, and does not design it.
---

# UX design

Your output is a document, not a component. A task bound to this skill exists
because a dependent task cannot be built until a question is answered, and the
answer has to be written down somewhere a person can review and an implementer
can follow.

That shapes everything below. You are not making it look good. You are removing
ambiguity that would otherwise be resolved — silently, differently, and late —
by whoever writes the code.

## State the question first

Open with the decision in one sentence, as a question. *"Does cropping happen
before upload or after?"* If you cannot phrase it as a question, the design task
was not needed, and you should say so rather than produce a document to justify
the task's existence.

A design task whose document has no question in it is a status report.

## Give at least two options, each with its cost

**A design with one option is a decision nobody made.** The reviewer at G2 cannot
tell the difference between "this is the right answer" and "this is the first
answer", and neither can you a month later.

For each option, state what it costs — not only in implementation effort, but in
what the user has to understand, what fails when it fails, and what it forecloses.
Then name the winner and what made it win. "Simpler" is not a reason; *"the user
never waits on a network round-trip before seeing their own photo"* is.

One of your options is always **the decision already made elsewhere** — the
pattern this product already uses. Departing from it is legitimate, but it is a
cost and belongs in the list.

## The four states are a design obligation

\`frontend\` builds loading, empty, error and populated. It cannot invent what they
*say*. That is yours:

| State | What you must specify |
|---|---|
| Loading | Whether the user can still act, and what they see if it is slow |
| Empty | Why it is empty, and the one action that resolves it |
| Error | What failed, in the user's terms, and what they can do next |
| Populated | What matters most, and what is only available on demand |

**Empty is a state of the data, not of the request.** A successful response with
zero rows is not an error, and "no results for this filter" is a different screen
from "you have not added anything yet". Specify both when both can occur.

Error text is interface copy, not a stack trace. Write the actual sentence the
user reads. If you leave it to the implementer, the user gets
\`Request failed with status code 422\`.

## Destructive and irreversible actions

Anything that loses work, spends money, or is visible to other people needs a
deliberate answer to three questions:

1. **Is it reversible?** Undo beats confirmation. A confirmation dialog trains
   people to click through it; an undo window costs one message and no decision.
2. **If it is not reversible, what does the confirmation ask for?** Proportional
   friction: a checkbox for a small loss, typing the resource name for a large
   one. A modal that says "Are you sure?" transfers responsibility without
   transferring information — say what will be lost, and how much of it.
3. **What is the state afterwards?** Where does focus go, what does the list show,
   and what happens to a queued action that referenced the deleted thing.

Never make the destructive action the default focus target, and never put it
where the confirm button of the previous dialog was.

## Multi-step flows

Say what happens when someone leaves halfway through. Every step boundary is a
place a session ends, a tab closes, or a network drops.

- What is saved, and when — per step, or only at the end?
- Can they go back without losing what they entered?
- What does returning later look like: resumed where they left, or restarted?
- Which steps can be skipped, and what is the consequence of skipping?

A flow spec that only describes the forward path is half a spec, and the missing
half is the part users actually hit.

## Specify in words; use a canvas only where words fail

The written spec is the deliverable. It is what gets reviewed, what a test is
written against, and what survives.

Reach for a visual artifact — an artboard, a diagram — only when spatial
relationship or density is the thing being decided: a table layout, a dense
dashboard, a comparison of two arrangements. Even then, the words carry the
behavior and the artifact carries the arrangement. An artboard with no
accompanying spec obliges the implementer to guess at everything that is not
pixels: what is interactive, what happens on failure, what changes when the data
is long.

Declare whatever you produce in the task's \`produces\`. A design that nothing
reads is a design that did not happen.

## Accessibility is part of the design, not a pass afterwards

Decide these here, because they change the interaction model and are expensive to
retrofit:

- What is the keyboard path through this screen, and what has focus on arrival?
- What does a screen reader announce when content changes without navigation?
- What is the target size on a touch device, and does anything depend on hover?
- Is any state communicated by color alone?

If your design needs a custom control where a native one exists, say why, and
state its keyboard and announcement behavior in full. That is the cost of the
choice, and it belongs next to the choice.

## What this obliges of dependent tasks

End the document with the acceptance criteria your decision implies — in the
words a dependent task can bind a test to. This is the handoff, and it is what
makes the design task worth a wave.

If one of those criteria contradicts a criterion already approved at G2, stop.
Run \`craftpath amend <id> --reason "<why>"\` on the affected task rather than quietly widening it: the
plan was approved with a different shape, and an implementer discovering the
contradiction mid-task has no standing to resolve it.

## Verifying the work

A design task's criteria are manual, because its output is proven by a person
reading it. That is not a lower standard — it is a different one, and it puts the
burden on you to make the document reviewable.

Before acknowledging a criterion, check that a reader who was not in your head
can answer:

- What was being decided, and what lost?
- What does the user see in each of the four states, in actual words?
- What happens when this fails, or is abandoned halfway?
- Which dependent task is obliged to do what?

If any answer is "it depends" or "the implementer will work it out", the document
is not done, and the ack would be a signature on an empty page.
`;
