# For you — assumptions and open questions

You gave me the criterion, JUnit 5, and Testcontainers. Everything else below I had to invent, so
please check these before dropping the file in.

## Assumptions I made about your stack

- **Spring Boot** web stack, tested with `@SpringBootTest(webEnvironment = RANDOM_PORT)` +
  `TestRestTemplate`. If you're on Quarkus/Micronaut/Jakarta, the container wiring and the assertions
  survive; the HTTP call and property injection don't.
- **Object storage is S3-compatible**, tested against MinIO via `MinIOContainer` and the AWS SDK v2
  `S3Client`. If storage is actually a filesystem volume, Azure Blob, or GCS, swap
  `assertNothingWasEverWrittenToStorage()` — the *idea* (assert no write ever became visible, not
  just that nothing is there now) is the part worth keeping.
- **Postgres** for upload metadata, in a table called `documents`.
- **AssertJ** is on the test classpath. Say the word if you're on Hamcrest and I'll convert.
- **The endpoint is `POST /api/documents`**, multipart, field name `file`.

All of the above are concentrated in constants and helpers at the top/bottom of the class, so
retargeting is mostly a find-and-replace rather than a rewrite.

## Things I'd want your answer on

1. **Does the service sniff file content, or trust the declared `Content-Type`?** If it only reads
   the header, `contentTypeSpoofedAsSupportedIsStillRejectedWithoutStorageWrite` will fail — and
   that's arguably a real finding about the criterion rather than a broken test. Worth a
   conversation before you delete it.
2. **Does the upload path use S3 multipart uploads for large files?** If so, an initiated-then-
   aborted multipart leaves no version and no delete marker, so my check has a blind spot. Tell me
   and I'll add a `listMultipartUploads` assertion.
3. **Is bucket versioning acceptable in the test environment?** It's the mechanism that lets this
   test distinguish "never wrote" from "wrote then cleaned up". If your real buckets aren't
   versioned that's fine — this is test-only — but if something in the app asserts on versioning
   config it could interfere.
4. **What's the actual list of unsupported formats?** I picked five plausible ones
   (`application/octet-stream`, `image/svg+xml`, `text/html`, `application/zip`, `image/tiff`).
   Replace with whatever your allow-list actually excludes; SVG and HTML are in there because
   they're the ones that tend to be accepted by accident and cause XSS problems.
5. **What's the success status — 201 or 200?** The control test accepts either, which is slightly
   loose on purpose. Tighten it once you tell me.

## The one judgement call worth flagging

The word **"before"** in your criterion cannot be fully proven from outside the process. I chose to
approximate it with versioned-bucket evidence (no version, no delete marker) rather than mocking the
storage client, because mocking would have thrown away the Testcontainers realism you already paid
for. If your team wants literal ordering proof, the complement is a narrow unit test with a spied
storage port asserting `verify(storage, never()).put(any())` — that pair (unit for ordering, this IT
for reality) is stronger than either alone. Happy to write the unit half too.

## Not compiled

There's no codebase here, so this has never been run through a compiler. Expect small import or
signature adjustments on first build.
