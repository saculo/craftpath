# Profile edit form with per-field server validation errors

## The actual problem

"People lose everything they typed when it fails" is almost never a validation
problem — it's a state-ownership problem. It happens when one of these is true:

1. The form's values are derived from the server response / query cache, so a
   failed mutation re-renders the form from the last known-good profile.
2. The failure path resets the form (`reset()`, `key` change, unmount of the
   form while an error screen shows, a redirect, or a full page re-fetch).
3. Errors and values are stored in the same object and the error handler
   replaces the whole object.

So the fix isn't "display errors nicer" — it's: **the form's draft values are
local state owned by the form, and a failed submit is allowed to touch only the
error state.** Once that holds, per-field error display is easy.

## Shape of the solution

Three files, deliberately layered:

| File | Responsibility |
| --- | --- |
| `api.ts` | Talk to the endpoint; normalise every error envelope into one type |
| `useProfileForm.ts` | Own draft values + errors + submit status |
| `ProfileForm.tsx` | Render inputs, errors, and the accessibility wiring |

### 1. Normalise the error envelope at the boundary (`api.ts`)

The component should never branch on wire format. `parseErrorBody` accepts the
three shapes backends usually emit —

```
{ errors: { email: ["is invalid"] } }
{ errors: { bio: "is too long" } }
{ errors: [{ field: "email", message: "is invalid" }] }
```

— and produces one `ApiValidationError { fieldErrors, formErrors }`. Two details
that matter in practice:

- **Errors for fields the form doesn't render are promoted to form-level**,
  not dropped. Silently dropping them is how you get a save that fails with no
  visible reason.
- **Non-validation failures are a different class** (`ApiRequestError`). A 500
  or a dead network is not "your email is wrong" and shouldn't decorate a field.

### 2. Separate state slices (`useProfileForm.ts`)

```ts
const [values, setValues] = useState(initialValues);   // never touched on failure
const [fieldErrors, setFieldErrors] = useState({});
const [formErrors, setFormErrors] = useState([]);
const [status, setStatus] = useState('idle');
```

The catch block writes only to `fieldErrors` / `formErrors` / `status`. There is
no code path in the hook that resets `values` on failure — that's the whole fix,
and `ProfileForm.test.tsx` has a test whose only job is to hold that line.

Other decisions in the hook:

- **Errors are replaced, not merged, per submit.** If the server stops
  complaining about `name`, that message must disappear; merging leaves stale
  errors that the user can't clear.
- **Editing a field clears that field's error.** The message described the
  *previous* value. Leaving it up while the user fixes it makes the form feel
  broken. It comes back on the next submit if the server still objects.
- **`requestId` ref guards out-of-order responses**, so a slow first request
  can't land after a fast second one and restore errors the user already fixed.
- **The submit button re-enables after failure.** Sounds obvious; a surprising
  number of forms leave `isSubmitting` true on the error path and the user's only
  recourse is to reload — which is another way to lose everything typed.

### 3. Rendering and accessibility (`ProfileForm.tsx`)

- Each error is a `<p id="profile-<field>-error">` referenced by the input's
  `aria-describedby`, with `aria-invalid` on the input. That's what makes the
  message reachable by a screen reader instead of being decorative red text.
- Form-level errors render in a `role="alert"` region so they're announced.
- **Focus moves to the first field with an error** after a failed submit. On a
  short form this is a nicety; on a long one it's the difference between "the
  save did nothing" and "oh, the email is wrong".
- Success is a `role="status"` polite live region — announced without stealing
  focus.
- `noValidate` on the form: the browser's native bubbles would compete with the
  server messages and use different wording. One error system, not two.
- The bio character counter is `aria-describedby`'d as a hint, so the user can
  see they're over the limit before submitting.

## What I deliberately didn't do

- **No client-side mirror of the server's rules.** Duplicating "email must be
  valid" in the UI means two sources of truth that drift. Server validation is
  the contract; the client's job is to display it well. (Cheap format hints —
  the counter — are fine.)
- **No form library.** For three fields, `useState` plus a hook is less code
  than configuring react-hook-form, and it makes the state ownership visible,
  which is the thing that was broken. If the form grows to 15 fields with
  cross-field rules, react-hook-form's `setError` maps onto this design directly
  — the `parseErrorBody` boundary stays as-is.

## Tests

`ProfileForm.test.tsx` covers behaviour, not implementation — queries are by
label and role, so a markup refactor doesn't break them:

- values survive a validation failure (the regression test for the reported bug)
- each server error lands on its own field, with `aria-invalid` + accessible description
- untouched fields stay clean
- focus moves to the first invalid field
- editing a field clears its error
- a second submit replaces stale errors rather than accumulating
- non-field failures (500 / network) show a form-level alert and keep input
- retry works after failure; button disabled only while in flight
- success clears errors and confirms

`api.test.ts` covers the envelope parsing: all three shapes, unknown fields
promoted to form-level, garbage bodies falling back to a generic message.

## If the real codebase uses React Query / SWR

The same rule applies, stated in their terms: the mutation's cache entry is not
the form's state. Seed local state from the query once, submit via the mutation,
and on `onError` write only into error state. Never render inputs directly from
`data`, and don't invalidate/refetch the profile query on the error path —
that's the most common source of exactly this bug.
