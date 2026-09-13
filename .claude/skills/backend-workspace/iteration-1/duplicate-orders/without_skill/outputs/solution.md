# Duplicate orders on `POST /orders` — root cause and fix

## What's actually happening

The mobile client retries because it never learned whether the request succeeded. That's
not the same as the request having failed. On a flaky connection the common case is:

1. Client sends `POST /orders`.
2. Server creates the order and commits.
3. The response is lost — radio drops, LB idle timeout, app backgrounded, TLS reset.
4. Client's HTTP timeout fires and it retries.
5. Server has no way to tell retry #2 apart from a genuine second order, so it creates one.

So this is not a bug in the order-creation code. It's a missing piece of the API contract:
**`POST /orders` has no notion of request identity**, and over an unreliable network you
cannot get at-most-once delivery without one. The client can only offer at-least-once; the
server has to supply the deduplication. Any fix that doesn't give the request an identity
is guessing.

That's also why a bare unique index isn't the answer, and why you were right to push back
on it. A unique index on *cart contents* would have to answer "are these two orders the
same?" from the payload, and the honest answer is that it can't: a customer re-ordering the
same basket five minutes later is a legitimate second order, and two different taps within
a debounce window are indistinguishable from one tap retried. You end up with a heuristic
that both false-positives (blocking real orders — worse than the bug) and false-negatives
(the client changes a timestamp field and the dedupe evaporates).

## The fix: client-supplied idempotency keys, enforced in the same transaction as the order

The client generates a UUID **once, at the moment the user taps "Place order"**, and sends
it as `Idempotency-Key` on that request and on every retry of it. A new tap means a new key.
This is what Stripe, Square, and Adyen do, and the mobile team likely already has the
plumbing for it in their HTTP layer.

Server side, the key goes in a ledger table whose primary key is
`(scope, owner_id, idempotency_key)`:

- **`scope`** = the endpoint (`POST /orders`). Keys for different operations must not collide.
- **`owner_id`** = the authenticated customer. A client-generated key is only unique within
  that client; without the owner in the key, one tenant's UUID collision (or deliberate
  probe) reaches another tenant's data.

### The load-bearing detail: one transaction

The ledger row and the order are written in **the same transaction**. Not "reserve the key,
do the work, mark it done" — that's two transactions, and two transactions means a window
where a crash leaves a claimed key with no order behind it, which then needs stuck-row
recovery, lease expiry, and a reaper. Every one of those is a new way to get it wrong.

With a single transaction the invariant is free: either both the order and its key exist, or
neither does. Concurrency is delegated entirely to the unique index:

| Retry arrives… | What Postgres does | Result |
|---|---|---|
| after request #1 committed | `INSERT` raises `23505` immediately | replay the stored response |
| while request #1 is still running | `INSERT` **blocks** on the index tuple until #1 ends, then raises `23505` (committed) or succeeds (rolled back) | exactly one order either way |
| request #1 failed and rolled back | no row exists; `INSERT` succeeds | retry legitimately creates the order |

The blocking case is the one people miss. Two concurrent retries don't need a distributed
lock or advisory lock — the index tuple already is the lock, held for exactly the right
duration, released correctly on crash.

### The Postgres gotcha this design has to work around

In Postgres, a constraint violation **aborts the entire transaction**. You cannot catch
`DuplicateKeyException` and carry on using that connection — every subsequent statement
returns `25P02 current transaction is aborted`. So the flow is:

- attempt runs in its own transaction (`TransactionTemplate`, not `@Transactional`, so the
  boundary is explicit and not subject to self-invocation proxy surprises);
- on `23505` that transaction is already rolled back;
- the replay read happens in a **fresh** transaction.

This is also why the repository uses `JdbcClient` rather than JPA. With JPA the INSERT is
deferred to flush, so the violation surfaces at an unpredictable point — usually at commit,
with the persistence context already unusable — and you lose control over where you catch it.

### Response replay

The ledger stores the status and body of the original response, so a retry gets **byte-identical
output**, not a `409`. From the client's point of view the retry simply succeeded, which is
what makes this safe to adopt without changing client error handling. `Idempotent-Replayed:
true` is set for observability — graph it; a rising replay rate is a direct measurement of how
bad the network path is.

### Key reuse with a different body → 422

We fingerprint the request body (SHA-256 over canonical JSON, map keys sorted so a client
serializing from a `HashMap` doesn't get spurious rejections). If a key arrives with a
*different* body, we refuse with `422`. Replaying would return an answer to a question the
client didn't ask; executing would break the key's contract. Both are worse than a loud error
that says "your key generation is buggy".

## What you must check before shipping

**Side effects outside the transaction.** This design guarantees at-most-once for *database*
effects. If `placeOrder` also captures a payment, sends a confirmation email, or calls the
warehouse, those don't roll back, and a retried-then-rolled-back attempt double-charges.
Every external effect must be written to an **outbox table in the same transaction** and
published after commit. I've noted this as a contract on `OrderService`. This is the most
likely place for the duplicate to survive the fix, so audit it first.

**Transaction duration.** A retry blocks behind the in-flight original. If order creation
takes seconds (external pricing call, inventory reservation over HTTP), you're holding a
lock and a connection for that long, and retries pile up. I set `lock_timeout = 3s` and
return `409` with a retry hint rather than letting requests stack until the pool starves.
If placing an order is genuinely slow, the better shape is 202 + async processing, with the
idempotency key still guarding the enqueue.

**Retention.** The ledger grows one row per order forever, so there's a 30-day purge job.
30 days must exceed the longest plausible retry window (mobile clients can hold a queued
request across an app restart). After expiry a replayed key executes again — that's a
property of the API contract, so document it rather than leaving it as a surprise.

**Make the header required.** Optional means the bug returns the moment someone forgets it,
and the guarantee becomes conditional on client discipline you can't audit. Roll out in two
steps: ship the server accepting-and-honouring the key, get the mobile release out, then
flip the header to required once the old client versions have drained.

**Connection pooler.** `SET LOCAL lock_timeout` is transaction-scoped and safe under
PgBouncer transaction pooling. Plain `SET` would not be — it would leak to whatever session
reuses the connection.

## The unique index, used correctly

There *is* a unique index in the migration — `orders (customer_id, idempotency_key)` — but
it isn't the dedupe mechanism. It's a tripwire: if a future refactor bypasses the ledger, the
database turns a silent duplicate order into a loud constraint violation. Defence in depth,
not the defence.

## Files

| File | Purpose |
|---|---|
| `src/main/resources/db/migration/V2__idempotency_keys.sql` | ledger table + backstop index |
| `idempotency/IdempotencyService.java` | the mechanism; transaction boundaries and conflict handling |
| `idempotency/IdempotencyRepository.java` | JDBC access, `lock_timeout`, retention delete |
| `idempotency/RequestFingerprint.java` | canonical body hashing |
| `idempotency/IdempotencyScope.java` | scope + owner + key namespacing |
| `idempotency/IdempotencyCleanupJob.java` | retention sweep |
| `api/OrderController.java` | header handling, replay headers, `Location` |
| `api/IdempotencyExceptionHandler.java` | 400 / 422 / 409 as RFC 9457 problem details |
| `test/.../IdempotencyServiceTest.java` | Testcontainers; includes the 16-thread race proving exactly-once |
| `test/.../OrderControllerIdempotencyTest.java` | HTTP contract, including "same basket twice with different keys must create two orders" |

The concurrency test is the one that matters. It runs against real Postgres because the
mechanism *is* the unique index and its locking behaviour — mock the repository and you're
only testing the code you just wrote.
