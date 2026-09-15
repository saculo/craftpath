# Bulk product import from CSV — approach and reasoning

## The request

> Add an endpoint that takes a CSV upload of products and bulk inserts them. If any row is
> invalid the whole file should be rejected and nothing written.

The interesting half of this is the second sentence. "Bulk insert a CSV" is a loop; "reject the
whole file, write nothing" is a set of decisions about where validation happens, what a
transaction boundary covers, and what the caller sees when it fails. Most of the design below is
about that.

## Endpoint

```
POST /api/v1/products/bulk-import
Content-Type: multipart/form-data
  file: <products.csv>      (required)
Accept: application/json
```

Success → `200 OK`

```json
{ "inserted": 1243, "skipped": 0, "durationMs": 412 }
```

Rejection → `422 Unprocessable Entity`, with the *reason the file was rejected*, not just a
message:

```json
{
  "code": "csv_validation_failed",
  "message": "File rejected; no products were written.",
  "rowCount": 1243,
  "errorCount": 3,
  "errorsTruncated": false,
  "errors": [
    { "line": 17, "field": "price",    "value": "-4.00", "message": "must be >= 0" },
    { "line": 92, "field": "sku",      "value": "SKU-1", "message": "duplicate of line 12" },
    { "line": 310, "field": "currency","value": "usd",   "message": "must be a 3-letter ISO-4217 code" }
  ]
}
```

`POST` with a body that is semantically wrong is a 422, not a 400 — 400 is reserved for a
malformed request envelope (missing `file` part, unparseable CSV structure, oversized upload).
Line numbers are *physical file line numbers*, not record indexes, because that is what the
person fixing the file sees in their editor; quoted fields with embedded newlines make these
differ, so the parser tracks them explicitly.

## Why two phases instead of one

The naive implementation streams the file and inserts as it goes, inside one transaction, and
relies on the rollback to satisfy "nothing written". That does produce the right final state, but
it has two problems:

1. **It reports one error per attempt.** A 5,000-row file with 40 bad rows takes 40 upload/fix
   cycles. The whole value of all-or-nothing import is that the user fixes the file once.
2. **It holds a write transaction open for the entire parse.** Parse time is attacker-influenced
   (file size, quoting), and an open transaction is holding locks and pinning the oldest xmin the
   whole time. Slow clients shouldn't be able to sit inside a database transaction.

So: **parse and validate the entire file first, outside any transaction; then open one short
transaction and batch-insert.** Validation is pure and produces a complete error list. The
transaction is opened only once the data is known-good, and it does nothing but writes.

The transaction is still load-bearing — it is the thing that makes "nothing written" true when a
database-level constraint fires that application validation could not have predicted (a SKU
inserted by a concurrent request between validation and commit). Application validation is for
*good error messages*; the transaction plus constraints are for *correctness*. Neither replaces
the other.

## Buffering, and its limit

Two-phase validation means the parsed rows are held in memory. That is a real cost and it needs an
explicit ceiling rather than an implicit one:

- `spring.servlet.multipart.max-file-size: 10MB` — rejected by the container before it reaches us.
- `MAX_ROWS = 50_000` — the parser aborts with `400 file_too_large` the moment it exceeds this,
  so a 10MB file of 1-byte rows can't be used to build a huge list.
- Only the parsed `ProductRow` values are retained, not raw text.

50k rows × ~200 bytes is ~10MB of heap per concurrent import, which is the number to size against.
If the requirement ever grows past this, the shape changes to *stage then promote*: `COPY` into a
temp/staging table, validate with SQL over the staging table, then `INSERT ... SELECT` into
`products` — all inside one transaction, with zero application-side buffering. I'd not build that
now; it is a materially more complex design and 50k is a generous limit for a CSV somebody edits
by hand.

## What counts as invalid

Structural (fail the request as `400`, since the file isn't a CSV of products at all):
- missing/extra/misspelled header columns
- a row with the wrong number of fields
- unterminated quote

Per-row semantic (collected, reported together, `422`):
- `sku` — required, `[A-Z0-9-]{1,64}`, **unique within the file**, and not already in the database
- `name` — required, ≤ 200 chars after trim
- `price` — required, parses as a decimal, `>= 0`, at most 2 fractional digits
- `currency` — required, 3-letter ISO-4217, matched against `java.util.Currency`
- `stock` — required, integer `>= 0`
- `active` — optional, `true`/`false` (case-insensitive), defaults `true`

The in-file duplicate check matters and is easy to miss: the database's unique constraint would
also catch it, but only as an opaque failure on the batch, with no way to point at *which two*
lines collided. Catching it in validation is what makes the error message useful.

## Money

Prices are parsed into `BigDecimal`, validated for scale, and stored as `price_minor BIGINT` plus
`currency CHAR(3)`. No `double` anywhere on the path. `BigDecimal.movePointRight(2).longValueExact()`
does the conversion and throws rather than silently truncating if the scale check were ever
bypassed.

This assumes every currency has 2 minor units, which is false for JPY, KWD and friends. It's fine
for a single-currency catalogue and it's called out in `user_notes.md` as the thing to revisit
before a second currency is onboarded.

## The insert

`JdbcTemplate.batchUpdate` with a fixed batch size of 1,000, all inside one
`TransactionTemplate.execute`. Plain `INSERT` — deliberately *not* `ON CONFLICT DO NOTHING` or
`DO UPDATE`, because both would quietly turn "reject the file" into "partially apply the file",
which is exactly the behaviour the requirement rules out.

A `DuplicateKeyException` escaping the batch means a concurrent writer took a SKU between
validation and commit. The transaction rolls back (nothing written, as required) and the caller
gets `409 sku_conflict` telling them to re-upload — a genuinely different situation from "your
file is wrong", and worth a different status code.

## Idempotency

A bulk import is expensive and a client that times out will retry. The endpoint accepts an
optional `Idempotency-Key` header; a completed import stores the key with its summary, and a
repeat of the same key returns the stored summary instead of re-importing. This is sketched in
the code with a `TODO` rather than fully built, since it needs a decision about key retention that
is out of scope here — but the header is reserved now so adding it later isn't a breaking change.

Without it, the failure mode is real: request succeeds, response is lost, client retries, second
attempt fails with `409` on every SKU. That's at least a *safe* failure (nothing written twice),
which is the property the unique constraint buys us.

## Authorization and observability

- Requires `ROLE_CATALOG_WRITE`. Bulk import is a much bigger lever than single-product create;
  it should not inherit the same permission by accident.
- One structured log line per import: actor, filename, byte count, row count, outcome,
  duration. On rejection, the *error count* is logged but not the error contents — product data
  shouldn't land in logs.
- Metrics: `product_import_total{outcome=success|rejected|conflict}` and a duration timer.

## Files

| File | Purpose |
| --- | --- |
| `src/main/java/com/example/catalog/products/bulkimport/ProductBulkImportController.java` | HTTP boundary, multipart handling, status mapping |
| `.../ProductCsvParser.java` | RFC-4180 parse + full validation, returns rows *or* errors |
| `.../ProductRow.java` | Validated row value object |
| `.../RowError.java` | One field-level error with its physical line number |
| `.../CsvParseResult.java` | Either-shaped parser result |
| `.../ProductBulkImportService.java` | Orchestration; owns the transaction boundary |
| `.../ProductBulkImportRepository.java` | Batch insert + SKU existence probe |
| `.../BulkImportErrors.java` | Exceptions + `@RestControllerAdvice` mapping |
| `src/main/resources/db/migration/V7__products_bulk_import.sql` | Unique SKU constraint |
| `src/test/java/.../ProductCsvParserTest.java` | Validation unit tests |
| `src/test/java/.../ProductBulkImportIntegrationTest.java` | End-to-end, incl. the rollback proof |

## The test that matters

`rejectsWholeFileAndWritesNothingWhenOneRowIsInvalid` — seed the table, upload a 100-row file whose
row 57 has a negative price, assert `422`, assert the error names line 57, and assert
`SELECT count(*) FROM products` is **unchanged**. The last assertion is the requirement; the
status code alone would pass even with a partial write.

A second test drives the same assertion through the *other* path: a file that passes application
validation but violates the unique constraint at commit time (SKU inserted concurrently), proving
the transaction — not just the validator — is doing its job.
