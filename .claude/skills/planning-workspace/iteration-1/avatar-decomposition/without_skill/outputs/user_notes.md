# Notes on the avatar breakdown — assumptions and open questions

## Assumptions I made

1. **Language/framework agnostic.** I don't know your stack, so tasks describe
   behaviour and acceptance criteria rather than files or classes. Test
   selectors are left unnamed for the same reason — once you tell me the stack
   I can bind each criterion to a concrete test name.
2. **HTTP multipart upload to your own backend**, not a browser-direct-to-S3
   presigned flow. This matters a lot: with presigned uploads the "reject before
   it touches storage" requirement cannot be met by the backend at all (the
   bytes go straight to the bucket), and the design would have to change to a
   quarantine bucket + validate + promote flow. See Q1.
3. **Users are already authenticated** and there is a session/user id available
   server-side. Avatar is per-user, one at a time.
4. **5 MB means 5 × 1024 × 1024 bytes**, and the limit is inclusive (exactly
   5 MB is accepted). Trivial to flip, but the tests need to say which.
5. **The uploaded bytes are stored as-is.** No re-encoding, no thumbnailing, no
   EXIF stripping, no dimension limits. See Q2 and Q4.
6. **There is an object store** (S3/GCS/MinIO/local disk) reachable from the
   backend, and a relational user table that can take a new nullable column.
7. **Animated WebP is allowed**, since WebP is allowed and I have no rule
   saying otherwise.

## Open questions — I'd like answers before T1 starts

- **Q1. Direct-to-storage uploads?** If any part of your platform uses presigned
  URLs, the whole shape of T2–T4 changes. This is the single question most
  likely to invalidate the plan.
- **Q2. Do you want server-side re-encoding?** Sniffing magic bytes stops the
  obvious attacks, but a file can be a *valid* PNG and still carry a decoder
  exploit or a polyglot payload. Decoding and re-encoding to a canonical image
  is the stronger control, and it also strips EXIF (which includes GPS
  coordinates from phone photos — a real privacy issue for user-supplied
  avatars). I left it out because you didn't ask for it. If you want it, it's
  one more task between T1 and T4 and it changes T3's stored content type.
- **Q3. Content-type mismatch — reject or ignore?** If a client sends
  `Content-Type: image/gif` but the bytes are a valid PNG, do we reject or
  accept-by-sniff? I defaulted to **reject** (stricter, easier to reason about),
  but some clients set content types badly and this can cause support noise.
  T1's AC #4 needs whichever answer you pick.
- **Q4. Dimension / aspect ratio limits?** A 5 MB PNG can be 30,000 × 30,000
  pixels and blow up memory in anything that later decodes it (a decompression
  bomb). If you're not re-encoding, consider at least a max-pixel check. Not in
  the plan currently.
- **Q5. Virus/malware scanning?** Some orgs require it for any user upload. Not
  in the plan.
- **Q6. Serving path** — public bucket URL, signed URL, or proxied through your
  API? This affects T3 (`urlFor`) and whether avatars are cacheable/CDN-fronted.
  I assumed a URL your backend can hand out; I didn't assume it's public.
- **Q7. Rate limit numbers** for T9 — I left them as "configured", no value.

## Things I was unsure about in the decomposition itself

- **T2 might fold into T4** if your framework already gives you a streaming
  body limit for free (many do). I kept it separate because its acceptance
  criteria are resource assertions rather than response assertions, and those
  tend to get dropped when bundled into an endpoint task. If your framework
  handles it with one config line, merge T2 into T4 and keep AC #1 and #3.
- **T6 (error contract) is small** and could be part of T4. I split it because
  T8 is written against it and I wanted the frontend unblocked early. If
  frontend and backend are the same person, merging is fine.
- **T9 is arguably out of scope** for what you asked. I included it because an
  unauthenticated-adjacent upload endpoint with no rate limit is a cheap way to
  fill someone's storage bill, and the rejection metrics are how you'd notice
  the validation working (or not) in production. Drop it if you'd rather ship
  narrow.
- **T7 (replace/delete)** wasn't in your ask either, but "upload an avatar"
  almost always means "upload a *new* avatar" on the second use, and without it
  you accumulate orphaned objects from day one.
- I did **not** include a task for backfilling or migrating any existing avatar
  data, because I assumed there is none.
