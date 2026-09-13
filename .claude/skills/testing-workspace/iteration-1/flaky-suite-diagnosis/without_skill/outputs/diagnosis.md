# A flaky CI suite: where to start

Short answer: **start by measuring, not fixing.** "Always a different test" feels like chaos, but it almost never is. A 20% failure rate spread across many tests is the signature of a small number of shared causes — usually two or three — leaking into whichever test happens to be standing nearby. You can't see that pattern from individual re-runs. You need the failures in one table.

Resist the urge to open the last failing test and stare at it. That's the trap that's kept this going.

## Step 0: stop the bleeding socially (this week)

Before any technical work, make the re-run button cost something. The reason this has persisted is that re-running is free and fixing is expensive, so nobody fixes.

Cheapest effective intervention: require a one-line note when someone re-runs — a Slack thread, a spreadsheet row, whatever. `#ci-flakes`, message format `<test name> <build link>`. That's it. You now have a data collection mechanism and a visible tally, and within two weeks someone will say "that's the third time this week for `checkout_spec`."

You are not trying to shame anyone. You're trying to make an invisible cost visible.

## Step 1: get failure data into one place (days, not weeks)

You need, per failed test, over at least ~50-100 runs:

- test identifier (file + test name)
- timestamp and build/commit
- error message and stack trace
- duration
- which CI worker/shard it ran on
- whether the same commit passed on re-run

Most test runners emit JUnit XML (pytest, jest, go test with converters, rspec, maven, gradle — all do). Most CI systems archive it. So the job is: parse the XML artifacts from the last N builds into a table.

If your CI has this built in, use it and skip the work:

- GitHub Actions: no native flake detection, but `dorny/test-reporter` or just downloading artifacts via `gh run download` works
- CircleCI: has native "Flaky Tests" in Insights
- Buildkite: Test Engine (formerly Test Analytics) does exactly this
- GitLab: "Unit test reports" plus flaky-test detection on newer tiers
- Datadog CI Visibility, Trunk.io Flaky Tests, BuildPulse: paid, but they solve precisely this and are worth a trial before you build anything

**The one metric that matters:** for each commit, did the *same commit* pass on re-run? A test that fails then passes with zero code change is flaky by definition. That's your ground truth, and it separates flakiness from real bugs, which is the distinction everyone is currently failing to make. (Note: some of those "flakes" will turn out to be real race conditions in production code. Don't assume flaky means harmless.)

## Step 2: rank, don't boil the ocean

Sort by failure count. You will almost certainly find something like:

- top 3 tests: 40-60% of all failures
- top 10 tests: 80%

Fix in that order. Ten flaky tests fixed will usually take a 1-in-5 suite failure rate down to 1-in-20 or better, because the per-run failure probability compounds: with 500 tests each at 99.9% reliability, the suite passes only ~61% of the time. Reliability is multiplicative, which is why "each test is basically fine" and "the suite fails constantly" are both true at once.

## Step 3: classify by cause, because the fix depends on it

Group your top offenders. In practice nearly everything falls into these buckets, roughly in order of how often I'd expect them:

**1. Shared mutable state / test order dependence.** Test A leaves a row in the database, a key in Redis, a global singleton mutated, an env var set, a mocked module unrestored. Test B fails — but only when they land on the same worker in the same order. This is the #1 cause of "it's always a different test," because the *victim* is whoever ran next, and that changes with sharding and parallelism.

*How to confirm:* run the suite with a fixed random seed and bisect the ordering. `pytest -p randomly --randomly-seed=X`, jest `--runInBand` vs parallel, rspec `--seed`. If the failure reproduces under a specific order and vanishes under another, you've found it. `pytest-random-order` has a built-in bisect mode for exactly this.

*Fix:* real isolation. Transaction-rollback per test, a fresh schema/namespace per worker, `beforeEach` teardown that's actually exhaustive. And then *keep* running tests in random order so regressions surface immediately.

**2. Time.** `sleep(0.5)` as a synchronization mechanism, tests asserting on `now()`, tests that break at midnight/month-end/DST, timeouts tuned to a fast laptop running on a loaded CI box.

*Fix:* replace sleeps with polling-until-condition (with a generous cap). Inject a clock instead of calling the system clock. Freeze time (`freezegun`, `jest.useFakeTimers`, `timecop`).

**3. Async / concurrency races.** Awaiting the wrong thing, asserting before a callback lands, UI tests that click before hydration, background jobs that may or may not have drained.

*Fix:* wait on the actual observable condition, never on a duration. In browser tests, prefer the framework's auto-waiting locators (Playwright) over sleeps.

**4. Ordering assumptions on unordered data.** Asserting a list equals `[a, b, c]` when the query has no `ORDER BY`, or iterating a hash/map/set whose order isn't guaranteed. Passes 95% of the time by luck.

*Fix:* assert set equality, or add a deterministic sort.

**5. External dependencies.** Real network calls, third-party sandboxes, DNS, container registries, package installs mid-build. Every one of these is a slot machine.

*Fix:* stub at the boundary (`vcr`, `nock`, `wiremock`, `responses`). If you must hit something real, isolate those tests into a separate suite that doesn't gate merges.

**6. Resource exhaustion on the CI box.** Port collisions between parallel workers, temp-file name collisions, memory pressure causing OOM-kills that look like random failures, disk filling. Symptom: failure rate correlates with parallelism or time of day rather than with any particular test.

*Fix:* per-worker ports/tempdirs derived from the worker index; check if your runner is just undersized.

## Step 4: quarantine, carefully

Once identified, move confirmed flaky tests out of the merge-gating path so the suite goes green and stays meaningful. But two conditions, or quarantine becomes a graveyard:

- Every quarantined test gets a ticket with an owner and a date.
- The quarantine list is capped (say 10). Adding an 11th means fixing one first.

A quarantined test still runs — it just doesn't block. If it's still flaky in 30 days and nobody has looked, delete it. A test nobody trusts and nobody fixes has negative value.

## Step 5: make it not come back

- Random test order on by default, in CI.
- New/changed tests run 5-10x in CI on their introducing PR. Catches the flake before it's merged, which is 50x cheaper than catching it after.
- A flake dashboard someone actually looks at in a weekly sync.
- Track "suite pass rate on unchanged commits" as a number. If it's not on a dashboard, it will drift back.

## What I'd do in your position, concretely

- **Day 1:** open `#ci-flakes`, ask people to paste test name + build link on every re-run. Announce it's a measurement exercise, not a blame exercise.
- **Day 1-3:** pull JUnit XML from the last 100 builds, build the frequency table. A ~50-line script. Or start a trial of Buildkite Test Engine / Trunk / Datadog CI Vis and let them do it.
- **Week 1:** identify the top 5. Classify each by the buckets above.
- **Week 1:** turn on random test ordering. Expect a spike in failures — that's the state dependence becoming visible, and it's good news.
- **Weeks 2-3:** fix the top 5. Quarantine anything that takes more than a day.
- **Ongoing:** new-test repetition rule in CI, plus the dashboard.

Realistic outcome: 1-in-5 down to under 1-in-20 within a month, mostly from a handful of fixes. Getting below 1-in-100 is a longer grind and may not be worth it depending on suite size.

## The one thing to internalize

The re-run habit isn't laziness — it's a rational response to a broken feedback signal. People re-run because the suite has taught them that red doesn't mean broken. The goal isn't to stop people re-running; it's to make the suite trustworthy enough that a red build is genuinely alarming again. Everything above is in service of that.

Once red means something, the culture fixes itself.
