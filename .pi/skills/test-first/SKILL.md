---
name: test-first
description: A principle — specification first, then a failing test, then code. The plan, verify and work steps load it before doing their work. Load it whenever you write, plan or review a change that alters behavior, in any language, including a bug fix. A test counts only once it has been seen to fail because the behaviour is missing, and then seen to pass.
---

# Test first: specification, then a failing test, then code

**Scope:** every task that changes behavior, in any language, under any path.
**Status:** non-negotiable. A task that skipped this is not done, it is undone
with extra steps.

## The rule

No production code without a failing test first. The test is not invented at
implementation time: the criterion it proves is written in the task file before
any code exists, together with the test that proves it.

```
- **A1** Uploading a TIFF returns 415 and writes nothing to storage
  — proven by integration test `rejects an unsupported format before writing`
```

That criterion is the contract between the spec and the code, and that test is
what has to go green for it. The cycle is:

1. **RED** — write the test the criterion names. Run the module's tests. Watch
   it fail, and confirm it fails because the behavior is missing, not because of
   a typo, a missing import, or a setup error. A test that fails for the wrong
   reason has proven nothing.
2. **GREEN** — write the minimum production code that makes it pass. Nothing
   beyond it. The adjacent feature you can see coming is a different task.
3. **REFACTOR** — improve structure with the test green, and keep it green.

Repeat per criterion, smallest behavior first. A criterion is proven by an
integration or e2e test; unit tests are welcome on the way, but they never prove
a criterion.

## The prove-it-works check

A test counts only once it has been seen to fail because the behaviour is
missing, and then seen to pass. Both halves, in that order, observed — not
assumed:

- a test that was never seen to fail proves nothing: it may not be able to fail
- a test that was seen to fail for another reason — a typo, an import, a broken
  fixture — has not yet been seen to fail because the behaviour is missing
- a test that was seen to fail but not then seen to pass proves the gap, not the
  fix

Until both halves have been seen, the criterion it names is not proven, however
convincing the code looks.

## Why this matters here

A task is ticked done only when every module it touches passes its `test`
command: the work step runs `complete.py`, which runs those tests and refuses to
tick or commit while one is red. Two consequences:

- A green run says the test passes, not that it ever failed. A criterion whose
  test was written after the code is green too, but nobody watched it fail, so
  nobody knows it can. The tick is real and the confidence is fake.
- Writing the test first is the cheapest possible check that the criterion was
  specific enough to be testable. A criterion you cannot turn into a failing test
  is a criterion that was never going to prove anything — and that is a planning
  defect to send back, not an implementation problem to work around.

This is what makes spec-driven and test-driven the same activity here rather than
two processes to keep in sync.

## Bug fixes

Reproduce first. Write the test that fails because the bug exists, watch it fail,
then fix it. A fix without a reproducing test is a fix you cannot prove and
cannot protect.

## The one honest exception

Exploratory spikes to learn an API or shape an unknown design. A spike is thrown
away, not merged. If the spike code is kept, it re-enters through the cycle above
from a failing test — "adapt the existing code" is how a spike quietly becomes
untested production code.

## Stop signals

If you catch any of these, the work has left this principle and needs restarting
from RED, not patching:

- the implementation exists and the test does not, yet
- the new test passed the first time it ran
- you cannot say which line you broke to make it fail
- "I'll add the tests at the end"
- "I already checked it manually"
- "this case is different because…"

## Where the detail lives

Keep this skill short. The reasoning belongs in the principles the implementer
loads beside this one:

- `test-behaviour-not-implementation` — the universal principle for proving
  observable behaviour through owned boundaries, without implementation-detail
  tests.
- `fix-root-causes` — a fix, and the test that reproduces it, address the cause,
  not the symptom.
- `boundary-discipline` — the change, and its tests, stay inside the boundary
  the task owns.
- `laziness-protocol` — GREEN is the smallest change that meets the criteria.
- `foundational-thinking` — data shapes settled first, scaffold before detail.

The tests for an implementation task belong to the implementer building it:
level choice within that boundary, naming, mocks, real boundaries, and tests
that run in isolation.

Writing criteria that can be turned into a failing test, before the code exists,
is the plan step's job.

The division is deliberate: an implementation task proves its own criteria and
ships its own tests. If tests are something a separate skill does afterwards,
they become a separate phase, and a separate phase is the thing this principle
exists to prevent.

## Note on enforcement

Only the green half is enforced: `complete.py` will not tick a task whose
module's tests fail. Nothing checks that the test failed first — that part is
binding by reading, not by mechanism, the weakest rung of the promotion
hierarchy (`lint rule > test > hook > repo rule > skill > CLAUDE.md`). Treat the
absence of enforcement as a reason to be careful, not as permission.
