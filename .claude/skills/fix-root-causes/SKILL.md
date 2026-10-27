---
name: fix-root-causes
description: A principle, not an engineering discipline — a fix addresses the cause, not the symptom. Load it whenever you fix a bug, make a failing test or check pass, work around an error, or review a change that does. Find out why the behaviour is wrong before changing what it looks like.
---

# Fix root causes

A fix changes the cause, not the symptom. Before changing code to make a
problem go away, find out why the problem happens, and change that.

## Why

A symptom fixed in place leaves its cause running. The cause shows up again
somewhere else, under a different name, and the next person has a harder time:
the first trace of it has been hidden. A test made green by bending the test,
a retry wrapped around a race, a `null` check around a value that should never
be `null` -- each one turns a loud failure into a quiet one.

## How to tell

Ask "why?" until the answer is something the code chose, not something that
happened to it. Then check the fix against these:

- you can say, in a sentence, what was wrong and why the change makes it right;
- the change would also prevent the other failures the same cause produces;
- you did not loosen an assertion, swallow an error, add a sleep or a retry, or
  special-case the one input that failed, just to get past it;
- the test that reproduces the problem fails without the fix and passes with it.

If the cause is outside the task's reach, do not patch around it silently: fix
the symptom only as a stated stopgap, and write down the cause and where it
lives so it can be fixed properly.
