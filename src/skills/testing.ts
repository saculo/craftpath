/** The `testing` skill, installed as `<skills-dir>/testing/SKILL.md` by `craftpath init`, per harness. */
export const TESTING_SKILL = `---
name: testing
description: Test strategy and the tests nobody writes while implementing — end-to-end journeys, which level an assertion belongs at, and the health of the suite as a whole. Use when choosing what to test at which level, when writing or pruning end-to-end tests, when a suite is slow, flaky, or no longer trusted, when deciding whether an assertion should move down a level, or when a criterion needs verification that no single implementation task owns. Trigger on mentions of end-to-end tests, browser or journey tests, the test pyramid, a flaky suite, re-running CI until it passes, test coverage as a number, or quarantining a test. Do not use it for the unit and integration tests that come with an implementation task — those belong to the backend and frontend skills, which own writing them test-first.
---

# Testing

This skill is about the tests that are **not** a by-product of implementing a
feature.

Unit and integration tests are written by the engineer building the behavior,
test-first, as part of the implementation task — that is the \`backend\` and
\`frontend\` skills, and the cycle is \`{{RULE:tdd.md}}\`. Do not duplicate that
work here.

What lands here instead:

- **end-to-end tests** — the few journeys that must never break
- **level strategy** — which level an assertion belongs at, and when to move one
- **suite health** — flakiness, runtime, independence, trust

The through-line: an implementation task proves its own criteria. This skill is
responsible for whether the suite *as a whole* is worth running.

## The standard, at every level

A test exists to make a specific claim falsifiable. If it cannot fail when the
behavior it describes is broken, it is overhead wearing the costume of safety.

That applies to an end-to-end journey exactly as much as to a unit test — and it
is easier to violate at the top, where a test can pass because the page rendered
at all.

So the same guarantee is required here: **watch it fail before you trust it.**
Break the behavior deliberately, run the test, confirm it catches it, restore. An
end-to-end test nobody has seen fail is the most expensive thing in the suite —
slow, fragile, and proving nothing.

## Choose the level deliberately

This is the decision this skill exists for. Test at the highest level that can
still fail precisely.

| Level | What it is for | Owned by |
|---|---|---|
| Unit | Logic with branches and edge cases. Fast, plentiful, precise. | backend / frontend, while implementing |
| Integration | The parts people actually get wrong: queries, serialization, transactions, wiring, real boundaries. | backend / frontend, while implementing |
| End to end | A handful of journeys that must never break. | this skill |

Two rules that follow:

**A criterion about a real boundary cannot be proven above it with that boundary
mocked.** "Nothing is written to storage on rejection" needs the real storage —
a mock encodes the very assumption in question. That is an integration test, and
it belongs to the implementing task, not to a journey test.

**Push assertions down whenever you can.** An assertion that could hold at
integration level and is instead made end-to-end costs more to run, fails less
precisely, and turns flaky first. If most of a suite's failures are end-to-end,
the fix is usually not better end-to-end tests — it is moving those assertions
down a level and keeping only the journey at the top.

## End-to-end tests: few, and chosen

Every end-to-end test is a standing bill: slow, order-sensitive, environment-
sensitive, and the first thing to break for reasons unrelated to the change.
Spend them on journeys where the *integration* is the thing at risk — sign-up
through to first use, checkout, the path that spans three services and a queue.

Write them so they earn it:

- **Assert the journey, not the pixels.** A journey test that fails when a label
  changes is a maintenance tax that teaches people to ignore it.
- **Wait on conditions, never on durations.** A \`sleep\` in an end-to-end test is
  a flake with a delay fuse; it fails exactly when CI is loaded.
- **Own your data.** Each run creates what it needs, under identifiers it
  generated, and does not assume a seeded fixture some other test also mutates.
- **Fail readably.** When a ten-step journey goes red, the report should say
  which step and why. Capture the artifact — screenshot, trace, response — that
  makes it diagnosable without a local re-run.

If you cannot name what a proposed end-to-end test protects that a cheaper test
does not, do not write it.

## Independence, at suite scale

Each test sets up what it needs and cleans up after itself. Tests that depend on
execution order, or on residue from an earlier test, fail mysteriously when run
alone, in parallel, or after someone inserts a new test above them.

Shared mutable fixtures are the usual culprit. So is a shared database without
isolation between tests, and a shared bucket, queue, or temp directory between
parallel workers.

The cheap check: run the suite in random order, and run individual tests alone.
Anything that only passes in one specific order is already broken — it just has
not been noticed yet. Keep random order on permanently so the next one surfaces
immediately.

## Flakiness is a defect, not a quirk

A flaky test is worse than no test: it trains everyone to re-run the suite, and
that habit is exactly what lets a real failure through. Once red stops meaning
broken, the suite has stopped doing its job, whatever its pass rate says.

**Never add a retry to make it green.** An automatic retry does not just hide the
failure — it corrupts the measurement, so the real flake rate is unknown and
nobody can tell whether it is improving. If CI already retries, find out what it
is masking before changing anything else.

Diagnose rather than patch. Usual causes:

- waiting on a fixed sleep instead of the condition that matters
- depending on wall-clock time, timezone, or locale
- depending on iteration order that is not guaranteed
- sharing state with a test running concurrently
- leaning on a real network call
- resource limits on the CI box that do not exist on a laptop

**Identify before fixing.** "Always a different test" is the signature of a
suite-level cause, not of many broken tests — so measure first. The highest-value
single move: run the whole suite repeatedly against one unchanged, known-green
commit. The code is identical every run, so every failure is a flake by
definition, and you get a ranked list instead of an argument.

Then discriminate: run serially (implicates shared state), in random order
(ordering), under an odd timezone (clock assumptions), with egress blocked (real
network calls).

Quarantine to unblock people, but with an owner, a ticket, an expiry, and a hard
cap on the list — and keep running it, reported somewhere non-blocking. Without a
cap, quarantine is just a slower way to delete tests.

If something genuinely cannot be made deterministic — an external dependency you
do not control — declare it a known gap in writing. That is a different thing
from quietly retrying it until it passes.

## What not to test

Do not test the framework, the language, or generated code. Do not assert on
internal structure that no caller depends on — those tests break during harmless
refactors and pass through real breakage.

Coverage is a diagnostic, not a goal. High coverage with weak assertions is the
most expensive possible state: the cost of the tests, none of the protection. A
coverage threshold as a merge gate reliably produces tests written to move the
number.

## Verifying the work

Run the real verification command and let its output stand as the evidence. A
test believed to pass and a test observed passing are different things, and only
one of them is evidence.

Check that a test for each criterion actually ran. A criterion names a command,
not a test, so nothing mechanical catches a suite that went green without ever
exercising the behaviour — only your reading does. That gap is the exact failure
this whole discipline exists to prevent.
`;
