---
name: laziness-protocol
description: An engineering principle — make the smallest change that meets the criteria, and prefer deletion to addition. Load it whenever you implement or review a change. Every line added has to be read, tested and kept; the cheapest code is the code that is not there.
---

# Laziness protocol

Make the smallest change that meets the criteria. When you can meet them by
removing code instead of adding it, prefer deletion to addition.

## Why

Every line added is a line someone has to read, test, keep working and one day
remove. Code written for a case the criteria do not name is a guess about the
future that the present pays for: it is untested by intent, it widens the
change under review, and it makes the next change harder. The criteria are
what the work owes; anything beyond them is a cost with no claim on it.

## In practice

- Write what the next failing test needs, and stop. The feature you can see
  coming is a different task.
- Reach for what already exists -- a function, a pattern, a library already in
  the project -- before writing something new.
- Do not add an option, a hook or a layer of indirection for a caller that does
  not exist yet.
- When a change makes code unused, delete it in the same change.
- Lazy is about the size of the change, not its care: the smallest change is
  still tested, named well and correct.
