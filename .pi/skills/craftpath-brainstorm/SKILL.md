---
name: craftpath-brainstorm
disable-model-invocation: true
description: Talk an idea or problem through until it is clear -- outside the flow; ends with a request ready for the spec step
argument-hint: <an idea, a problem, a half-formed plan>
---
# Brainstorm

The user wants to think something through with you: the user's request, given after this skill

This is a conversation, not a step. It is **outside craftpath's flow**: create
no work item, write no file, change no code, run no step. You may read the
project -- code, docs, history -- to learn facts. The only thing you produce,
at the end, is a request the user can hand to `/skill:craftpath-spec`.

## How the conversation goes

### 1. Find the intent first

Before any feature or approach, find out what the user is trying to achieve:
the outcome, who it is for, and how they will know it worked. If the request
already says, reflect it back instead of asking again. If it does not, ask
about purpose before anything else -- knowing *what* they want to build does
not tell you *why*.

**Check the size early.** If the idea is really several independent pieces
("a platform with chat, billing and analytics"), say so now and help split
it: what the pieces are, how they depend on each other, which comes first.
Then brainstorm the first piece; each piece becomes its own spec later.

### 2. Grill, in rounds

Treat the idea as a **tree of decisions**: every decision opens the decisions
that hang off it. The **frontier** is every decision whose prerequisites are
already settled -- the questions you can ask now without guessing at answers
you have not heard yet.

Ask the whole frontier in one round. Number each question and give your
recommended answer, worded so that "yes" accepts it:

```
❓ **Q1 — <title>**: <the question; options if there are some>

➡️ <your recommended answer, and why in one line>

---

❓ **Q2 — <title>**: ...

➡️ ...
```

Then stop and wait. The user's answers settle decisions and push the frontier
outward; work out the new frontier and ask the next round. A question that
depends on another question still open belongs to a later round, not this
one.

- **Facts are your job; decisions are theirs.** Never ask the user something
  you can find out by reading the project. Look it up, and say what you
  found. Every *decision* goes to the user.
- **When there is a real fork, show it.** Two or three approaches, each with
  what it costs, your recommendation first and why. Cut every feature the
  goal does not need -- the smallest version that does the job wins.
- **Push back.** If an answer contradicts an earlier one, or the idea solves
  a problem nobody described, say so plainly and ask which one holds. Agreeing
  to keep the conversation pleasant helps nobody.
- **Keep it short.** Rounds of a few sharp questions, not questionnaires. If
  the user is clearly done with a branch, take your recommendation for the
  rest of it and say that you did.

### 3. Write back what you understood

When the frontier is empty -- every branch visited, nothing silently assumed
-- summarise in a few lines what you now both understand: the outcome, the
constraints, the decisions made, and what success looks like. Mark what the
user **said** apart from what you **assumed**. Ask whether it is right.

Do not move on until the user says it is.

### 4. Hand over the request

Then give the user a request for `/skill:craftpath-spec`, ready to paste:

```
/skill:craftpath-spec <one line: what to build or change, and for whom>

Problem: <what is wrong or missing today, and for whom -- not the solution>
Behaviour:
- <each thing that must happen, concrete: given ..., when ..., then ...>
- <including what must not happen>
Out of scope: <what a reader would assume is included but is not>
Decided: <the decisions from this conversation, each with its reason>
Open: <anything still undecided, or "nothing">
```

If the idea split into pieces, give one request per piece, in the order to
build them, and say which to start with.

Then stop. The user runs the spec step when they choose -- do not run it, and
do not start on any of the work.
