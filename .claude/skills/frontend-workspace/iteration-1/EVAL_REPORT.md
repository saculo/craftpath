# frontend — iteration 1 eval report

Graded 2026-09-13 against the assertions in each case's `eval_metadata.json`.
Grading is by inspection of delivered artifacts; nothing was executed.

**Result: 10/12 vs 12/12. One clear win, one tie.**

| Case | without_skill | with_skill | Δ |
|---|---|---|---|
| missing-states | 4/6 | 6/6 | **+2** |
| profile-form-errors | 6/6 | 6/6 | 0 |
| **Total** | **10/12** | **12/12** | **+2** |

---

## missing-states (eval_id 5)

| # | Assertion | without | with |
|---|---|---|---|
| A1 | Implements all four states: loading, empty, error, populated | ❌ | ✅ |
| A2 | Error state renders an actionable message rather than nothing | ✅ | ✅ |
| A3 | Retry path that does not require a full page reload | ✅ | ✅ |
| A4 | Layout stability — content does not jump when data arrives | ✅ | ✅ |
| A5 | Tests locate elements by accessible name, role, or visible text | ⚠️ | ✅ |
| A6 | Empty case handled distinctly from loading | ❌ | ✅ |

**A1 and A6 are the same miss.** `without_skill` builds a four-member union —
`loading | refreshing | success | error` — which is one state richer than asked
on the *request* axis and entirely missing on the *data* axis. There is no empty
branch. `user_notes.md` is honest about it:

> "Is there an empty state? I assumed settings always exist for a logged-in
> user, so there's no 'no data' branch."

That is a reasonable assumption to surface, but the criterion asked for four
states and three were delivered. `with_skill` renders an explicit empty state
for the connected-accounts list — heading, explanation, and a "Connect an
account" action — and tests it (`findByText('No accounts connected')`), with a
sibling test proving the populated case does not render it.

**A5 is the interesting one.** `without_skill` mixes registers: most queries are
`findByRole('alert')` / `getByLabelText(/display name/i)`, but the loading and
populated states are pinned with `getByTestId('settings-skeleton')` and
`queryByTestId('settings-form')`. A `data-testid` is not a CSS class and not
component internals, so this is not a hard failure — but it is a test hook
rather than something a user can perceive, on exactly the two states the bug
report was about. `with_skill` uses zero test ids across 30+ queries; loading is
asserted via `findByRole('status')` and the populated state via
`findByText('Ada Lovelace')`.

Both runs handle A2–A4 well. Both use a discriminated union with a `never`
exhaustiveness check, both use a layout-matching skeleton with
`prefers-reduced-motion`, both suppress retry on 403 and offer sign-in on 401.
`without_skill` has a slightly richer error taxonomy (8 kinds vs 5, including an
explicit `timeout` via `AbortSignal.timeout`), which is genuinely better work
that the assertions do not reward.

## profile-form-errors (eval_id 6)

| # | Assertion | without | with |
|---|---|---|---|
| A1 | Entered values retained when a submit fails | ✅ | ✅ |
| A2 | Per-field server errors displayed adjacent to their fields | ✅ | ✅ |
| A3 | Submit guarded while in flight so a double click cannot double-write | ✅ | ✅ |
| A4 | Every input has a programmatically associated label | ✅ | ✅ |
| A5 | Test covering failed-submit-retains-values | ✅ | ✅ |
| A6 | Validation not fired on every keystroke from the outset | ✅ | ✅ |

A genuine tie, and both are good. Both correctly diagnose the reported bug as
state ownership rather than error display, both normalise the error envelope at
the API boundary, both promote errors for unrendered fields to form-level rather
than dropping them, both clear a field's error on edit, both guard against
out-of-order responses, both query by label and accessible name.

Two things `with_skill` does that `without_skill` does not, neither of which any
assertion asks about:

- Seeds the draft from a `useRef` so a parent re-rendering with a fresh
  `initialProfile` object cannot reset it — making the bug structurally
  impossible rather than merely absent.
- Moves focus once per failed submit keyed on an incrementing `failureToken`
  rather than on the errors object, explicitly to avoid re-stealing focus on
  unrelated re-renders.

`without_skill` moves focus to the first invalid field too, but keys it less
carefully, and adds an `api.test.ts` for envelope parsing that `with_skill`
folds into the component test file.

---

## Reading

The skill's value here shows up precisely where the baseline's blind spot is:
**the state nobody asks about.** Both runs handled loading and error well —
those were named in the prompt. Only the `with_skill` run built the empty state,
which was not named in the prompt but was named in the assertions, and which is
the exact category the skill's own description calls out ("the states that get
skipped — empty, loading, error — are what users actually hit").

The tie on `profile-form-errors` is not a null result. That prompt named its own
failure mode ("people lose everything they typed"), so the baseline had nowhere
to go wrong. Cases where the prompt states the bug will not discriminate; cases
where the prompt states only a symptom will.

**Recommended next actions**

1. Add cases whose prompts describe a symptom rather than a diagnosis — that is
   where this skill separates from baseline.
2. Consider tightening A5 to name `data-testid` explicitly as disallowed, or
   explicitly allowed. As written it is ambiguous and cost a judgment call.
