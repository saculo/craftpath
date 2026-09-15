# Avatar Upload — Task Breakdown (for review, no code yet)

**Requirement:** Users can upload a profile avatar. Only PNG, JPEG, and WebP are
accepted. Hard cap of 5 MB. Anything that fails those rules must be rejected
*before* the bytes reach storage.

**Status:** Draft for your review. Nothing is implemented. Please confirm or
correct the assumptions in `user_notes.md` before anyone picks up T1.

---

## Summary

| # | Task | Type | Depends on | Size |
|---|------|------|-----------|------|
| T1 | Validation rules module (format + size), pure logic | core | — | S |
| T2 | Streaming size guard — abort past 5 MB without buffering | core | T1 | S |
| T3 | Storage adapter for avatar objects | infra | — | S |
| T4 | `POST /me/avatar` endpoint wiring validation → storage | backend | T1, T2, T3 | M |
| T5 | Persist avatar reference on the user record (+ migration) | backend | T4 | S |
| T6 | Error contract: status codes, machine-readable reasons | backend | T4 | S |
| T7 | Replace/delete semantics for an existing avatar | backend | T5 | S |
| T8 | Upload UI: picker, client pre-check, all states | frontend | T6 | M |
| T9 | Abuse limits + rejection metrics | ops | T4 | S |

T1 and T3 have no dependencies and can start in parallel.

---

## T1 — Validation rules module (format + size)

**What:** A single pure function/class that takes `(declared_content_type,
byte_length, first_N_bytes)` and returns either `Accepted(format)` or
`Rejected(reason_code)`. No I/O, no framework types, no storage.

Format detection is by **magic bytes**, not by the client-declared
`Content-Type` or the filename extension. Those are inputs we may log, but they
never decide the outcome.

- PNG: `89 50 4E 47 0D 0A 1A 0A`
- JPEG: `FF D8 FF`
- WebP: `52 49 46 46 xx xx xx xx 57 45 42 50` (RIFF container + `WEBP` at
  offset 8)

Reject reasons: `UNSUPPORTED_FORMAT`, `TOO_LARGE`, `EMPTY_FILE`,
`CONTENT_TYPE_MISMATCH` (declared type disagrees with sniffed type — see open
question Q3 in the notes; default is to reject).

**Why separate:** This is the whole security boundary of the feature and it is
the easiest thing in the feature to test exhaustively. Keeping it free of HTTP
and storage means the test suite is fast and the rules are reviewable in one
place.

**Acceptance criteria**
1. A valid PNG, JPEG, and WebP fixture each return `Accepted` with the correct
   format.
2. A GIF, a BMP, an SVG, a PDF, a ZIP, and a plain-text file each return
   `Rejected(UNSUPPORTED_FORMAT)`.
3. A file renamed `evil.png` whose bytes are a ZIP is rejected.
4. A valid PNG with `Content-Type: image/gif` is rejected (or accepted — see
   Q3; the test must encode whichever answer you choose).
5. A 5 MB file exactly at the limit is accepted; 5 MB + 1 byte is rejected with
   `TOO_LARGE`.
6. A zero-byte input returns `Rejected(EMPTY_FILE)`, not a crash.
7. Truncated inputs (1 byte, 3 bytes, 11 bytes) return a rejection, never an
   index-out-of-range error.

**Out of scope:** HTTP handling, storage, image decoding, dimensions,
re-encoding, EXIF.

---

## T2 — Streaming size guard

**What:** Enforce the 5 MB cap while the request body is being read, aborting
the read as soon as the running byte count exceeds the limit. The process must
never hold a 500 MB upload in memory or in a temp file waiting for T1 to say
"too large."

Also set the framework-level / reverse-proxy body size limit as a second line
of defence, so an oversized body is cut off even if the handler is bypassed.

**Why separate:** T1 answers "is this file allowed"; T2 answers "how do we
avoid paying for the bytes of a file that isn't". They fail in different ways
and are verified differently — T2's proof is a resource assertion, not a return
value.

**Acceptance criteria**
1. Uploading a 50 MB body returns the over-limit rejection and the connection
   is closed after roughly 5 MB has been read (assert on bytes consumed, not on
   wall-clock).
2. Peak memory / temp-file usage during that request stays bounded — no
   full-body buffering.
3. A 4.9 MB upload still completes normally.
4. The proxy/framework limit is configured and covered by a config test or an
   integration test that bypasses the handler.

---

## T3 — Storage adapter

**What:** A narrow interface — `put(key, stream, contentType, length)`,
`delete(key)`, `urlFor(key)` — with one real implementation plus an in-memory
fake for tests. Key layout: `avatars/{userId}/{uuid}.{ext}`, a fresh key per
upload (never overwrite in place; see T7).

Objects are stored with the **sniffed** content type from T1, not the
client-supplied one, and served with `Content-Disposition` / `X-Content-Type-
Options: nosniff` so a stored object can't be coerced into executing in a
browser.

**Why separate:** No dependency on validation or HTTP, so it can be built in
parallel, and the fake unblocks T4's tests.

**Acceptance criteria**
1. `put` then `urlFor` returns a fetchable object with byte-identical content.
2. Stored object's content type matches the sniffed type.
3. `delete` removes it; a second `delete` of the same key is a no-op, not an
   error.
4. Keys for two uploads by the same user never collide.
5. The in-memory fake satisfies the same contract test suite as the real
   implementation.

---

## T4 — `POST /me/avatar` endpoint

**What:** Authenticated multipart endpoint that reads the body through the T2
guard, runs T1 on the buffered prefix + final length, and only on `Accepted`
hands the bytes to T3. On rejection nothing is written anywhere.

Order of operations is the point of this task: auth → size guard → sniff →
store. Not store-then-check.

**Acceptance criteria**
1. Unauthenticated request → 401, storage untouched.
2. Valid PNG → 2xx, and the storage fake records exactly one `put`.
3. Oversized file → rejection, and the storage fake records **zero** `put`
   calls.
4. Disallowed format → rejection, and the storage fake records **zero** `put`
   calls.
5. A user cannot upload an avatar for a different user id (no user id accepted
   from the request body/path; it comes from the session).
6. Malformed multipart body → 400, not a 500.

---

## T5 — Persist avatar reference on the user

**What:** Migration adding the avatar key/URL column (nullable) to the user
record, plus the write in the upload path. The DB row is only updated after the
storage `put` succeeds.

**Acceptance criteria**
1. Migration applies and rolls back cleanly on an empty and a populated table.
2. Existing users are unaffected and read back with a null avatar.
3. After a successful upload, re-reading the user returns the new avatar
   reference.
4. If storage `put` fails, the user row is left unchanged (inject a failing
   fake).
5. The user profile read endpoint returns the avatar URL (or null).

---

## T6 — Error contract

**What:** Fix the wire format for every rejection so the UI can act on it:
413 for `TOO_LARGE`, 415 for `UNSUPPORTED_FORMAT`, 400 for malformed/empty,
each with a stable `code` string and a human-readable `message`. Document it.

**Why separate:** T8 is written against this contract; pinning it early lets
frontend and backend proceed in parallel and stops the codes from drifting.

**Acceptance criteria**
1. Each rejection path returns its documented status and `code`.
2. No response body leaks a filesystem path, bucket name, or stack trace.
3. Codes are asserted in tests so a rename breaks the build rather than the UI.

---

## T7 — Replace / delete semantics

**What:** Uploading a new avatar points the user at the new key and removes the
previous object. A delete endpoint clears the avatar. Decide and encode what
happens if the old-object delete fails (recommendation: log + continue, leave
it to a sweeper — the user-visible operation should still succeed).

**Acceptance criteria**
1. Second upload: user points at the new key; the old object is gone.
2. A failing delete of the old object does not fail the new upload.
3. `DELETE /me/avatar` clears the reference and removes the object; calling it
   with no avatar set is a no-op success.
4. No orphaned object remains after a normal replace.

---

## T8 — Upload UI

**What:** File picker restricted to the three types, client-side size and type
pre-check for fast feedback, upload progress, and explicit rendering of every
outcome: idle, selected, uploading, success, each server error code, network
failure. The client check is a convenience only — the server check from T1–T4
remains authoritative.

**Acceptance criteria**
1. Picking a 6 MB file shows the size error without issuing a request.
2. Picking a `.gif` shows the type error without issuing a request.
3. A server 413/415 (forced) renders the matching message even when the client
   check passed.
4. Successful upload swaps in the new avatar without a full page reload.
5. Network failure mid-upload shows a retryable error, not a stuck spinner.
6. The control is keyboard-operable and labelled for screen readers; errors are
   announced.

---

## T9 — Abuse limits and rejection metrics

**What:** Per-user rate limit on the upload endpoint, and a counter on
rejections tagged by reason code so a spike in `UNSUPPORTED_FORMAT` is visible.

**Acceptance criteria**
1. Exceeding the configured rate returns 429 with a `Retry-After`.
2. The limit is per user, not global.
3. Each rejection reason increments its own counter; verified in an
   integration test.

---

## Suggested order

1. T1 + T3 in parallel.
2. T2, then T4.
3. T5, T6 (T6 can land alongside T4 as the contract doc).
4. T7, T8, T9 in parallel.

Every task above is meant to be one PR with its own tests that pass without the
later tasks existing.
