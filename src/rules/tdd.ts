/** The test-first rule, installed by `craftpath init` wherever the harness can read a rule. */
export const TDD_RULE = `# Rule: specification first, then a failing test, then code

**Scope:** every task that changes behavior, in any language, under any path.
**Status:** non-negotiable. A task that skipped this is not done, it is undone
with extra steps.

## The rule

No production code without a failing test first. The test is not invented at
implementation time: the criterion it proves is named in the plan, before the
task is approved, along with the command that runs it.

\`\`\`yaml
acceptance:
  - id: A1
    text: Uploading a TIFF returns 415 and writes nothing to storage
    verified_by:
      - cmd: test-integration
\`\`\`

That criterion is the contract between the spec and the code, and
\`test-integration\` is what has to go green for it. The cycle is:

1. **RED** — write the test that proves the criterion. Run it. Watch it fail, and
   confirm it fails because the behavior is missing, not because of a typo, a
   missing import, or a setup error. A test that fails for the wrong reason has
   proven nothing.
2. **GREEN** — write the minimum production code that makes it pass. Nothing
   beyond it. The adjacent feature you can see coming is a different task.
3. **REFACTOR** — improve structure with the test green, and keep it green.

Repeat per criterion, smallest behavior first.

## Why this repo in particular

Acceptance is derived from evidence, never asserted. \`craftpath task verify\`
runs the command and records its exit code; a criterion is satisfied only by
non-stale evidence matching its \`verified_by\`. Two consequences:

- A criterion whose test was written after the code is still green, but nobody
  ever watched it fail, so nobody knows it can. The evidence is real and the
  confidence is fake.
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

If you catch any of these, the work has left the rule and needs restarting from
RED, not patching:

- the implementation exists and the test does not, yet
- the new test passed the first time it ran
- you cannot say which line you broke to make it fail
- "I'll add the tests at the end"
- "I already checked it manually"
- "this case is different because…"

## Where the detail lives

Keep this file short. The reasoning belongs in the skills, which the executing
task binds explicitly:

- \`backend\` / \`frontend\` — **own the cycle for the code they write.** The unit
  and integration tests for an implementation task belong to the engineer
  building it: level choice within that boundary, naming, mocks, real
  boundaries, and tests that run in isolation.
- \`infrastructure\` — the same discipline in the form the tooling allows: a
  policy check or plan assertion that fails first.
- \`planning\` — writing criteria that can be turned into a failing test, before
  the code exists.
- \`testing\` — end-to-end journeys, which level an assertion belongs at, and
  suite health. **Not** the per-task unit and integration tests.

The division is deliberate: an implementation task proves its own criteria and
ships its own tests. If tests are something a separate skill does afterwards,
they become a separate phase, and a separate phase is the thing this rule exists
to prevent.

## Note on enforcement

Nothing mechanically enforces this rule: it is binding by reading, not by
mechanism — the weakest rung of the promotion hierarchy
(\`lint rule > test > hook > repo rule > skill > CLAUDE.md\`). \`craftpath task
verify\` records that a test passed, not that it failed first. Treat the absence
of enforcement as a reason to be careful, not as permission.
`;
