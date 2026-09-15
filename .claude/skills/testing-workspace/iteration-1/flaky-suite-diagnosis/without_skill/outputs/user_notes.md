# Notes on the diagnosis: assumptions and uncertainties

## What I was not told

The user gave one sentence. No language, framework, test runner, CI provider, suite size, runtime, team size, or example failure. So the response is necessarily a *general* diagnostic method rather than a specific diagnosis. I wrote it to be actionable without those details, but the ranking of causes would shift a lot with them.

## Assumptions I made

1. **A real, established CI suite with meaningful volume.** "Everyone just hits re-run" implies multiple people and enough runs per week for a pattern to exist. If this is a 3-person team with 20 builds a week, the "collect 100 builds" step takes a month and the advice should lean more on turning on random ordering immediately.

2. **Test artifacts exist and are archived.** I assumed JUnit-XML-style output is available, since nearly every mainstream runner emits it. If this suite is a pile of shell scripts, Step 1 is much harder and the answer would start with "make your tests emit machine-readable results."

3. **Parallel test execution.** I leaned on this for the shared-state and resource-exhaustion causes. If the suite runs serially, order-dependence is still the top cause but resource contention drops way down the list.

4. **"Always a different test" is literally true**, not an exaggeration for "a few tests rotate." If it's really 3 tests rotating, the data-collection phase is overkill and they could just go look at those three. I hedged toward measurement anyway because measurement is cheap and being wrong about the cause is expensive.

5. **The failures are flakiness, not real intermittent product bugs.** I flagged this explicitly in the doc because it's the assumption most likely to be wrong and most costly if it is. Race conditions in production code masquerade as flaky tests constantly.

## Things I stated with more confidence than I strictly have

- **"Top 3 tests = 40-60% of failures, top 10 = 80%."** This is a Pareto pattern that holds in most published flaky-test analyses (Google, Microsoft, Spotify have all reported similar shapes) and matches general experience, but it is a heuristic expectation, not a measured fact about this suite. It could be genuinely uniform.

- **The ordering of the six cause buckets.** Shared-state-first is a defensible default and fits the "different test each time" symptom particularly well, but I don't have data for this codebase. For a browser/E2E-heavy suite, async races would very likely be #1 instead.

- **"1-in-5 to under 1-in-20 within a month."** An informed estimate to set expectations, not a prediction. Depends entirely on whether the top offenders are easy fixes or architectural.

- **The compounding-reliability math (500 tests at 99.9% → ~61% suite pass rate).** The arithmetic is right (0.999^500 ≈ 0.606), but 500 tests and 99.9% are invented illustrative numbers, not theirs.

## Tool and product claims — verify before relying on

I named specific tooling from memory: CircleCI Insights flaky detection, Buildkite Test Engine, GitLab unit test reports, Datadog CI Visibility, Trunk.io, BuildPulse, `dorny/test-reporter`, `pytest-random-order` bisect, `freezegun`, `nock`, `wiremock`, `vcr`, `responses`. These all existed and did roughly what I said as of my knowledge cutoff, but product names and tier availability churn (Buildkite's "Test Analytics" → "Test Engine" rename is an example of exactly that). Treat these as leads to check, not verified current facts. GitHub Actions in particular may have shipped native flake handling since my cutoff.

## Deliberate choices worth flagging

- **I led with the social fix rather than the technical one.** The user's framing ("this is driving me nuts," "everyone just hits re-run") is as much about team behavior as about tests. I judged that a purely technical answer would miss what they're actually asking. If they wanted only the technical path, the doc front-loads a step they may want to skip.

- **I recommended quarantine**, which is contested. Done badly it hides problems permanently. I added the cap-and-ticket guardrails because unguarded quarantine is genuinely harmful advice.

- **I did not recommend automatic test retries.** Many teams reach for this first. It's the mechanized version of the re-run button — it makes the symptom vanish while the underlying nondeterminism (possibly a real bug) stays. Retry-with-logging as a *data collection* tool is fine; retry as a *fix* is not. I left this out to keep the doc focused, but it's the most likely follow-up question and worth raising if they ask.

- **No code.** With no language specified, any script would have been a guess. If they name their stack, the JUnit-XML aggregation script is a quick concrete next deliverable.

## What I'd want to ask them

1. Language/test framework and CI provider?
2. How many tests, and how long does the suite take?
3. Do the failures cluster in one area (E2E? integration? unit?) or truly spread across all types?
4. Does the suite run in parallel/sharded?
5. Can you grab the error message from the last 3 failures? Even three samples would let me skip most of the guesswork above.
