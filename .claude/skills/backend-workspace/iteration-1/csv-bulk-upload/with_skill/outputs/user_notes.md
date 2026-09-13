# Notes, assumptions, and open questions

## The big one: none of this has been run

There is no project to compile against — the task specified a hypothetical codebase
and standalone files. So the code is **illustrative and unverified**: not compiled,
not executed, no test run observed. Treat signatures, imports and API details as
plausible rather than confirmed. In particular:

- The Commons CSV builder API changed across versions; `CSVFormat.Builder` setters
  are `setX(...)` in 1.10 and deprecated in favour of `get`/fluent forms in 1.11+.
- `@MockitoSpyBean` and `@ServiceConnection` are Spring Boot 3.4+ / 3.1+ respectively.
  On older Boot, use `@SpyBean` and `@DynamicPropertySource`.

## Stack assumed

Java 17+, Spring Boot (Web MVC + JDBC), PostgreSQL, Flyway, Apache Commons CSV,
JUnit 5 + AssertJ + Testcontainers. Chosen because the repo's skills (`java-expertise`,
`test-quality`) point at Java/JUnit 5/AssertJ. **If the real service is not Java, the
design carries over unchanged but all the code needs rewriting.** The reasoning in
`solution.md` is the durable part.

## Assumptions made without being able to ask

1. **The CSV shape.** `sku,name,price_cents,currency,active` with an exact header is
   invented. The real column set is the first thing to confirm.
2. **Money as integer minor units.** Avoids float rounding. If the existing product
   table stores `numeric(12,2)`, the column and parsing need to match it.
3. **Insert-only, no upsert.** "Bulk inserts them" was read literally: an existing
   sku is a conflict, not an update. If the real intent is "sync my catalogue", this
   is wrong and should become an upsert with a different contract.
4. **Products have no tenant/account scoping.** If the service is multi-tenant, `sku`
   is almost certainly unique *per tenant*, not globally, and the unique constraint
   and the authorization check both change.
5. **Synchronous is acceptable.** 50k rows in one request, in one transaction, inside
   the HTTP timeout. See the sizing caveat below.
6. **`catalog:write` authority.** The `@PreAuthorize` expression is a placeholder for
   whatever the real authorization model is.
7. **Required `Idempotency-Key`.** This is a real ergonomic cost — it will break a
   `curl` a user was about to write. I think it is worth it for an endpoint that
   writes 50,000 rows, but it is a product decision and worth confirming. Making it
   optional is a one-line change; the deduplication then simply does not apply.

## Known weaknesses

- **Sizing is guesswork.** 10 MB / 50,000 rows / 60s transaction timeout are round
  numbers, not measurements. 50,000 single-row inserts in one transaction on a busy
  PostgreSQL is not free. Measure before promising it; `COPY` into a temp table then
  `INSERT ... SELECT` is materially faster if the numbers disappoint.
- **The whole file is buffered in memory** (`MultipartFile.getBytes()`), and the
  parsed rows are all held at once. That is the price of "validate everything before
  writing anything" plus hashing for idempotency — but it means peak heap is roughly
  10 MB plus ~50k row objects per concurrent import. With 20 concurrent imports that
  is not nothing. A streaming two-pass approach over the spooled temp file would
  reduce it if this becomes a problem.
- **The conflict message does not say *which* sku collided.** Deriving it from the
  constraint violation means parsing a driver-specific message, and doing it properly
  needs a follow-up query after rollback. A better version runs a bounded
  `SELECT sku FROM product WHERE sku = ANY(?)` *after* the rollback, purely to build
  a useful error. I left it out as scope, but it is the first thing I would add —
  "one or more skus already exist" is a frustrating error for a 5,000-row file.
- **`ProductImportWriter.translate` matches on the constraint name inside an exception
  message.** That is brittle. Cleaner is to check the PostgreSQL SQLSTATE 23505 plus
  `ServerErrorMessage.getConstraint()` via the pgjdbc `PSQLException`, at the cost of
  a driver dependency in that layer.
- **The concurrency test is genuinely racy.** It asserts a set of acceptable outcomes
  rather than one, which is honest but weaker than a deterministic test. A
  deterministic version needs a latch inside the writer, which means test-only
  structure in production code — a trade I chose not to make.
- **No metric is emitted.** For an endpoint like this I would want a counter of
  imports by outcome and a histogram of row counts, so a spike in rejections is
  visible without log archaeology. Left out because the observability stack is unknown.
- **`text/plain` is in the accepted content types.** Browsers and `curl` mislabel CSVs
  constantly; the header validation is the real gate. This is a deliberate leniency,
  not an oversight, but it does mean a genuinely wrong file gets a 400 about the
  header rather than a 415.

## Workarounds

- Row-level `line` numbers are `recordNumber + 1`, which is correct only because the
  header is exactly one line. A quoted newline inside a field will make the reported
  line number drift from the physical line the user sees in their editor. Commons CSV
  can report the true character position; wiring that through would be more accurate.
- The BOM is stripped from the header cell only. A BOM cannot appear mid-file, so
  this is sufficient, but it is a string hack rather than proper encoding detection.
