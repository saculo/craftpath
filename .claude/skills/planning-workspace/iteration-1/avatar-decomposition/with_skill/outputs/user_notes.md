# Notes on the avatar upload breakdown

## Assumptions I made

Everything here is a guess I had to make to write concrete criteria. Any of them
being wrong is cheap to fix now and expensive later.

1. **No codebase to inspect.** I was told not to go looking for one, so I wrote
   against a generic stack: an HTTP backend, a web frontend, a proxy/ingress in
   front, and a pluggable storage adapter. Paths, framework and test-runner
   conventions are invented.
2. **Test selectors are invented names.** `AvatarValidatorTest#...`,
   `AvatarUploadIT#...`, `avatar-upload.spec.ts#...` and the `test-unit` /
   `test-integration` / `test-e2e` / `test-component` / `test-infra` /
   `infra-plan` commands do not exist yet. They are commitments about what will
   exist, and they should be renamed to match your actual suite before anyone
   starts.
3. **5 MB = 5 × 1024 × 1024 bytes**, measured on the raw uploaded bytes, with
   exactly 5 MB accepted and one byte more rejected. Flagged as Q1.
4. **Magic-byte sniffing is the authority**, and a mismatch between declared
   `Content-Type` and sniffed bytes is a rejection rather than a silent
   correction. That is the stricter reading of "reject anything else".
5. **Status codes: 415 for wrong format, 413 for too large, 401 unauthenticated.**
   If your API has a house convention (everything 400 with an error code, say),
   those criteria need rewording.
6. **Upload is authenticated and targets the calling user** (`/users/me/avatar`).
   No admin-uploads-for-another-user path.
7. **Animated WebP is accepted** and **SVG is rejected**. Both flagged as
   questions since either could go the other way.
8. **Storage is asserted via a test double** that records calls. If your
   integration tests hit a real bucket or an emulator, "zero writes" needs a
   different assertion mechanism and T2's criteria should say so.

## Things I was unsure about

- **Whether T1 earns its own task.** A pure validator with no caller is close to
  the "too small — no observable behavior change" line in the planning guidance.
  I kept it separate because it is the piece that makes "before it touches
  storage" a structural property rather than a code-review promise, and because
  its edge cases (truncated files, boundary sizes, lying headers) are far cheaper
  to test as unit tests than through HTTP. If you would rather see one backend
  task, merging T1 into T2 is reasonable — T2 would then have ~8 criteria, which
  is over the sizing guideline, so I would trim rather than merge blindly.
- **Whether T3 really depends on T2.** A frontend built against a stubbed network
  could be done in parallel. I declared the edge because I gave T3 two e2e
  criteria that assert on real server responses. If you want the work
  parallelized, drop those to component-level with a mocked 415 and the edge goes
  away — at the cost of not proving the two sides agree.
- **T4's scope.** An edge body limit is arguably ops hygiene rather than part of
  this feature. I included it because "reject before it touches storage" is a
  resource-exhaustion concern as much as a correctness one, and the app-level cap
  alone still makes a worker read the socket. Easy to cut if you disagree.
- **EXIF stripping.** I put it out of scope, but uploading a phone photo as an
  avatar publishes its GPS coordinates. I would open that as a follow-up rather
  than let it disappear.

## Workarounds

- I could not verify any command name, test-runner syntax, route, or existing
  auth mechanism, so every such detail in `tasks.md` is placeholder-shaped and
  marked as such here rather than presented as fact.
- I wrote no files outside the outputs directory and touched nothing in the
  repository.

## What I would want back from you

The six open questions at the bottom of `tasks.md` (Q1–Q6), plus a yes/no on
whether T1 stays separate and whether T4 belongs in this plan at all. Those four
answers are what would move this from draft to approved.
