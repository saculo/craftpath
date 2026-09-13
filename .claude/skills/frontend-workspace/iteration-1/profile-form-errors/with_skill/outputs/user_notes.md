# Notes, assumptions, and things I guessed at

## Assumptions about your stack

No codebase was available, so this is written as React 18 + TypeScript, tested
with Vitest + React Testing Library + `@testing-library/jest-dom`. Nothing here
depends on those specifics except the syntax — the structure (a hook that owns
the draft, a view that renders what it is given, an adapter that normalises the
API's error shape) ports to Vue, Svelte, or plain forms unchanged.

No form library. For three fields, the interesting work is entirely in mapping
server errors, which React Hook Form / Formik do not do for you — you would
still write the adapter. If you already use one, keep it and reuse
`normaliseValidationErrors` with `setError(field, ...)`.

## Assumptions about your API

I guessed at the error payload. `normaliseValidationErrors` in
`profileApi.ts` handles the two common shapes:

```json
{ "errors": { "email": ["is already taken"] } }
{ "errors": [{ "field": "email", "message": "is already taken" }] }
```

**Check this against a real 422 response before shipping.** If yours differs,
that one function is the only thing that changes; the tests for it at the bottom
of `ProfileForm.test.tsx` are where you would encode the real shape.

I also assumed 422 (and 400) means validation, anything else non-2xx is a
generic failure, and messages are user-facing English fragments like
"is already taken" — hence rendering them as `Email: is already taken`. If your
API returns machine codes (`EMAIL_TAKEN`), add a code → message map in the
adapter rather than showing raw codes.

## Where I took only one message per field

If the API sends several messages for one field, I show the first. A stack of
three messages under one input reads as noise. If yours are meaningfully
different (format vs. uniqueness), change `FieldErrors` to `string[]` and render
a list — the `aria-describedby` wiring already supports it.

## Uncertainties I could not resolve without you

- **Is the real bug actually a remount?** Local state is preserved across a
  failed request automatically, so if your current form loses data, something is
  resetting it: a parent refetching and pushing `initialValues` back in through
  a `useEffect`, a `key` that changes, a route-level revalidation, or an early
  `reset()` on the error path. `useProfileForm` seeds from a ref precisely so no
  parent re-render can clobber the draft — but if the form is being *unmounted*,
  that has to be fixed at the parent. Worth a two-minute look at the call site.
- **Unsaved-changes guard.** Not included. If people can navigate away
  mid-edit, that is a separate (and worthwhile) task.
- **Autosave / drafts in `localStorage`.** Deliberately skipped. It fixes a
  different failure (tab closed) and adds a stale-draft problem.
- **Bio length limit.** I showed the server's message but did not add a client
  counter, because I do not know the real limit. A live character count is the
  cheapest win available if you have one.

## Deliberate workarounds

- `firstErroredField` uses a fixed field order rather than object key order,
  because "first" must mean first on screen, and JSON key order does not.
- The focus effect keys on a `failureToken` counter, not on the errors object.
  Keying on the errors would re-steal focus on unrelated re-renders — the
  classic "cursor jumps while I am fixing the field" bug.
- The `pointerEventsCheck: 0` in the double-click test is there to simulate a
  user clicking a disabled button; without it `user-event` refuses the click and
  the test would pass for the wrong reason.
- Field errors are not individually announced; only the summary is `role="alert"`.
  Two live regions firing for one failure produces overlapping speech.

## Not covered by tests

The `fetch` call in `saveProfile` itself (status-code branching) — worth an MSW
test once you have real fixtures. Everything above it is covered by injecting
`save`.
