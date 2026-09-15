# Sorting out the settings page states

## What's actually wrong

Both symptoms come from the same root cause. State shaped like this:

```ts
const [settings, setSettings] = useState<Settings | null>(null);
const [loading, setLoading] = useState(true);
// ...and often no error state at all
```

...renders `settings && <Form/>`. So:

- **While loading**, nothing renders inside a container that already has padding and a
  background — the "blank white box".
- **On a 500**, the promise rejects, `settings` stays `null`, and if `loading` is
  cleared in a `finally` the page renders *nothing*. There is no error branch to
  render because there is no error state to render it from.

Fixing the symptom (adding a spinner, adding an `{error && <p>}`) leaves the shape
that allows it to recur. So the fix is to change the shape.

## The approach

### 1. Model the request as a discriminated union

`src/hooks/useSettings.ts` returns:

```ts
type AsyncState<T> =
  | { status: 'loading' }
  | { status: 'refreshing'; data: T }
  | { status: 'success'; data: T }
  | { status: 'error'; error: ApiError };
```

Illegal states (loading *and* error, success with no data) stop being representable.
The page `switch`es over `status` with a `never` exhaustiveness check in the default
branch, so if someone adds a fifth state later and forgets to render it, that's a
compile error rather than another blank page.

`refreshing` exists so a retry after a successful load doesn't tear the form out and
flash a skeleton — it keeps content on screen with `aria-busy`.

### 2. Give errors a *type*, not a string

`src/api/settingsApi.ts` throws a typed `ApiError` with a `kind`:
`server | network | timeout | unauthorized | forbidden | notFound | client | parse`.

That's what lets the UI behave differently where behaving the same would be wrong:

| Kind | What the user sees | Retry offered |
|---|---|---|
| `server` (5xx) | "We couldn't load your settings. Something went wrong on our end." | yes |
| `network` | "You're offline. Check your connection." | yes |
| `timeout` | "This is taking longer than expected." | yes |
| `unauthorized` | "Your session has expired." + a **Sign in** link | no |
| `forbidden` | "You don't have access to these settings." | no |
| `parse` | "We couldn't read the response." | yes |

A retry button on a 403 is a lie — it will fail identically forever. `isRetryable`
encodes that.

Two extras worth keeping:

- **Response validation.** A `200` whose body isn't the expected shape becomes a
  `parse` error rather than being spread into the form as `undefined` values. A
  half-rendered form with blank fields reads as data loss to a user.
- **Timeout.** `AbortSignal.timeout` combined with the caller's signal means a hung
  request eventually becomes an error instead of a permanent spinner. "Loading
  forever" is the same user experience as the blank box.

### 3. A skeleton, not a spinner in a void

`SettingsSkeleton` mirrors the real layout — heading bar, three label/field pairs, a
button — at the same heights as the real controls. Two reasons:

- It tells the user *what is coming*, so the wait feels shorter and intentional.
- Matching heights means no layout shift when the data lands.

The placeholder bars are `aria-hidden`; a single `role="status"` region announces
"Loading your settings" once, instead of a screen reader enumerating a dozen empty
divs.

`prefers-reduced-motion` kills the shimmer.

### 4. Make the failure perceivable, not just visible

The error panel is `role="alert"`, so it is announced the moment it appears. The
original bug wasn't only that sighted users saw nothing — assistive-tech users got no
signal at all. Colour is reinforcement only; the heading text carries the meaning.

If the server returned an `x-request-id`, it's surfaced as a support reference. That
turns "it's broken" tickets into actionable ones.

### 5. Lifecycle correctness

`AbortController` cancels in-flight requests on unmount and on a superseding retry, and
an attempt counter guards against an older response overwriting a newer one. A
user-initiated abort is deliberately *not* rendered as an error — cancelling a load is
not a failure.

## Files

| File | Role |
|---|---|
| `src/api/settingsApi.ts` | `ApiError` with typed `kind`, fetch + status mapping + response validation + timeout |
| `src/hooks/useSettings.ts` | `AsyncState` union, abort/stale-response handling, `retry` |
| `src/components/SettingsPage.tsx` | Exhaustive switch over the union; the form |
| `src/components/SettingsSkeleton.tsx` | Layout-matching skeleton |
| `src/components/ErrorState.tsx` | Per-kind copy, conditional retry, support reference |
| `src/components/states.css` | Skeleton, panel, reduced-motion, visually-hidden |
| `src/components/SettingsPage.test.tsx` | One test per state, plus regression guards |

## What the tests pin down

Written against user-perceivable behaviour (roles, labels, text) rather than internals:

- Loading renders a skeleton, not an empty container, and announces itself.
- 500 renders an `alert` with human copy **and** a retry button — the direct
  regression test for the reported bug.
- The error text never contains a raw status code, `undefined`, `[object Object]`, or
  `Error:`.
- Network vs. server failures produce different messages.
- 403 and 401 suppress retry; 401 offers sign-in instead.
- A malformed 200 body is an error, not a silently blank form.
- Retry recovers to the form; a failed retry stays in the error state.
- Unmount aborts the in-flight request.

## Notes for wiring it up

- Drop-in replacement for whatever `SettingsPage` currently is; nothing else changes.
- If the app already uses TanStack Query or SWR, keep them — map their
  `isLoading`/`isError`/`error` into the same union in a thin adapter and delete
  `useSettings`'s fetching internals. The union, the typed errors, the skeleton and
  the error copy all still apply; that's where the value is.
- The same three-state discipline should be applied to the **save** path, which likely
  has the identical gap: submitting probably has no pending, failure, or success
  feedback either.
