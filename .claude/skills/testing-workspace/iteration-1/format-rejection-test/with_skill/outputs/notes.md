# Notes — proving "unsupported formats return 415 before any storage write"

## Selector

```yaml
verified_by:
  - cmd: test-integration
    selector: AvatarUploadIT#rejectsUnsupportedFormatBeforeWriting
```

Runnable alone: `./mvnw test -Dtest='AvatarUploadIT#rejectsUnsupportedFormatBeforeWriting'`
(or `./gradlew test --tests 'com.example.avatar.AvatarUploadIT.rejectsUnsupportedFormatBeforeWriting'`).

The name states condition and outcome, so a failure report is diagnosable without opening
the file.

## Why integration, not unit

The criterion contains a claim about the storage boundary. A unit test with a mocked
`BlobStore` asserting `verify(blobStore, never()).put(...)` proves only that one named method
wasn't called — it cannot see a write that goes through a different path (a temp-file spool, a
multipart-upload initiate, a metadata row inserted before validation). The mock encodes the
assumption under test. So the test runs the real app against a real object store and a real
Postgres, both from Testcontainers.

## The "before" in "before any storage write"

This is the part most versions of this test get wrong. Listing bucket contents after a
rejection is satisfied by two very different implementations:

1. validate first, never write — what the criterion asks for;
2. write, hit validation later, delete on the error path — a criterion violation, and one
   with real consequences (billing, replication, virus-scan triggers, audit noise).

A plain `listObjects` call reports both as empty. So the bucket is created with **versioning
enabled**: a write-then-delete leaves a noncurrent `ObjectVersion` plus a `DeleteMarkerEntry`.
The test asserts both collections are empty, which separates case 2 from case 1.

## Two storage surfaces, both asserted

"Storage" for an upload endpoint is usually two things: the blob and its metadata row. The
test asserts on both, since writing the DB row first and the object second is a common
ordering, and only checking the bucket would miss it.

## The control test

`storesSupportedFormat` exists to keep the main test falsifiable. Every assertion in
`rejectsUnsupportedFormatBeforeWriting` is an "is empty" assertion, and those pass trivially
against a wrong bucket name, a wrong table name, a storage config the app never picked up, or
an endpoint that 415s everything. The control drives a real write through the same
assertions and fails if any of that wiring is wrong. It is also a second acceptance criterion
in its own right, so it is not dead weight.

## Isolation

`@BeforeEach` drops and recreates the bucket (deleting versions and delete markers first,
which versioning makes necessary) and truncates `avatars`. Containers are static and shared
for speed; per-test state is not. These tests do not depend on ordering and can each be run
alone.

Note the consequence: these two tests must not run **in parallel with each other**, since
they share one bucket. If the suite enables JUnit parallel execution, mark the class
`@Execution(SAME_THREAD)` or give each test its own bucket name.

## Determinism

No sleeps, no wall-clock or timezone dependency, no network beyond the containers, no
iteration-order assumptions (both storage assertions are on emptiness/size). Testcontainers
waits on container readiness rather than a fixed delay.

## Payload choice

The rejected payload carries a valid TIFF magic number (`II*\0`). If the test sent random
bytes, a 415 could come from "unparseable" rather than "parseable but unsupported", and the
test would pass against an implementation that accepts TIFF. The declared part content type
(`image/tiff`) and the bytes agree, so the rejection cannot be attributed to a mismatch
between them either.

## Not tested here

- Which formats are supported (a separate, parameterized criterion).
- The error body shape — unless a criterion names it, asserting on it just breaks on harmless
  copy edits.
- Framework multipart handling.
