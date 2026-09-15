# Notes: assumptions and uncertainties

## Assumptions I made (no codebase to check against)

- **Stack**: Java 21 + Spring Boot 3, `JdbcTemplate` for the batch write, PostgreSQL, Flyway for
  migrations, JUnit 5 + AssertJ + Testcontainers for tests. Chosen because the surrounding repo's
  skills are Java-oriented. If the real service is Node/Python/Go the design carries over
  unchanged; only the syntax moves.
- **A `products` table already exists.** The migration I wrote only adds the unique index on
  `sku` that the all-or-nothing guarantee leans on. If the table doesn't exist, that migration is
  wrong and the create-table needs to come first.
- **Product shape**: `sku, name, description, price, currency, stock, active`. Invented. The real
  column set almost certainly differs and the parser's header contract must be regenerated from it.
- **CSV dialect**: RFC 4180, comma-delimited, UTF-8 (BOM tolerated and stripped), header row
  required and order-insensitive. Excel on a European locale emits semicolon-delimited CSV — if
  these files come from Excel, this is the first thing that will break.
- **Insert-only.** "Bulk inserts them" read literally, so an existing SKU is an error, not an
  update. If the intent was upsert, the validation rule inverts and the `409` path disappears —
  worth confirming before building.
- **Synchronous.** At 50k rows and ~10MB the import completes inside a normal request timeout. If
  real files are larger, this becomes a job endpoint: `202 Accepted` + a status resource, and the
  all-or-nothing guarantee moves to the job's transaction.
- **Single-node deployment for the transaction semantics.** Nothing here works differently under
  multiple app instances, but it does assume one database, not a sharded write path.

## Things I'm genuinely unsure about

- **The 50k row / 10MB ceiling is a guess.** It's the number that decides between the in-memory
  design I wrote and the staging-table design I described but didn't build. If real files are
  hundreds of MB, I built the wrong one.
- **Whether errors should be capped.** I cap the response at 100 errors with an
  `errorsTruncated` flag, on the theory that a file with 4,000 bad rows has one systemic problem
  and 100 examples is enough to find it. A UI that wants to render an annotated spreadsheet would
  want all of them.
- **Minor-unit conversion assumes 2 decimal places for every currency.** Wrong for JPY (0) and
  KWD (3). Fine for single-currency; needs `Currency.getDefaultFractionDigits()` before a second
  currency is onboarded. I left it simple rather than half-correct.
- **Idempotency is sketched, not finished.** The header is accepted and the `TODO` marks where the
  store goes. Retention policy for keys is a product decision I didn't want to invent.
- **Batch size 1,000** is a conventional default, not a measured one. Worth profiling against the
  real row width; for wide rows a smaller batch often wins.
- **Duplicate-SKU-within-file** is reported against the *later* line, referencing the earlier one.
  Some teams prefer flagging both. Cosmetic, but pick one deliberately.

## What I did not build

- Async/job-based import for large files.
- Upsert mode.
- Dry-run / validate-only mode (`?dryRun=true` would be ~5 lines and is frequently the first thing
  asked for after shipping this — worth considering now).
- Per-tenant scoping. If products are tenant-scoped, the unique constraint must be
  `(tenant_id, sku)` and every query in the repository needs the tenant predicate. This is the
  kind of omission that is very expensive to retrofit, so it's the first question I'd ask.
- Rate limiting on the endpoint. Bulk import is an expensive operation reachable by any holder of
  the write role.

## Code status

The code is illustrative and has not been compiled or run — there's no project to build it in.
Imports, the Flyway version number, package names, and the `products` column list all need
reconciling with the real repository.
