# Notes on `UnsupportedFormatRejectionIT`

## What the criterion actually asks for

"Unsupported formats return 415 before any storage write" is two claims joined by an ordering word,
and the ordering word is the hard part.

1. **Status is 415.** Easy and exact. Asserted as `HttpStatus.UNSUPPORTED_MEDIA_TYPE`, not
   `is4xxClientError()` — 400 and 422 are the realistic wrong answers here and a loose matcher
   would accept both.
2. **No storage write happened.** Observable.
3. **It happened *before*.** Not directly observable from outside the process without instrumenting
   the storage client.

## How "before" is handled

The honest options were:

- **Spy/mock the storage client and assert `verify(never())`.** Proves ordering precisely, but only
  against a stubbed collaborator — it stops proving anything about the real MinIO/S3 path, which is
  the reason Testcontainers exists in this setup.
- **Count objects after the request.** Cheap, but write-then-compensate passes it: a service that
  streams to storage, then sniffs the content, rejects, and deletes the object would look identical
  to a service that rejected up front. That is precisely the behaviour the criterion exists to
  forbid.
- **Version the bucket and assert zero versions and zero delete markers.** Chosen. A write that was
  later undone leaves an `ObjectVersion` plus a `DeleteMarkerEntry`; both are asserted empty. This
  converts "nothing is there now" into "nothing was ever there", which is as close to *before* as a
  black-box integration test can honestly get.

This is documented in the class Javadoc so the next reader does not "simplify" the versioning setup
away and silently weaken the test.

## Why there is a passing-case test in a rejection test class

`supportedFormatIsStored()` is not scope creep. Every other assertion in the file is of the form
"nothing was written", and all of them would pass against an endpoint that is broken, unwired, or
returns 415 for everything. The control pins the other end: the same bucket and the same table do
receive exactly one object and one row for a supported format. Without it the suite is green-by-
vacuity.

## Why content-type spoofing gets its own test

`contentTypeSpoofedAsSupportedIsStillRejectedWithoutStorageWrite` sends executable bytes under a
declared `image/png`. A service that trusts the declared header rejects on the header alone and
never has an ordering problem; a service that sniffes real content is the one at risk of streaming
to storage first. This case is where the criterion is most likely to actually be violated, so it is
separated from the parameterized batch rather than buried in it.

## Structural choices

- **`@ParameterizedTest` with `@CsvSource`** for the straightforward rejections: five formats, one
  behaviour, distinct names in the report (`{0} ({1}) is rejected...`) so a failure identifies the
  format without opening the file.
- **`IT` suffix**, not `Test` — this starts two containers and is not a unit test; most Surefire/
  Failsafe setups split on that suffix.
- **Static `@Container` fields** so Postgres and MinIO start once for the class, not per test.
  `@BeforeEach` resets state (truncate + purge/recreate versioned bucket) so tests stay order-
  independent despite the shared containers.
- **Real `S3Client` in the test, separate from the application's client.** The test verifies storage
  through its own connection rather than through application code, so a bug in the application's
  storage layer cannot mask itself.
- **AssertJ with `.as(...)` descriptions** on every assertion — a bare `isEmpty()` failure on a
  version listing is unreadable at 2am.
- **Pinned image tags** (`postgres:16-alpine`, a dated MinIO release) rather than `latest`, so the
  suite does not change behaviour on an unrelated day.

## What this test does not prove

- That the 415 response body has any particular shape. If there is a criterion about error payloads
  it needs its own test; folding it in here would give this one two reasons to fail.
- That storage is untouched for *every* unsupported format in existence — only the five listed plus
  the spoofed case. The list should track whatever the service's allow-list actually excludes.
- Anything about concurrent uploads, size limits, or partial/aborted multipart uploads. A multipart
  upload that was initiated and aborted leaves no version; if the service uses multipart for large
  files, a separate assertion on `listMultipartUploads` would be needed.
