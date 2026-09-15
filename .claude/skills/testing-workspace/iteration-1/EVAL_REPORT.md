# testing — iteration 1 eval report

Graded 2026-09-13 against the assertions in each case's `eval_metadata.json`.
Grading is by inspection of delivered artifacts; nothing was executed.

> **Scope change since this report was written.** The `testing` skill has been
> narrowed to end-to-end tests, level strategy, and suite health; unit and
> integration tests moved to `backend` / `frontend`, which now own writing them
> test-first. **`format-rejection-test` has been reassigned to `backend`**
> (see `format-rejection-test/REASSIGNED.md`). Its result below stays attributed
> to the *old* testing skill that was loaded when it ran — it is not a backend
> baseline. Iteration 2 replaces it with two new cases scoped to the narrower
> remit (e2e-worth-writing judgment; pushing assertions down a level).
>
> On the current scope, only `flaky-suite-diagnosis` counts: **5/6 vs 6/6.**

**Result as run in iteration 1: 9/12 vs 12/12. Consistent gain across both cases.**

| Case | without_skill | with_skill | Δ |
|---|---|---|---|
| flaky-suite-diagnosis | 5/6 | 6/6 | +1 |
| format-rejection-test | 4/6 | 6/6 | **+2** |
| **Total** | **9/12** | **12/12** | **+3** |

---

## flaky-suite-diagnosis (eval_id 10)

| # | Assertion | without | with |
|---|---|---|---|
| A1 | Treats flakiness as a defect, not something retries remedy | ✅ | ✅ |
| A2 | Names ≥3 concrete causes | ✅ | ✅ |
| A3 | Explains why automatic retry makes it worse by masking failures | ⚠️ | ✅ |
| A4 | Concrete first step for identifying which tests are flaky | ✅ | ✅ |
| A5 | Addresses test independence and shared mutable fixtures | ✅ | ✅ |
| A6 | A test that cannot be made deterministic is a known gap, not retried | ✅ | ✅ |

Both are good answers. Both lead with "measure, don't fix", both name six or
more concrete causes with shared mutable state first, both propose JUnit XML
collection as the first step, both quarantine with an owner, a ticket, an expiry
and a hard cap.

**A3 is the gap, and it is a specific one.** The assertion is about *automatic
retry logic* — a CI setting. `without_skill` writes extensively and well about
the *human* re-run habit (*"people re-run because the suite has taught them that
red doesn't mean broken"*) but never addresses configured auto-retry at all. It
never asks whether the CI is already retrying. `with_skill` makes it step zero:

> "If CI already auto-retries anything, note it. Auto-retry doesn't just hide
> failures, it corrupts your baseline — your real flake rate is higher than 20%
> and you have no idea by how much."

and states the rule directly: *"fix the cause, never add a retry. A retry
converts a real signal into a slightly slower green."* Scored as a partial for
`without_skill` rather than a fail, since it argues the same point about manual
re-runs — but it misses that the tooling may already be doing it invisibly,
which is the practical form of the problem.

**A6 is stronger in `with_skill` than the score shows.** `without_skill` handles
it via quarantine policy (delete after 30 days if nobody looks). `with_skill`
states the exception explicitly: *"a genuinely non-deterministic external
dependency you don't control — and that should be declared a known gap in
writing, not quietly papered over."*

`with_skill`'s distinctive contribution is the **repeat-run job**: run the full
suite 10× nightly against an unchanged known-green commit, so every failure is a
flake by definition with zero ambiguity. It also offers four discriminating
experiments in a table mapping each run to the cause it implicates (serial →
shared state; random order → order dependence; odd TZ → clock assumptions;
blocked egress → real network calls). `without_skill` describes classification
by cause but does not give experiments designed to discriminate between them.

`without_skill` is better on one thing: the compounding-reliability arithmetic
(500 tests at 99.9% → 61% suite pass rate) is a more persuasive way to explain
why "each test is basically fine" and "the suite fails constantly" are both
true.

## format-rejection-test (eval_id 9)

| # | Assertion | without | with |
|---|---|---|---|
| A1 | Exercises a real storage boundary rather than mocking it away | ✅ | ✅ |
| A2 | Asserts the 415 response status | ✅ | ✅ |
| A3 | Separately asserts nothing was written to storage | ✅ | ✅ |
| A4 | Test name states condition and expected outcome | ✅ | ✅ |
| A5 | Mentions confirming the test fails against a broken implementation | ❌ | ✅ |
| A6 | Runnable on its own as a named selector, not only as a suite | ❌ | ✅ |

**Both runs solve the hard part of this problem identically, and well.** Both
recognise that "before any storage write" is not provable by listing bucket
contents afterwards, because a write-then-delete implementation looks identical
to a never-wrote one. Both enable **bucket versioning** in MinIO and assert that
both `ObjectVersion` and `DeleteMarkerEntry` collections are empty, converting
"nothing is there now" into "nothing was ever there". Both add a control test
(`supportedFormatIsStored` / `storesSupportedFormat`) so the emptiness
assertions cannot pass vacuously. Both assert the metadata row as well as the
blob. This is the same good answer arrived at twice.

The two failures are both about **the verification loop around the test**, not
the test.

**A5.** `without_skill` reasons carefully about vacuity — its control test is
justified as preventing "green-by-vacuity" — but never says to break the
implementation and watch the test fail. `with_skill` does, and is specific about
the two independent ways it must fail:

> "(1) make the endpoint write the blob before validating, confirm
> `rejectsUnsupportedFormatBeforeWriting` fails on the delete-marker assertion;
> (2) change the status to 400, confirm it fails on the status assertion. Both
> should fail. If either passes, the test is lying."

It also flags that it could not do this itself and that the control test is a
weaker substitute — an honest limitation rather than a claim.

**A6.** `without_skill` never gives a run command. The test is a normal JUnit
method so it is runnable in principle, but the assertion asks for the selector
to be established and it is not. `with_skill` opens `notes.md` with it:

```
./mvnw test -Dtest='AvatarUploadIT#rejectsUnsupportedFormatBeforeWriting'
./gradlew test --tests 'com.example.avatar.AvatarUploadIT.rejectsUnsupportedFormatBeforeWriting'
```

`with_skill` adds two things neither assertion covers: a note that the two tests
share a bucket and must not run in parallel (`@Execution(SAME_THREAD)`, or a
per-test bucket), and a warning that if the framework rejects the media type at
the HTTP layer before the handler runs, *"the test passes for a reason that has
nothing to do with your validation code, and would keep passing if that code
were deleted."*

`without_skill` covers more surface — five unsupported formats via
`@ParameterizedTest` plus a content-type-spoofing case sending `MZ` bytes under
a declared `image/png`, which is the case most likely to actually violate the
criterion. That breadth is real and unrewarded by these assertions.

---

## Reading

Both failures in `format-rejection-test` are the same failure: **the baseline
writes a good test and stops, without establishing how anyone knows the test
works.** Naming a runnable selector and confirming the test fails against a
broken implementation are both about making the test trustworthy rather than
merely present — and both are exactly what this skill claims to be for ("a
criterion without a real test is a criterion that proves nothing").

That is a more useful signal than a score gap, because the two runs produced
near-identical *tests*. The skill is not making the model write better
assertions here; it is making the model close the loop around them.

**Recommended next actions**

1. Note a file-encoding artifact: `without_skill/outputs/UnsupportedFormatRejectionIT.java`
   contains raw non-UTF-8 bytes (an embedded `MZ` executable header used as a
   test payload), so `file(1)` reports it as `data` and plain `grep` treats it as
   binary. Not a defect in the output, but it will break naive harness tooling —
   grading scripts should read with an explicit encoding or use `grep -a`.
2. Add a case where mocking the boundary is the *right* call, to check the skill
   does not over-apply "use a real boundary".
3. A5 and A6 are mechanically checkable (does the text contain a run command?
   does it mention breaking the implementation?) and could be scripted.
