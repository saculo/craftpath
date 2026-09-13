# Plan: Avatar upload (PNG / JPEG / WebP, 5 MB cap, reject before storage)

**Status: DRAFT — for review. No code should be written until this is approved.**

## Requirement as I understood it

A signed-in user can upload an image to use as their avatar. Only PNG, JPEG and
WebP are accepted. Files above 5 MB are rejected. Anything that fails either
check must be rejected **before a single byte reaches the storage backend** — no
temp object, no "write then delete" cleanup.

Scenarios this plan must cover:

| # | Scenario | Covered by |
|---|----------|-----------|
| S1 | Valid PNG / JPEG / WebP under 5 MB is accepted and becomes the user's avatar | T2-A1, T3-A1 |
| S2 | Unsupported type (e.g. TIFF, PDF, SVG) is rejected, nothing written to storage | T1-A2, T2-A2 |
| S3 | File over 5 MB is rejected, nothing written to storage | T1-A3, T2-A3, T4-A1 |
| S4 | A file lying about its type (`.png` name / `image/png` header, other bytes) is rejected | T1-A1, T2-A2 |
| S5 | The rejection reason is visible to the user, not a generic failure | T3-A2 |
| S6 | An unauthenticated caller cannot upload | T2-A5 |

---

## T1 — Avatar file validator

**Type:** feature · **Priority:** high · **Skills:** `backend`, `testing`
**Depends on:** —

A pure, side-effect-free validator that takes a byte stream plus its declared
content type and returns either `Valid(format)` or a typed rejection
(`UnsupportedFormat`, `TooLarge`). It performs no I/O and knows nothing about
HTTP or storage, which is what makes "rejected before storage" cheap to enforce
later: the endpoint cannot reach the storage call without passing through it.

Format is determined by **magic bytes**, not by filename or by the declared
`Content-Type` header. Declared type is compared to the sniffed type and a
mismatch is a rejection, not a silent correction.

Size is checked against a streaming counter that aborts as soon as the 5 MB
threshold is crossed, so a 2 GB body is never fully buffered.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      A file whose bytes are TIFF but whose declared content type is image/png
      is rejected as UnsupportedFormat; sniffed format wins over declared type.
    verified_by:
      - cmd: test-unit
        selector: AvatarValidatorTest#rejectsDeclaredTypeMismatch
  - id: A2
    text: >
      PNG, JPEG and WebP byte signatures return Valid with the matching format;
      TIFF, PDF, SVG and GIF signatures return UnsupportedFormat.
    verified_by:
      - cmd: test-unit
        selector: AvatarValidatorTest#acceptsOnlySupportedSignatures
  - id: A3
    text: >
      A stream of 5 MB + 1 byte returns TooLarge; exactly 5 MB (5 * 1024 * 1024)
      returns Valid.
    verified_by:
      - cmd: test-unit
        selector: AvatarValidatorTest#enforcesFiveMegabyteBoundary
  - id: A4
    text: >
      Validation of an oversized stream stops reading after at most 5 MB + a
      small constant; the source stream is not drained to completion.
    verified_by:
      - cmd: test-unit
        selector: AvatarValidatorTest#stopsReadingOnceLimitExceeded
  - id: A5
    text: >
      An empty file and a file shorter than the longest magic-byte signature
      return UnsupportedFormat rather than throwing.
    verified_by:
      - cmd: test-unit
        selector: AvatarValidatorTest#rejectsEmptyAndTruncatedInput
```

### Out of scope

- Any HTTP status code mapping — that is T2.
- Image decoding, re-encoding, resizing or EXIF stripping.
- Checking that the image is *decodable*; a file with a valid PNG header and
  corrupt body passes T1. See open question Q3.

---

## T2 — Avatar upload endpoint

**Type:** feature · **Priority:** high · **Skills:** `backend`, `testing`
**Depends on:** T1 (the endpoint calls the validator; it cannot be written first)

`POST /users/me/avatar`, multipart, authenticated. The request body is streamed
through the T1 validator; only on `Valid` is the storage adapter invoked. On
rejection the handler returns before any storage call and the response body
names the reason.

Accept and reject land in the **same** task deliberately: shipping an endpoint
that accepts uploads without enforcement, even for one commit, puts an unguarded
write path on the main branch.

The integration test uses a storage adapter test double that records every call,
so "nothing was written" is asserted directly rather than inferred.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      POST of a 200 KB PNG returns 201 with the avatar URL in the body, and the
      storage double records exactly one write.
    verified_by:
      - cmd: test-integration
        selector: AvatarUploadIT#storesValidPng
  - id: A2
    text: >
      POST of a TIFF returns 415 with error code UNSUPPORTED_FORMAT and the
      storage double records zero calls.
    verified_by:
      - cmd: test-integration
        selector: AvatarUploadIT#rejectsUnsupportedFormatBeforeStorage
  - id: A3
    text: >
      POST of a 6 MB PNG returns 413 with error code FILE_TOO_LARGE and the
      storage double records zero calls.
    verified_by:
      - cmd: test-integration
        selector: AvatarUploadIT#rejectsOversizedFileBeforeStorage
  - id: A4
    text: >
      After a successful upload the authenticated user's profile response
      returns the new avatar URL; after a rejected upload it is unchanged.
    verified_by:
      - cmd: test-integration
        selector: AvatarUploadIT#updatesProfileOnlyOnSuccess
  - id: A5
    text: >
      POST without valid credentials returns 401 and the storage double records
      zero calls, regardless of payload validity.
    verified_by:
      - cmd: test-integration
        selector: AvatarUploadIT#rejectsUnauthenticatedUpload
```

### Out of scope

- Deleting the previously stored avatar object on replacement (see Q5).
- Rate limiting / abuse protection (see Q6).
- CDN or signed-URL delivery of the stored object.
- Any UI — that is T3.

---

## T3 — Avatar upload control in profile settings

**Type:** feature · **Priority:** medium · **Skills:** `frontend`, `testing`
**Depends on:** T2 (A1 and A2 assert against real endpoint responses)

A file picker in profile settings restricted to the three types, with a local
pre-check that gives instant feedback for obviously bad files. The client-side
check is a convenience only — the server remains the authority, and the UI must
correctly surface a server rejection even for a file the client thought was fine.

Explicit states: idle, selected-with-preview, uploading (with progress),
success, rejected-with-reason.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      Selecting a valid JPEG shows a local preview, then on submit shows the
      uploading state and finally the new avatar from the server response.
    verified_by:
      - cmd: test-e2e
        selector: avatar-upload.spec.ts#uploads a valid jpeg end to end
  - id: A2
    text: >
      A server 415 renders the message "That file type isn't supported - use
      PNG, JPEG or WebP" and leaves the previous avatar displayed.
    verified_by:
      - cmd: test-e2e
        selector: avatar-upload.spec.ts#surfaces server format rejection
  - id: A3
    text: >
      Selecting a 6 MB file shows the size error locally and the submit request
      is never sent.
    verified_by:
      - cmd: test-component
        selector: AvatarPicker.test.tsx#blocks oversized file before request
  - id: A4
    text: >
      A network failure mid-upload shows a retry affordance rather than a
      permanent error, and the previous avatar remains displayed.
    verified_by:
      - cmd: test-component
        selector: AvatarPicker.test.tsx#offers retry on network failure
  - id: A5
    text: >
      The control is reachable and operable by keyboard, and the error message
      is announced to screen readers via a live region.
    verified_by:
      - cmd: test-component
        selector: AvatarPicker.test.tsx#announces errors accessibly
```

### Out of scope

- Client-side cropping, rotation or zoom.
- Drag-and-drop (keep the plain file input for this pass).
- Showing the avatar anywhere other than profile settings.

---

## T4 — Edge request-size limit

**Type:** hardening · **Priority:** medium · **Skills:** `infrastructure`
**Depends on:** — (independent of T2; a limit on a not-yet-existing route is
still a correct limit)

The application-level cap in T1/T2 still requires the app to accept and read the
connection. A limit at the reverse proxy / ingress rejects a multi-gigabyte body
at the edge, so a single client cannot tie up application workers.

Set slightly above 5 MB (proposed: 6 MB) so that ordinary oversized files still
reach the app and get the friendly 413 from T2, while pathological bodies are
cut off earlier.

### Acceptance

```yaml
acceptance:
  - id: A1
    text: >
      A 50 MB POST to the avatar route is terminated by the proxy with 413 and
      no corresponding request appears in application access logs.
    verified_by:
      - cmd: test-infra
        selector: ingress_limits_test.sh#rejects_oversized_body_at_edge
  - id: A2
    text: >
      A 4 MB POST passes through the proxy and reaches the application.
    verified_by:
      - cmd: test-infra
        selector: ingress_limits_test.sh#allows_normal_body
  - id: A3
    text: >
      The limit is declared in checked-in configuration, and applying the config
      twice produces no diff on the second run.
    verified_by:
      - cmd: infra-plan
        selector: ingress#no-drift-on-reapply
```

### Out of scope

- Per-user upload quotas or rate limiting.
- WAF rules and content inspection at the edge.

---

## Dependency graph

```
T1 ──▶ T2 ──▶ T3
T4  (independent)
```

Only two edges, both real: T2 calls T1's validator; T3's A1/A2 assert on live
endpoint responses. T4 shares nothing with the others and can be done at any
time, including first.

## Not in this plan at all

Things a reader might reasonably expect here, deliberately excluded:

- **Image normalization** — resizing, thumbnail generation, re-encoding to a
  single format, EXIF/GPS stripping. Worth doing (EXIF stripping especially, it
  is a privacy leak) but it is a separate feature with its own decisions.
- **Avatar removal** — no "remove my avatar" path; only replace-by-upload.
- **Avatar display elsewhere** — comments, headers, member lists keep whatever
  they currently show.
- **Migration/backfill** of existing users.
- **Content moderation** of uploaded imagery.

## Open questions — please answer before approval

These change task boundaries, so I would rather have them settled than guess:

- **Q1** Is 5 MB the raw upload byte count (my assumption) or the stored/encoded
  size after any processing?
- **Q2** Animated WebP: accept, or reject as unsupported? I assumed **accept**,
  since it is still WebP — but if avatars must be static, that is a new criterion
  in T1.
- **Q3** Should we require the image to actually **decode**, not just carry a
  valid header? That means pulling in an image library and is a real cost; I left
  it out of T1.
- **Q4** SVG is explicitly rejected in my plan. Confirming, because it is a
  common "but it's an image" request and it carries script-execution risk.
- **Q5** On replacement, delete the old stored object or keep it? Affects whether
  T2 needs a sixth criterion or gets a T5.
- **Q6** Is there existing rate limiting the endpoint inherits, or does upload
  need its own?
