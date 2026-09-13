# planning — iteration 1 eval report

Graded 2026-09-13 against the assertions in each case's `eval_metadata.json`.
Grading is by inspection of delivered artifacts; nothing was executed.

**Result: 10/13 vs 13/13. The largest and cleanest gain of any skill in the
suite.**

| Case | without_skill | with_skill | Δ |
|---|---|---|---|
| avatar-decomposition | 5/7 | 7/7 | **+2** |
| plan-critique | 5/6 | 6/6 | +1 |
| **Total** | **10/13** | **13/13** | **+3** |

---

## avatar-decomposition (eval_id 1)

| # | Assertion | without | with |
|---|---|---|---|
| A1 | Breaks the work into more than one task | ✅ | ✅ |
| A2 | No task title joins two behaviors with "and" | ❌ | ✅ |
| A3 | Every criterion states a concrete input and observable outcome | ✅ | ✅ |
| A4 | At least one criterion names a specific test identifier | ❌ | ✅ |
| A5 | Reject-before-storage covered by rejection AND nothing-written | ✅ | ✅ |
| A6 | Explicit out-of-scope section naming assumptions | ⚠️ | ✅ |
| A7 | Stops at the breakdown, does not implement | ✅ | ✅ |

**A4 is the decisive one, and `without_skill` declines it on purpose.**
`user_notes.md` says:

> "Test selectors are left unnamed for the same reason — once you tell me the
> stack I can bind each criterion to a concrete test name."

That is a defensible position and a bad outcome. The whole point of the
criterion is that it names something runnable. `with_skill` commits to
selectors without knowing the stack and says so explicitly — *"Selectors are
commitments about tests that will exist, not claims that they do"* — producing
criteria like:

```yaml
verified_by:
  - cmd: test-integration
    selector: AvatarUploadIT#rejectsOversizedFileBeforeStorage
```

**A2 fails on one title out of nine:** T9 "Abuse limits and rejection metrics"
joins two distinct behaviors. The rest of the `without_skill` titles avoid it,
sometimes by using `+` or `/` instead (T1 "Validation rules module (format +
size)", T7 "Replace / delete semantics") — which is arguably the same joint
wearing a different hat, but the assertion names the word "and".

**A6 is a judgment call scored generously for `without_skill`.** Its assumptions
and open questions are thorough — seven assumptions, seven numbered questions —
but they live in `user_notes.md`, and `tasks.md` carries a per-task "Out of
scope" only on T1. `with_skill` has per-task `out_of_scope` on all four tasks
plus a consolidated "Not in this plan at all" section listing image
normalization, avatar removal, display elsewhere, backfill, and moderation.

Worth noting: `without_skill` produced **nine** tasks to `with_skill`'s **four**,
and its task content is not worse — the magic-byte signatures are spelled out,
the streaming size guard is separated from validation on the grounds that its
proof is a resource assertion rather than a return value, and the storage
adapter gets a contract test shared between the real and fake implementations.
The decomposition is good. The criteria are not bindable.

## plan-critique (eval_id 2)

| # | Assertion | without | with |
|---|---|---|---|
| A1 | Identifies task 1 combines service and UI, should be split | ✅ | ✅ |
| A2 | Identifies "add tests" is not a task but part of every task | ✅ | ✅ |
| A3 | Identifies "deploy it" carries no observable acceptance criteria | ✅ | ✅ |
| A4 | Provides a corrected decomposition, not only objections | ✅ | ✅ |
| A5 | Each corrected task carries criteria tied to a named test or outcome | ❌ | ✅ |
| A6 | Notes each task is independently verifiable | ✅ | ✅ |

Both critiques are strong on A1–A3. Both correctly frame the plan as "phases,
not tasks". `without_skill` has the better single line on why "add tests" fails
— *"Task 1 is now 'done' without tests, so it gets marked done and the team
moves on"* — and a better substantive gap list (it catches the legal
unsubscribe requirement for email, which `with_skill` misses).

**A5 is where it comes apart.** `without_skill`'s corrected decomposition has
16 items across five phases, and roughly a third carry a "Done when…" clause:

> "1.2 Notification domain service — create and persist. […] Done when duplicate
> submissions produce one row."

The rest — 2.1, 2.2, 2.3, 3.1, 4.1, 4.3, 4.4 — are a title and a sentence of
description with no criterion at all. The assertion says *each* task.

`with_skill` produces ten tasks, every one in YAML with `depends_on`,
`out_of_scope`, and 2–4 criteria each carrying a `cmd` and a `selector`
(`NotificationIngestIT#duplicateEventIdIsIgnored`,
`NotificationCutoverIT#flagIsRuntimeReversible`). It also closes with a
self-check table against its own gate and — notably — **marks itself Blocked on
check 1**:

> "Every scenario maps to a criterion | **Blocked** — the requirement scenarios
> don't exist yet; this is the gap to close first"

That is the correct answer to "does this hold up" and neither the prompt nor the
assertions asked for it.

`with_skill` is also the only one of the two to catch that the dependency chain
1→2→3 is narrative rather than real, and that provisioning could go first.

---

## Reading

This is the skill with the clearest, most reproducible signal in the suite, and
the reason is mechanical: **its core discipline produces artifacts you can check
by looking.** Does the title contain "and"? Does the criterion name a selector?
Is there an out-of-scope block? A grader — human or script — can answer those
without judgment.

Both failures in `without_skill` are the same failure in different clothes:
criteria that describe an outcome without binding it to something runnable. That
is exactly what the skill exists to prevent, and it is what the baseline
consistently does not do on its own.

**Recommended next actions**

1. These assertions are mechanically checkable. Write them as a script — title
   regex for `\band\b`, presence of `selector:` on every criterion, presence of
   an out-of-scope key — and the grading for this skill stops needing a reader.
2. Add a case where the correct answer is *"this is one task, don't split it"*.
   Both current cases reward decomposition; neither tests whether the skill
   knows when to stop, and the skill's own description claims it should ("the
   decision to keep it as one task is itself the planning output").
3. A4 currently needs only *one* named test identifier. Raise it to "every
   criterion" to match what `plan-critique`'s A5 already demands.
