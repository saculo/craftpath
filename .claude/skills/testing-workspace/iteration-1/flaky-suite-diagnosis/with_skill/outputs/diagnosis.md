# Flaky CI suite: where to start

Short answer: **stop trying to fix tests, and start measuring the suite.** You
cannot fix what you cannot count, and right now nobody can tell you which tests
flake or how often — the evidence is being destroyed by the re-run habit.

There's also a strong clue in your description that narrows things down a lot,
so let's start there.

---

## The most useful thing you already told me

> it's always a different test

That is the diagnosis, or most of it.

- **Same test failing intermittently** → a bug in *that test*. Local problem,
  local fix.
- **Different test each time** → the tests are almost certainly fine
  individually. Something at the *suite* level — shared state, ordering,
  concurrency, time, environment — is poisoning whichever test happens to be
  standing in the wrong place.

This matters because it changes the unit of work. You do not have 40 flaky
tests to fix. You very likely have **two or three infrastructure-level causes**
that manifest across a wide surface. Teams burn months fixing tests one at a
time and never get the rate down, because they're treating symptoms that are
generated at a level above where they're looking.

A sanity check on the arithmetic: if each of ~2,000 tests independently flaked
at random, a 20% suite failure rate means a per-test flake probability around
0.0001 — spread perfectly evenly across completely unrelated tests. That's not
how real codebases fail. Real distributions are brutally Pareto: the top 3
causes usually account for 60–80% of red runs. Your job in week one is to find
out which 3.

---

## Step 0 — stop destroying the evidence (do this first, today)

Two things, both cheap:

**1. If CI already auto-retries anything, note it.** Auto-retry doesn't just
hide failures, it corrupts your baseline — your real flake rate is higher than
20% and you have no idea by how much. Don't rip retries out yet (that'll make
everyone's day worse before you can show them why), but you need to know what
they're masking.

**2. Start recording every failure.** Almost every runner emits JUnit XML
(pytest `--junitxml`, jest `jest-junit`, JUnit/Surefire natively, Go
`gotestsum --junitfile`). Have CI upload it as an artifact on *every* run,
pass or fail, and dump the rows somewhere you can query. You want, per failure:

| field | why you want it |
|---|---|
| fully-qualified test id | the grouping key for everything below |
| commit SHA + branch | separates real breakage from flake |
| job / shard / worker index | exposes parallelism collisions |
| start timestamp (UTC) | exposes clock, DST, midnight, month-end bugs |
| test duration | exposes timeout-vs-slow-machine flakes |
| CI runner / image tag | exposes "one build agent is sick" |
| failure message + stack, first 2 lines | the clustering key |

A spreadsheet is a legitimate v1 here. Don't build a platform. You need two
weeks of rows, not a product.

**Give it a week.** You will know more from seven days of this table than from
a month of staring at test code, and it converts "this is driving me nuts" into
a number you can show people — which is what you'll need when you ask for time
to fix it.

---

## Step 1 — the experiment that actually identifies the cause

While the data accumulates, run these. Each one is designed to *discriminate*,
not just to gather more anecdote. Run each against a known-good commit, several
times.

### The single highest-value job: repeat-run an unchanged commit

Schedule a nightly (or hourly) job that runs the full suite **10 times against
the exact same, unchanged, known-green commit.**

This is the whole game in one trick. The code is identical every time, so
*every* failure it produces is by definition a flake — zero ambiguity, zero
arguing about whether someone's PR broke something. Within a few nights you'll
have a ranked list of your worst offenders, and you'll be fixing causes with
evidence instead of hunches. It also gives you a metric that goes down as you
fix things, which is how you keep the effort funded.

### Four discriminating runs

| Experiment | If the flakes disappear, the cause is |
|---|---|
| Run the suite with **parallelism forced to 1** | shared mutable state or concurrency between workers — same DB/schema, same Redis, same temp dir, same fixed port, same singleton |
| Run with **randomized test order** (and again with the *same* random seed) | order dependence — one test leaks state the next relies on or is broken by. Reproducing with a fixed seed turns it from a ghost into a normal bug you can bisect |
| Run with **TZ set to something awkward** (`TZ=Pacific/Kiritimati`, a non-UTC, non-en_US locale) — and check whether real failures cluster near midnight UTC or month boundaries | wall-clock, timezone, locale, or date-rollover assumptions |
| Run with **network egress blocked** to everything except your own services | a test is reaching a real external endpoint |

That table covers the large majority of what I'd expect to find. The remaining
common ones, worth grepping for directly:

- **Fixed sleeps** (`sleep(2)`, `waitFor(500)`) instead of waiting on the
  condition that actually matters. These fail exactly when CI is loaded — which
  is why they feel random and why they cluster at busy times of day.
- **Unguaranteed iteration order** — hash/map/set ordering, or a DB query with
  no `ORDER BY` that happens to come back sorted on your laptop.
- **Leaked background work** — a thread, timer, watcher, or container from test
  A still running during test B.
- **Resource limits** — the CI container has less CPU/RAM than your laptop, so
  anything with a timeout is running much closer to the edge than you think.

---

## Step 2 — pin down an individual offender

Once the table names a specific test:

1. **Run it alone, 200 times.** Green every time? The test isn't the problem —
   it's the victim. Skip to 3.
2. **Red on its own?** Genuine test bug. Fix the cause, not the symptom: wait on
   the condition, inject the clock, seed the randomness, sort the collection.
3. **Green alone, red in suite** → it's an interaction. Re-run it with the tests
   that preceded it in the failing order (most runners let you pass an explicit
   list, or bisect the order file). You're looking for the test that leaves
   residue. That test — not the one that went red — is your actual bug.

The general principle: **fix the cause, never add a retry.** A retry converts a
real signal into a slightly slower green and guarantees you'll be back here in
six months with a worse suite. The one exception is a genuinely
non-deterministic external dependency you don't control — and that should be
declared a known gap in writing, not quietly papered over.

---

## Step 3 — quarantine, with teeth

You need to unblock people while you work. Quarantine is fine; *open-ended*
quarantine is how suites die.

A quarantined test must have:

- **a named owner** (a person, not a team),
- **a tracked issue**,
- **an expiry date** (2 weeks is plenty),
- and it **still runs**, reported to a separate non-blocking channel — so you
  keep collecting data on it and notice if it starts failing 100% of the time,
  which means it's now catching a real bug.

And a hard cap: if the quarantine list exceeds some small number (5, say), the
list is the emergency, and new feature work waits. Without a cap, quarantine
becomes the landfill and you've just built a slower way to ignore tests.

---

## Step 4 — make it not come back

- **Track flake rate as a first-class metric**, visible to the team, from the
  nightly repeat-run job. One number, on a chart, going down.
- **Treat a new flake like a build break.** The moment "just re-run it" is an
  acceptable answer, the ratchet loosens and you're back here.
- **Watch your E2E count.** End-to-end tests are the first thing to turn flaky
  under load. If most of your offenders are E2E, the real fix is often pushing
  those assertions down to integration level where they can fail precisely,
  and keeping only a handful of journeys at the top.
- **Isolate at the boundary.** Per-worker database schema (or per-test
  transaction rollback), ephemeral ports rather than fixed ones, a fresh temp
  dir per test. Most shared-state flakes become structurally impossible once
  the harness guarantees isolation, rather than every test author having to
  remember.

---

## The honest framing to take to your team

The re-run habit is not laziness — it's the rational response to a suite nobody
trusts. But it has a cost that's worth naming out loud, because it's the
argument that gets you the time to fix this:

**A suite people re-run until it's green cannot fail.** At 1-in-5, a genuine
regression that breaks one test is indistinguishable from the usual noise, so
it gets re-run, and on the second or third attempt it passes for unrelated
reasons — or someone force-merges. You are not paying for flakiness in wasted
CI minutes. You're paying for it in the outages the suite was supposed to catch
and no longer can. A flaky test is worse than no test, because it actively
trains everyone to ignore the alarm.

---

## Your first week, concretely

1. **Day 1** — turn on JUnit XML artifacts for every run; find out what's being
   auto-retried today.
2. **Day 1** — set up the nightly 10x-repeat job on a fixed commit. Highest
   value per hour of anything here.
3. **Days 2–3** — run the four discriminating experiments (serial, random
   order, odd TZ, no egress). Expect at least one to be obviously guilty.
4. **Day 3** — quarantine the top offenders with owners and expiry dates so
   people stop suffering while you work.
5. **Days 4–5** — fix the top *cause* (not the top test). If serial-mode fixed
   it, you're looking at test isolation in the harness, and one change probably
   kills a dozen flakes at once.
6. **End of week** — post the flake-rate chart. Then keep it visible.

The thing to resist is starting at step 5. Going straight at the tests is the
intuitive move and it's why this problem has a reputation for being unfixable —
without the data you'll fix real bugs that weren't causing your red builds, and
the rate won't move.

---

If you can tell me your stack (language, test runner, CI system) and roughly
how the suite is sharded, I can make the commands and the isolation advice
specific rather than general.
