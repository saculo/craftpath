# Notes: assumptions and open questions

## Assumptions I made

- **No codebase was available**, so all code here is illustrative and standalone. Package
  names (`com.example.orders`), the `orders` table shape, `customer_id`, and `OrderService`
  are invented. The migration assumes an existing `orders` table with a `customer_id uuid`
  column — adjust before running.
- **Spring Boot 3.x / Java 21.** I used `JdbcClient` (Boot 3.2+), `TransactionTemplate`,
  `ProblemDetail`, records, and sealed interfaces. Drop to `JdbcTemplate` and classes on
  older versions.
- **Authenticated callers**, with `Principal.getName()` being a customer UUID. If your
  principal is a username or an opaque subject, map it to a stable id before using it as the
  key namespace.
- **Order creation is DB-only and fast** (tens to low hundreds of ms). Both the
  single-transaction design and the 3s `lock_timeout` depend on this.
- **Postgres default isolation (READ COMMITTED).** The design needs no higher level; the
  unique index does the serialization. It works unchanged at REPEATABLE READ.
- **Flyway**, version `V2` picked arbitrarily.
- Tests assume Testcontainers, AssertJ, JUnit 5, and Spring Security Test are on the
  classpath.

## Things I could not verify and you should check

- **Whether `placeOrder` has non-transactional side effects.** This is the single biggest
  risk. If it charges a card or sends a message before commit, the duplicate-order symptom
  becomes a duplicate-charge symptom and this fix will look like it didn't work. I flagged it
  in `solution.md` but I have no way to confirm it from here.
- **Whether the duplicates are really retry-driven.** I inferred the cause from your
  description. Before building anything, confirm it against the data: do duplicate pairs
  share a client IP, user agent, and fall within one client timeout window (typically
  10-30s)? If duplicates are minutes apart, the cause is more likely double-tap in the UI or
  an at-least-once queue upstream, and the fix is the same mechanism but the key must be
  generated at a different point in the client flow.
- **Whether the mobile client can generate and persist a key across retries.** If it
  regenerates the UUID per HTTP attempt rather than per user action, none of this works.
  That's a client-side change and it's a hard dependency.
- **Existing duplicates.** Nothing here cleans up the orders already created. You'll want a
  separate reconciliation query and a decision from ops on cancel-vs-refund.
- **Load characteristics.** I chose `lock_timeout = 3000ms` and 30-day retention from
  general practice, not your traffic. Both deserve a look at real numbers.

## Deliberate choices you might disagree with

- **Replay the original response rather than return `409 Conflict`.** Replay means the
  client needs no changes to its success path. `409` is arguably more honest but pushes work
  onto every caller. Stripe replays; I followed that.
- **`422` on key-reuse-with-different-body rather than silently replaying.** Slightly
  hostile, but silent replay hides a real client bug and can return the wrong order to a user.
- **Ledger row in the business transaction, rather than a separate one.** The alternative
  (reserve → work → complete) gives you a "request in progress" state you can report, and it
  survives the work being non-transactional. I judged that not worth the recovery machinery,
  but if order creation grows slow or calls out to other systems, revisit it — at that point
  the right answer is probably `202 Accepted` plus async processing.
- **Required header rather than optional-with-fallback.** Stricter than some teams will
  accept; the two-phase rollout in `solution.md` is the compromise.

## Not written / out of scope

- The `OrderService` implementation (interface only — it's your existing code).
- Outbox table and publisher, which the side-effect discussion implies you'll need.
- Client-side changes.
- Metrics/alerting beyond the `Idempotent-Replayed` header.
- Nothing here was compiled or run; there is no project to build it against, so treat the
  code as reviewed-by-eye only.
