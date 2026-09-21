/** The `backend` skill, installed as `<skills-dir>/backend/SKILL.md` by `craftpath init`, per harness. */
export const BACKEND_SKILL = `---
name: backend
description: Implement and verify server-side behavior — API boundaries, data access, transactions, error handling, idempotency, migrations, background work, and observability. Use whenever a task touches server code, an HTTP or RPC endpoint, a database schema or query, a queue or scheduled job, authentication or authorization, or service-to-service calls. Trigger on mentions of the backend, an API, a service, an endpoint, a migration, a database, server-side logic, or "why is this request failing". Use it even for a change that looks like a one-line fix, because the failure modes here are mostly invisible at the call site.
---

# Backend

You are implementing one task against acceptance criteria that were approved
before any code existed. The criteria are the specification. Satisfy them
exactly, and resist the urge to build the adjacent thing you can see is coming.

## You write the tests, and you write them first

The unit and integration tests for this task are yours. They are not a later
phase and not someone else's skill — they are how the implementation is done at
all. (\`testing\` covers end-to-end journeys and suite health; it does not cover
these.)

Before the endpoint exists, the test for it exists and fails. That is the repo
rule (\`{{RULE:tdd.md}}\`), and backend work is where it pays most: the
failure modes here — the partial write, the second call, the rolled-back
transaction — are invisible at the call site and cannot be checked by looking.

Take the criteria one at a time, smallest behavior first:

\`\`\`
RED       write the test that proves the criterion, run it, watch it fail
GREEN     write the minimum code that makes it pass
REFACTOR  improve structure with the test green
\`\`\`

**RED has a condition:** the test must fail *because the behavior is missing* —
not from a typo, an unresolved import, a misconfigured fixture, or an exception
in setup. Read the failure message. If it is not the assertion you wrote, fix the
test before writing any production code. A test that failed for the wrong reason
and then passed has never exercised the behavior.

The rejection paths deserve this most. "Returns 415 and writes nothing" written
test-first forces you to decide *where* validation sits before you have code
whose shape makes that awkward — which is exactly how implementations end up
writing first and compensating afterwards.

For a bug fix: write the test that fails *because the bug exists*, watch it fail,
then fix it. You need a reproduction to debug anyway; this just keeps it.

### Which level, for backend work

- **Unit** — branch-heavy logic, validation rules, parsers, calculations. Fast
  and precise; most of your tests.
- **Integration** — the things you actually get wrong: the query, the
  transaction boundary, the serialization, the constraint, the migration. Fewer,
  slower, far more revealing.

A criterion about a real boundary needs that boundary. "Nothing was written when
a row is invalid" cannot be proven with the repository mocked — the mock encodes
the assumption under test. Use a real database (Testcontainers or equivalent),
and assert the table, not the mock.

Mock what you cannot afford to touch: third-party services, clocks, randomness,
payment providers, anything with a real-world side effect. Use the real thing for
your own code, your own database, and your own serialization. A suite that mocks
everything passes reliably and tells you nothing.

### Name the test as the claim

The name is read far more often than the body, usually in a failure report by
someone with no context.

**Weak:** \`testUpload2\`, \`shouldWork\`, \`testEdgeCase\`
**Strong:** \`rejectsUnsupportedFormatBeforeWriting\`, \`replaysStoredResponseOnRetry\`

State the condition and the outcome, so a failure is diagnosable from the report.

### Each test must pass alone

\`verified_by\` runs the whole command, so a test that only works inside a
full-suite run will still go green — and take a criterion with it. Check it
yourself by running the one test on its own:

\`\`\`
./mvnw test -Dtest='AvatarUploadIT#rejectsUnsupportedFormatBeforeWriting'
\`\`\`

A test that passes in the suite and fails alone is leaning on residue from an
earlier test. Fix the isolation.

## Start at the boundary

Decide what callers can observe before deciding how it works internally. The
boundary is the part you cannot change later without breaking someone; the
internals are the part you can.

For each endpoint or entry point, pin down:

- what a valid request looks like, and what happens to an invalid one
- the status or error the caller receives for each failure mode
- what is written, and whether anything is written on the failure paths
- whether calling it twice is safe

That last question is the one most often skipped and most expensive to retrofit.

## Validate before you commit anything

Reject bad input before any side effect occurs. A request that fails validation
should leave the system exactly as it found it — no partial row, no uploaded
object, no emitted event.

This matters because partial writes are discovered weeks later as data that
violates an invariant everyone assumed held. Ordering validation first is cheap;
cleaning up afterwards often is not.

\`\`\`
parse and validate  ->  authorize  ->  do the work  ->  emit effects
\`\`\`

If an effect must happen before validation can complete — say you must read the
object to know if it is valid — make the effect reversible, and reverse it.

## Errors are part of the interface

An error path is behavior a caller depends on, so design it rather than letting
it fall out of an exception:

- distinguish "you sent something wrong" from "we failed" — callers retry one
- return something a caller can act on, not an internal exception string
- never leak internal structure, stack traces, or SQL in a response body
- log the detail server-side with enough context to find the request later

An error that says only "something went wrong" turns a five-minute diagnosis into
an afternoon.

## Transactions and consistency

Hold a transaction across the work that must succeed or fail together, and no
wider. A transaction held across a network call to another service is a
transaction held for an unbounded time.

Common trouble worth checking for:

- writing to the database and calling an external service in one logical step —
  they cannot both be atomic, so decide which one can be retried
- read-modify-write without a guard, which silently loses concurrent updates
- long transactions that hold locks while doing work unrelated to the lock

When two systems must agree, prefer recording intent durably first and acting on
it afterwards, so a crash between the two leaves a record you can resume from.

## Idempotency

Anything that can be retried will be retried — by a client, a proxy, a queue, or
a person refreshing a page. Decide explicitly what happens on the second call.

Usually one of:

- naturally idempotent: the same input produces the same end state
- deduplicated: a caller-supplied key makes repeats detectable
- guarded: a uniqueness constraint turns a duplicate into a clean, handled failure

"It won't be called twice" is not one of the options.

## Data access

- Let the database enforce what must always hold; application checks race
- Index what you filter and sort on, and know which queries the change adds
- Watch for a query inside a loop — it is the most common accidental slowdown
- Return bounded result sets; an unpaginated list endpoint grows until it fails

## Migrations

Schema changes deploy separately from the code that depends on them, so write
them to be safe in both orders:

1. add the new structure, leaving the old one working
2. deploy code that writes both and reads the new
3. backfill
4. stop writing the old
5. remove it, once nothing reads it

Collapsing these into one step works until a deploy is rolled back. Destructive
changes deserve particular care: a dropped column is not recoverable from a
rollback.

## Background work

A job that can fail needs to say so. Give asynchronous work a visible outcome —
a status, a record, a metric — so failure is discoverable without reading logs.

Bound retries, and make the failure terminal and visible when they are exhausted.
Infinite retry turns one broken message into an outage.

## Observability

Log at boundaries with a correlation identifier, at a level someone would
actually want in production. Log the decision, not the ceremony: "rejected
upload: unsupported format image/tiff" is useful; "entering method" is noise that
buries it.

Never log credentials, tokens, or personal data.

## Verifying the work

The acceptance criteria name specific tests. Make those tests exist, under
exactly the names the criteria promise, and make sure they fail if the behavior
regresses.

Check especially that you have covered:

- the rejection paths, including the "and nothing was written" half
- the boundary values, not just the happy middle
- the concurrent or repeated call, where the criterion implies one

Then run the real verification command and let the evidence decide. A test you
believe passes and a test that has been observed passing are different things.

**Ship the test file, not a description of it.** A solution document with a
section headed "the test that matters", naming a test that does not exist on
disk, is worse than no mention at all — it reads as covered during review and is
discovered empty later. If you named a file, write the file.
`;
