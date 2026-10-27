---
name: sequence-verifiable-units
description: An engineering principle — order work as units that are each verifiable on its own. Load it whenever you plan work, split it into tasks or steps, or decide what to build next. A unit is done when something can prove it works, without waiting for the units after it.
---

# Sequence verifiable units

Cut the work into units, each verifiable on its own, and order them so each one
builds on units that are already proven.

## Why

A unit that can only be checked once later units exist is a unit nobody can
call done. Its mistakes wait, hidden, until everything lands together, and then
they are hard to trace. A unit proven on its own is a safe place to stand: the
next one starts from something known to work, and a failure points at the unit
that just changed.

## In practice

- Give each unit a check that proves it -- a test, a command, an observable
  result -- that can run as soon as the unit is built.
- Order units by what they depend on: what others build on comes first.
- Keep units small enough that a failure in one points at one change.
- A unit that cannot be verified without another is not a unit: merge the two,
  or cut them differently.
- Units that do not depend on each other can run side by side; say which.
