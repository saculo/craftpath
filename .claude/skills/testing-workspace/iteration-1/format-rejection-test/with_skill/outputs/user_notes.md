# User notes — assumptions, uncertainties, workarounds

## The one thing to read first

**I could not run this test.** There is no codebase here to run it against, so it has not been
compiled and has never been observed failing or passing. Treat it as a draft you make compile
against your actual app, not as a verified artifact. The skill's own rule — a test believed to
pass and a test observed passing are different things — applies to this file.

## Assumptions I had to make

You told me JUnit 5 and Testcontainers. Everything below I filled in; each is a find-and-replace
away from your reality:

| Assumption | Where | If wrong |
|---|---|---|
| Spring Boot app, `@SpringBootTest` + `TestRestTemplate` | class annotations, `upload()` | Swap for your HTTP client; the assertions are framework-agnostic |
| Endpoint is `POST /avatars`, multipart field `file` | `upload()` | Change the path and part name |
| Storage is S3-compatible; MinIO stands in for it | `MINIO` container, `S3Client` | See "if your storage isn't S3" below |
| Metadata lives in Postgres table `avatars` | `resetStorage()`, both tests | Change table name, or drop the DB assertions if there is no metadata row |
| Success status is `201 Created` | `storesSupportedFormat` | Change to 200 if that's your contract |
| Config property names (`storage.s3.endpoint`, etc.) | `@DynamicPropertySource` | Match your `application.yml` keys |
| Package `com.example.avatar` | line 1 | Rename |
| TIFF is unsupported, PNG is supported | payload helpers | Pick a format pair that's actually on the wrong/right side of your allowlist |

## Uncertainties

- **MinIO bucket versioning.** The whole "was it written and then deleted" argument rests on
  versioning being enabled and honored. MinIO supports it, but pin a recent image (I pinned
  `RELEASE.2024-06-13T22-53-53Z` — bump it) and sanity-check versioning works in your
  environment before relying on the guarantee. Quick check: put an object, delete it, list
  versions, expect a version plus a delete marker.
- **`MinIOContainer` availability.** It landed in Testcontainers 1.19.x. On an older version,
  use `GenericContainer` with the MinIO image and port 9000.
- **Multipart part content type.** Some stacks reject or ignore a per-part `Content-Type`. If
  your endpoint sniffs bytes instead of trusting the header, the declared type in `upload()` is
  inert — harmless, but the test is then really testing byte sniffing.
- **Where the 415 comes from.** If your framework rejects the media type at the HTTP layer
  before your handler runs, the test passes for a reason that has nothing to do with your
  validation code, and would keep passing if that code were deleted. Worth confirming the 415
  originates where you think it does.

## Workarounds for things I could not do

- **I could not watch it fail.** The skill asks you to break the implementation, watch the test
  catch it, then restore. I substituted the `storesSupportedFormat` control test, which catches
  the "assertions are vacuous" failure mode statically. That is weaker. Please do the real
  thing once: (1) make the endpoint write the blob before validating, confirm
  `rejectsUnsupportedFormatBeforeWriting` fails on the delete-marker assertion; (2) change the
  status to 400, confirm it fails on the status assertion. Both should fail. If either passes,
  the test is lying.
- **Non-S3 storage.** If you're on local disk, GCS, or Azure, the delete-marker trick doesn't
  translate directly. Equivalents: filesystem — snapshot the directory tree (including any temp
  spool dir) before and after and compare, or watch it with a `WatchService`; GCS/Azure — both
  have object versioning / soft delete, same idea; last resort — put a recording proxy in front
  of storage and assert no write request was issued, which proves ordering even better but adds
  a moving part.
- **Cleanup cost.** Dropping and recreating the bucket per test is a few hundred ms. Fine for
  two tests; if this class grows, switch to a per-test bucket name instead — that also removes
  the no-parallel caveat in `notes.md`.

## Suggestion

If "returns 415" and "writes nothing" are tracked as separate acceptance criteria in your
backlog, say so — as written they are one test because the ordering claim ("before") only means
something when both are checked in the same run. If they're one criterion, this file is the
whole proof of it.
