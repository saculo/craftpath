# Bulk product import from CSV

`POST /api/v1/products/bulk-import` takes a CSV upload and inserts every row, or
inserts nothing at all.

## The boundary first

The part that cannot be changed later without breaking callers:

**Request** — `multipart/form-data`, one part named `file`, UTF-8 CSV whose header
is exactly `sku,name,price_cents,currency,active`. `Idempotency-Key` header is
**required**. Limits: 10 MB, 50,000 data rows.

**Responses**

| Status | When | Body |
| --- | --- | --- |
| 201 Created | all rows imported | `{importId, rowCount, insertedCount, replayed:false}` |
| 200 OK | same key + same file already imported | same, `replayed:true` |
| 400 Bad Request | missing part or key, bad header, empty file, any invalid row | `{code, message, errors[], errorCount, errorsTruncated}` |
| 409 Conflict | a sku already exists, or the key was reused for a different file | `{code, message}` |
| 413 Payload Too Large | over the size or row limit | `{code, message}` |
| 415 Unsupported Media Type | the part is not a CSV | `{code, message}` |

**The invariant the request asked for:** on every non-2xx response, nothing has
been written. Not a product, not an import record, not a partially applied batch.

`errors` carries up to 100 entries of `{line, field, code, message}`; `errorCount`
is the true total and `errorsTruncated` says whether the list was cut. Bounding the
list matters — a 50,000-row export with a wrong delimiter would otherwise produce a
response larger than the upload.

## How "reject the whole file" is actually enforced

Two mechanisms, because either alone leaves a hole.

**1. Validate everything before the transaction opens.**
`ProductCsvParser` parses and validates all rows and touches no database. If it
throws, no connection has even been borrowed from the pool. This covers every
rule the application can decide on its own: format, required fields, ranges,
unknown currencies, and skus that repeat *within* the file.

**2. Let the transaction cover what validation cannot decide.**
Whether a sku already exists in the table is not knowable from the file. A
`SELECT ... WHERE sku IN (...)` pre-check would be a read-modify-write with no
guard — a concurrent import could insert between the check and the write. So
there is no pre-check. `product_sku_key` is a unique constraint, the batch insert
runs inside one transaction, and a violation anywhere in any batch rolls back the
entire import. The `DuplicateKeyException` is translated into a 409 with a code,
never surfaced as a 500 or as a raw constraint message.

The transaction is deliberately narrow. Parsing a 10 MB file, hashing it, and
building 50,000 row objects all happen *outside* it; `ProductImportWriter` is a
separate bean precisely so the boundary is visible and starts as late as possible.

## Retries

An upload of 50,000 rows is exactly the request a client times out on and retries,
and a proxy may retry it without the client knowing. "It won't be called twice" is
not available, so the second call is designed:

- `Idempotency-Key` is required, stored on `product_import` with a unique constraint.
- Same key + same file (SHA-256 of the bytes) → 200 with the original `importId`,
  nothing written. The caller can tell this from a fresh import via `replayed`.
- Same key + *different* file → 409 `idempotency_key_reused`. That is a client bug,
  not a retry, and guessing which one it meant is worse than refusing.
- Two identical requests racing → the unique key makes one of them lose cleanly and
  return 409 `idempotency_key_in_progress`, not a 500. Exactly one import commits.

The import record is written in the same transaction as its products, so a committed
`product_import` row always implies its products exist.

## Data access

Rows are inserted with `JdbcTemplate.batchUpdate` in chunks of 1,000 — not one
`INSERT` per row in a loop, which at 50,000 rows is 50,000 round trips inside a
single transaction. There is no query inside the row loop at all; the duplicate-sku
check within the file is a `HashMap`, not a query per row.

The row cap and the multipart size cap exist so the transaction is bounded. An
unbounded import is an unbounded transaction, which is an unbounded lock hold.

## Migration

`V3__product_bulk_import.sql` is expand-only: it creates `product_import` and adds
a nullable `product.import_id`. Nothing existing is altered or dropped, so it is
safe to deploy before the code, and safe to leave in place if the code is rolled
back. The constraints (`unique (sku)`, `price_cents >= 0`, non-blank name) live in
the database rather than only in the parser, because the parser is one writer among
potentially several and application checks race.

## Errors and logging

Response bodies carry a stable `code` callers can branch on and a human `message`.
No exception text, SQL, constraint name, or stack frame reaches a caller — a
malformed-quoting failure becomes `csv_unparseable`, and the detail goes to the log.
Logs record decisions with context (`rejected upload: unsupported content type
image/png`, `product bulk import committed: importId=... rows=...`), not method
entry. No file contents are logged.

## Verification

`ProductCsvParserTest` — unit, no database. Every validation rule, the
all-errors-per-row behaviour, duplicate-within-file naming both lines, the error cap,
and the whole-file rejections (header, empty, row limit, column count).

`ProductBulkImportApiTest` — `@SpringBootTest` against real PostgreSQL via
Testcontainers, because atomic rollback, the unique constraint and the idempotency
key are properties of the database that an in-memory substitute would not prove.
Every rejection test asserts both halves — the status *and* that the tables are
unchanged:

- `rejectsTheWholeFileWhenOneRowIsInvalidAndWritesNothing`
- `leavesProductsFromEarlierImportsUntouchedWhenAFileIsRejected`
- `rejectsTheFileWhenASkuAlreadyExistsAndWritesNothing` — the mid-file conflict case,
  which proves the rollback rather than the pre-validation
- `neverOpensATransactionWhenTheFileIsInvalid` — asserts the repository is untouched
- `treatsARepeatOfTheSameUploadUnderTheSameKeyAsANoOp`
- `rejectsADifferentFileSentUnderAnAlreadyUsedKey`
- `importsOnlyOnceWhenTheSameUploadArrivesTwiceConcurrently`

Run with `./mvnw verify`. These tests have not been executed — there is no project
to run them in (see `user_notes.md`).

## Deliberately not built

Async imports with a polling status endpoint, partial-success mode
(`?on_error=skip`), updating existing products (upsert), and CSV export. Each is a
plausible next request; none is what was asked for, and each changes the response
contract.
