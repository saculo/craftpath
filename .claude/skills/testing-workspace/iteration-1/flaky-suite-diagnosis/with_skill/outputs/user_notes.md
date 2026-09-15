# User notes — flaky suite diagnosis

## What was asked
"CI fails ~1 in 5 runs, always a different test, everyone re-runs until green.
Where do I start?" Deliverable: `diagnosis.md`.

## Assumptions made (none of these were stated by the user)

1. **No codebase to inspect.** Per the task constraints this is hypothetical, so
   nothing was searched or read. The advice is stack-agnostic by necessity.
2. **Stack unknown.** No language, test runner, or CI system was given. I gave
   JUnit-XML-based instrumentation because nearly every major runner can emit it
   (pytest, jest, Surefire, gotestsum, RSpec), and named examples across
   ecosystems rather than picking one. `diagnosis.md` closes by asking for the
   stack so specifics can follow.
3. **Suite size ~2,000 tests** — used *only* to illustrate the independence
   arithmetic, and labelled as such. If the suite is 200 tests the conclusion
   (causes cluster, they aren't independent) is unchanged.
4. **CI runs in containers on shared/ephemeral runners** — implied by "CI
   suite" and by the 1-in-5 pattern. This underpins the resource-limit and
   parallel-shard-collision hypotheses.
5. **Team has authority to add a scheduled CI job and upload artifacts.** The
   nightly repeat-run recommendation assumes this; on a locked-down or
   metered CI plan it may need approval or a smaller N.
6. **"Always a different test" is accurate**, not an impression. I leaned on
   this hard — it is the load-bearing inference for "look at suite-level causes,
   not individual tests." Worth confirming; see uncertainties.

## Uncertainties / where I could be wrong

- **The core inference could be wrong if "different test" is really "different
  test within one cluster."** If the failures are actually all E2E, or all in
  one module, the diagnosis narrows sharply and the answer is much more
  targeted. The instrumentation step (Step 0) resolves this either way, which
  is precisely why it's first — the advice is robust to my being wrong here.
- **Auto-retry may already be on**, in which case the true flake rate is
  unknown and worse than 20%. Flagged in the doc but unresolvable without
  seeing their config.
- **I did not recommend ripping out existing retries immediately.** Defensible
  either way — removing them gives clean data faster but makes everyone's week
  worse before there's a fix to offer, which tends to get the initiative
  killed. I chose the politically survivable ordering and said why.
- **The four discriminating experiments are the common causes, not all causes.**
  Rarer ones not covered in depth: flaky *infrastructure* rather than flaky
  tests (a sick build agent, registry timeouts, DNS), and memory pressure
  causing nondeterministic OOM kills. The per-runner and duration columns in
  the recording table would surface both, but I didn't spell that out to keep
  the document actionable rather than exhaustive.
- **Effort estimate ("days 4–5") is a guess.** If the cause is harness-level
  test isolation on a large legacy suite, that's weeks, not days.

## Workarounds / deliberate scope choices

- **Quarantine is recommended despite being a form of hiding failures.** The
  skill's guidance is to fix the cause rather than retry; quarantine here is a
  bounded unblocking mechanism, not a retry — the tests still run and still
  report, just non-blocking, with owner + issue + expiry + a cap on list size.
  I was explicit about those teeth because unbounded quarantine is the failure
  mode.
- **No artifact published**; the task specified `diagnosis.md` as the required
  output, so it's a plain file in the outputs directory.
- **No files outside the outputs directory were created or modified.**

## Grounding in the testing skill

The skill's flakiness section supplied the cause list (fixed sleeps,
wall-clock/timezone/locale, unguaranteed iteration order, shared state under
concurrency, real network calls), the "fix the cause rather than adding a
retry" stance, the "declare it a known gap rather than quietly retrying"
exception, and the "a flaky test is worse than no test because it trains
everyone to re-run" argument used in the team-framing section. The
independence section supplied the shared-mutable-fixture and
shared-database-without-isolation diagnoses. The level-selection section
supplied the E2E-first-to-turn-flaky point and the push-assertions-down
remedy. The measurement-first sequencing, the repeat-run-on-unchanged-commit
job, the discriminating-experiment table, and the quarantine policy are mine.
