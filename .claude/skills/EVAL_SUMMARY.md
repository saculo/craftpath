# Skill eval summary — iteration 1

> **Read with the scope change in mind.** After this grading, the `testing` skill
> was narrowed to end-to-end tests, level strategy and suite health; unit and
> integration tests became the responsibility of `backend` / `frontend`, which
> own writing them test-first (`.claude/rules/tdd.md`). One case moved:
> `format-rejection-test` is now a **backend** case. Its iteration-1 result stays
> attributed to the old testing skill — it is not a backend baseline. Every score
> below is as-run in iteration 1, under the skills as they were then. All five
> `SKILL.md` files have since changed, so iteration 2 is not a like-for-like
> re-run of the `with_skill` arm; the `without_skill` arm is unaffected and
> remains comparable.

Graded 2026-09-13. Five skills, ten cases, twenty runs (`with_skill` and
`without_skill` for each case), scored against the assertions in each case's
`eval_metadata.json`.

**Method:** grading is by inspection of the delivered `outputs/` tree. Nothing
was compiled or executed. An artifact described in prose but absent from the
output tree is scored as not delivered — this rule decided two cases.

Per-skill detail is in `<skill>-workspace/iteration-1/EVAL_REPORT.md`.

---

## Headline

| | without_skill | with_skill |
|---|---|---|
| Assertions passed | **51 / 61 (84%)** | **59 / 61 (97%)** |
| Cases won | 0 | 7 |
| Cases tied | 2 | 2 |
| Cases lost | 1 | 1 |

The skills help, and they help most where the prompt does not already name the
failure mode. The headline number understates the gap in places and overstates
it in others; see "What the scores don't capture".

## By case

| Skill | Case | without | with | Δ |
|---|---|---|---|---|
| backend | duplicate-orders | 6/6 | 4/6 | **−2** |
| backend | csv-bulk-upload | 5/6 | 6/6 | +1 |
| frontend | missing-states | 4/6 | 6/6 | +2 |
| frontend | profile-form-errors | 6/6 | 6/6 | 0 |
| infrastructure | rds-instance-bump | 5/6 | 6/6 | +1 |
| infrastructure | ecr-push-workflow | 6/6 | 6/6 | 0 |
| planning | avatar-decomposition | 5/7 | 7/7 | +2 |
| planning | plan-critique | 5/6 | 6/6 | +1 |
| testing | flaky-suite-diagnosis | 5/6 | 6/6 | +1 |
| testing | format-rejection-test | 4/6 | 6/6 | +2 |

## By skill

| Skill | without | with | Δ | Verdict |
|---|---|---|---|---|
| planning | 10/13 | 13/13 | **+3** | Clearest signal in the suite |
| testing | 9/12 | 12/12 | **+3** | Consistent, same failure mode both cases |
| frontend | 10/12 | 12/12 | +2 | Wins where the prompt states a symptom, not a diagnosis |
| infrastructure | 11/12 | 12/12 | +1 | Ceiling-bound; assertions too easy to discriminate |
| backend | 11/12 | 10/12 | **−1** | One run looks incomplete; do not trust this yet |

---

## The one regression, and why it should not be believed yet

`backend / duplicate-orders` is the only case where `with_skill` scored lower,
and the reason is not a worse answer — it is a **missing half of the
deliverable**. That run produced 16 production classes and two migrations, and
**no test directory and no narrative document at all**. It failed the "test that
submits the same request twice" assertion because there are no tests of any
kind, and failed "names two strategies and picks one" because the alternatives
appear only as passing Javadoc asides.

The production code in that run is arguably the stronger of the two designs
(`ON CONFLICT DO NOTHING` with explicit blocking semantics, an outbox migration,
`Propagation.MANDATORY` to enforce the transaction boundary, the Spring
self-invocation proxy trap called out by name). A run that produces polished
code and then nothing else looks more like a truncated run than a skill effect.

**Re-run this case before treating the −2 as real.** At n=2, one suspect run is
half the evidence for that skill.

## What the scores don't capture

Three places where the grade is a worse summary than the reading:

**Infrastructure is ceiling-bound.** The baseline scored 11/12, so the maximum
possible gain was 1 point. But the two ECR workflows are not equivalent:
`with_skill` pins every action to a full commit SHA, sets
`persist-credentials: false`, scopes `id-token: write` to the one job that needs
it, and adds a job timeout. `without_skill` pins to floating major tags (`@v4`)
— mutable references held by a workflow with ECR write access. The assertion
says "version tag **or** commit SHA", so both pass and the real security
difference is invisible to the score. Meanwhile `without_skill` has the better
IAM documentation. The assertions are measuring the wrong axis.

**Two cases were decided by delivery, not quality.** `backend/csv-bulk-upload`
`without_skill` has a section headed "The test that matters" naming
`rejectsWholeFileAndWritesNothingWhenOneRowIsInvalid` — and the file does not
exist. `backend/duplicate-orders` `with_skill` fails the same way. Both are the
same harness gap: nothing checks that artifacts named in prose exist on disk.

**Ties are not always null results.** `frontend/profile-form-errors` tied at 6/6
because its prompt named its own bug ("people lose everything they typed"),
leaving the baseline nowhere to go wrong. `frontend/missing-states` named only a
symptom ("blank white box… users think it's broken") and the baseline shipped
three of four states, omitting empty entirely. Prompts that state the diagnosis
will not discriminate.

## Where the skills actually earned their keep

A pattern holds across the four skills with positive signal: **the baseline
produces good work and stops one step short of making it verifiable.**

- `planning`: criteria that describe an outcome but bind to no runnable
  selector. `without_skill` declines to name selectors on principle — *"once you
  tell me the stack I can bind each criterion to a concrete test name"* — which
  is defensible and produces an unusable plan.
- `testing`: a well-designed test with no run command and no instruction to
  confirm it fails against a broken implementation. Both runs of
  `format-rejection-test` independently invented the same clever
  versioned-bucket trick to distinguish "never wrote" from "wrote then deleted";
  only one closed the loop around it.
- `frontend`: the state nobody asked about.
- `infrastructure`: the approval gate stated as an implication rather than a
  requirement.

These are all the same shape: the skill is not making the model smarter about
the problem, it is making it finish.

---

## Recommended next actions

**Blocking — do before iteration 2 conclusions:**

1. Re-run `backend/duplicate-orders` with_skill. It is the only regression and
   it looks like a truncated run.
2. Add a harness check that every file named in a solution's file table or
   verification section exists in `outputs/`. This would have caught both
   delivery failures mechanically.

**Assertion quality:**

3. `infrastructure` A1: require immutable SHA pinning, or split it out. As
   written, the strongest difference between the two workflows is unscored.
4. `frontend` missing-states A5: decide explicitly whether `data-testid` counts
   as "component internals". It currently costs a judgment call.
5. `planning` avatar-decomposition A4 asks for *at least one* named test
   identifier; `plan-critique` A5 asks for *every* criterion. Raise A4 to match.

**Coverage:**

6. n=2 per skill is too thin — one anomalous run is half the evidence. Raise the
   case count, especially for `backend`.
7. Add inverse cases that test whether a skill knows when *not* to apply: a
   planning case where the right answer is "keep this as one task", a testing
   case where mocking the boundary is correct.
8. Prefer prompts that state a symptom over prompts that state a diagnosis —
   that is where the skills separate from baseline.

**Automation:**

9. A large share of these assertions are mechanically checkable: title regex for
   `\band\b`, presence of `selector:` on every criterion, presence of an
   out-of-scope block, presence of a run command, whether the text mentions
   breaking the implementation. Scripting those removes the reader from most of
   the grading.
10. Encoding note: `testing-workspace/.../UnsupportedFormatRejectionIT.java`
    contains raw non-UTF-8 bytes (an embedded `MZ` header used as a test
    payload), so `file(1)` reports `data` and plain `grep` treats it as binary.
    Grading scripts must read with an explicit encoding or use `grep -a`.

## Housekeeping

None of `.claude/` is tracked in git — the skills, the eval definitions, all
twenty runs, and these reports are untracked. Worth committing before iteration
2 so the baseline is reproducible.
