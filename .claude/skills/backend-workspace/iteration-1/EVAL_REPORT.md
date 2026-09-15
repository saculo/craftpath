# backend — iteration 1 eval report

Graded 2026-09-13 by reading each `outputs/` tree against the assertions in the
case's `eval_metadata.json`. Grading is by inspection of delivered artifacts.
Nothing was compiled or executed — a claim made in prose but not delivered as a
file is scored as not delivered.

**Result: 10/12 vs 10/12 — no net gain. One clear win, one clear regression.**

| Case | without_skill | with_skill | Δ |
|---|---|---|---|
| duplicate-orders | 6/6 | 4/6 | **−2** |
| csv-bulk-upload | 5/6 | 6/6 | +1 |
| **Total** | **11/12** | **10/12** | **−1** |

---

## duplicate-orders (eval_id 3)

| # | Assertion | without | with |
|---|---|---|---|
| A1 | Names ≥2 idempotency strategies, selects one with reasoning | ✅ | ❌ |
| A2 | States what the endpoint returns on a second identical request | ✅ | ✅ |
| A3 | Caller-supplied key or equivalent, not just a unique index | ✅ | ✅ |
| A4 | Test submitting the same request twice, asserting one order | ✅ | ❌ |
| A5 | Addresses the concurrent-arrival race, not just sequential | ✅ | ✅ |
| A6 | No "it will not be called twice" reasoning | ✅ | ✅ |

**The regression is structural, not stylistic.** The `with_skill` run produced
16 files of production code and two migrations and **no test directory and no
narrative document at all**. `without_skill` delivered `solution.md`,
`user_notes.md`, and two test classes including a 16-thread race test asserting
the business operation executes exactly once.

- A1 fails for `with_skill` because the alternatives appear only as passing
  Javadoc references to "the two-phase variant". Nothing names two strategies
  and chooses between them.
- A4 fails outright — there is no test of any kind.

The production code itself is arguably the better of the two: `ON CONFLICT DO
NOTHING` with an explicit blocking-semantics explanation, an outbox migration,
`Propagation.MANDATORY` on `OrderService.create` to enforce that it runs inside
the claiming transaction, and a separate `IdempotentTransaction` bean with the
self-invocation proxy trap called out. The design is sound; the deliverable is
incomplete.

**Caveat worth resolving before drawing a conclusion:** a run that produces
polished production code and then zero tests and zero prose looks more like a
truncated or interrupted run than like a skill that discourages testing. The
`backend` SKILL.md should be checked for whether it actually pushes the model
toward code-first output, and this case should be re-run before it is counted
as evidence against the skill.

## csv-bulk-upload (eval_id 4)

| # | Assertion | without | with |
|---|---|---|---|
| A1 | All rows validated before any insert (not rollback-dependent) | ✅ | ✅ |
| A2 | Upload bounded by size, row count, or streaming | ✅ | ✅ |
| A3 | Validation errors identify which rows failed and why | ✅ | ✅ |
| A4 | Test asserting nothing was written when a row is invalid | ❌ | ✅ |
| A5 | Error responses expose no exception detail, stack trace, or SQL | ✅ | ✅ |
| A6 | States the transaction boundary used for the insert | ✅ | ✅ |

`without_skill` fails A4 the same way `with_skill` failed it in the other case,
in mirror image: `solution.md` has a section headed "The test that matters"
naming `rejectsWholeFileAndWritesNothingWhenOneRowIsInvalid`, and lists two test
classes in its file table — **but neither file exists in the output tree.** The
test was described, not written.

`with_skill` delivered both test classes. `ProductBulkImportApiTest` runs
against real PostgreSQL via Testcontainers and every rejection test asserts both
halves — the status *and* that the tables are unchanged. It also covers the
mid-file conflict case (`rejectsTheFileWhenASkuAlreadyExistsAndWritesNothing`),
which proves the rollback rather than the pre-validation, and
`neverOpensATransactionWhenTheFileIsInvalid`, which asserts the repository is
untouched via a spy.

Both runs are strong on A1–A3, A5, A6. The difference is entirely delivery of
the verification.

---

## Reading

The two cases fail in opposite directions on the same assertion (A4 / "ship the
test"), which means this skill's eval signal is currently dominated by *whether
the run finished* rather than by anything about the skill. Two cases is not
enough to separate those.

**Recommended next actions**

1. Re-run `duplicate-orders` with_skill before treating the −2 as real.
2. Consider adding an "artifacts described in prose must exist as files" check
   to the harness — it would have caught both failures mechanically.
3. Raise the case count for this skill; at n=2 with one suspect run there is no
   usable signal.
