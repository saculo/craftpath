# Profile edit form: per-field server errors without losing the draft

## The actual problem

Two things are tangled together in "people lose everything they typed":

1. **The draft is being thrown away on failure.** Local form state survives a
   failed request by itself, so if your form loses data, something is actively
   resetting it — a parent pushing server values back in on re-render, a `key`
   change, a route revalidation, or a `reset()` on the error path.
2. **The API's per-field errors have nowhere to go.** A 422 body with a map of
   field → message gets rendered as one generic "Something went wrong", so even
   when the data survives, the user has to guess which field to fix.

The design below fixes both, and makes the first one structurally impossible
rather than a thing to remember.

## Shape

Three pieces, split by responsibility:

| File | Responsibility |
|---|---|
| `profileApi.ts` | Talk to the server; turn whatever it returns into one error shape |
| `useProfileForm.ts` | Own the draft and the submit outcome; decide nothing about markup |
| `ProfileForm.tsx` | Render what it is given, report events upward |

`ProfileFormView` is exported separately from `ProfileForm` so the rendering can
be tested — and reused in a wizard or a modal — without dragging a fetch along.

## The rule that fixes the data loss

In `useProfileForm`, the draft is seeded **once**:

```ts
const seed = useRef(initialProfile);
const [values, setValues] = useState<Profile>(seed.current);
```

After that, `setValues` is called from exactly one place: the user typing. Not
on success, not on 422, not on a network error, and — because the seed lives in
a ref — not when a parent re-renders with a fresh `initialProfile` object. A
failed submit sets errors and status; it never touches `values`.

That is the whole fix. The test named *"keeps everything the user typed when the
API rejects the submit"* fails the moment someone reintroduces a reset.

(If your current form is being *unmounted* on failure, this hook cannot save it —
see `user_notes.md`, that has to be fixed at the call site.)

## Mapping the server's errors

`normaliseValidationErrors` is a single adapter that converts the API's payload
into `{ fieldErrors, formErrors }`. Two things matter about it:

- **It never swallows a message.** An error for a field this form does not
  render (`avatar_url`), or a body in a shape we do not recognise, becomes a
  form-level message in the summary. The failure mode to avoid is a form that
  refuses to save while showing nothing wrong — the user is then stuck with no
  path forward at all.
- **It is the only place that knows the payload shape.** When the API changes,
  one function and four small tests change.

## What the user experiences on a failed save

1. The submit button is disabled and reads "Saving…" while in flight, so a
   double click is not two writes.
2. On a 422, an error summary appears at the top with `role="alert"` — announced
   to screen readers — listing each problem as a link to its field, plus the
   explicit reassurance that nothing they typed was lost.
3. Focus moves to the first invalid field, in **visual** order, not JSON key
   order.
4. Each message also appears next to its own input, wired through
   `aria-describedby`, with `aria-invalid` on the control, and prefixed with
   "Error:" and an icon so colour is not the only signal.
5. As they fix a field, that field's message clears on the first keystroke;
   other fields keep theirs. Nothing is validated on keystroke before a submit —
   validating while someone is still typing an email is punishment.
6. Save again. On success, a `role="status"` line confirms it.

Focus is moved **once per failed submit**, keyed on an incrementing
`failureToken` rather than on the errors object. Keying on the errors would
re-steal focus on unrelated re-renders, producing the cursor-jumping bug that is
worse than the problem it solves.

## The four states

| State | What is shown |
|---|---|
| Populated | The form, seeded with the current profile |
| Loading | Button reads "Saving…" and is disabled; `aria-busy` on the form; status line announces it |
| Error | Summary at top + per-field messages + the draft, intact, retryable without reload |
| Empty | Not applicable — a profile always has fields; blank values are a valid draft, not an empty state |

The status line reserves its height (`min-height`) so the layout does not jump
under the cursor when the result arrives.

## Tests

`ProfileForm.test.tsx`, all driven the way a user drives the form — queries by
label and accessible name, never by class or component internals:

- keeps everything the user typed when the API rejects the submit ← **the one that matters**
- shows each API message next to the field it concerns (asserted via accessible description)
- announces the failure and moves focus to the first invalid field
- clears a field error as soon as that field is edited, leaving the others
- surfaces errors for fields this form does not render instead of dropping them
- disables the submit button while in flight so a double click saves once
- reports a non-validation failure as retryable and keeps the draft
- confirms a successful save in a live region
- is operable with the keyboard alone
- four unit tests on `normaliseValidationErrors` covering both payload shapes,
  unknown fields, and an unrecognisable body

Each is written so that breaking the behaviour breaks the test: delete the
`failureToken` guard and the focus test fails; re-seed `values` from the response
and the first test fails; drop unknown-field errors and the fifth fails.

## Running it

```
npx vitest run ProfileForm.test.tsx
```

Then tab through the form once with the mouse untouched, submit an email you
know is taken, and confirm the summary is read out and the bio is still there.
