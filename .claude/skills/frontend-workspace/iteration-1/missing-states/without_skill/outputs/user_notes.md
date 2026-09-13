# Notes: assumptions and uncertainties

## Assumptions I made

Since I couldn't see the codebase, I picked defaults and kept them isolated so they're
cheap to swap:

- **Plain `fetch` + a hand-rolled hook.** If you're on TanStack Query, SWR, RTK Query
  or Apollo, throw away `useSettings`'s internals and map the library's flags into the
  same `AsyncState` union. The union, the typed `ApiError`, the skeleton and the error
  copy are the parts that matter and they all survive that swap.
- **Endpoint `GET /api/settings`** returning a flat JSON object with five fields. The
  shape is invented; replace `Settings` and `isSettings` with your real contract.
- **Vitest + React Testing Library + `@testing-library/jest-dom`.** For Jest, swap the
  `vi.*` calls for `jest.*` and drop the import line — nothing else changes.
- **Plain CSS.** If you're on Tailwind / CSS Modules / styled-components, `states.css`
  is the only file that needs rewriting.
- **React 18+ function components**, no Suspense. See below.
- **`AbortSignal.any` and `AbortSignal.timeout`** are used — baseline in modern
  browsers and Node 20+, but not in older Safari or jsdom below ~22. If your targets
  are older, replace with a manual `setTimeout` + `controller.abort()` pair.

## Things I'd want to check with you

1. **Is there an empty state?** I assumed settings always exist for a logged-in user,
   so there's no "no data" branch. If the API can legitimately return an empty or
   partial record, that needs a fourth visual state — an empty state that explains
   what to do, not a form full of blanks.
2. **Error copy is my invention.** "We couldn't load your settings" etc. should go past
   whoever owns product copy / localisation. If you have an i18n layer, `errorCopy`
   should return keys rather than strings.
3. **Does your API send `x-request-id`?** I read that header for the support reference.
   If the correlation id lives in the JSON error body or under a different header name,
   adjust `fetchSettings`.
4. **Auth handling.** I render a "Sign in" link for 401. Many apps intercept 401
   globally and redirect. If yours does, that branch is dead code — delete it.
5. **Should a server error be reported to monitoring?** I deliberately didn't wire in
   Sentry/Datadog since I don't know what you use, but the `error` branch of
   `useSettings` is the right place for it.

## Deliberate decisions you might disagree with

- **Skeleton over spinner.** More code, and it has to be kept in sync with the form
  layout. If the request is reliably fast (<300ms), a well-placed spinner — or nothing
  at all with a delay before showing anything — can be better than a skeleton that
  flashes. I went with the skeleton because a wait long enough to have been noticed and
  reported as "broken" is long enough to deserve one.
- **No automatic retry with backoff.** I only did manual retry. Auto-retrying a 500
  once or twice would smooth over transient blips, but it also delays the honest error
  and can amplify load on an already-struggling server. Easy to add in `useSettings`
  if you want it.
- **`refreshing` as a separate state.** Arguably over-engineering for a page that loads
  once. It earns its place the moment you add a save action or a manual refresh.
- **Validating the response body.** Some teams consider this paranoid. I think a
  silently blank form is one of the worst failure modes for a settings page, since it
  looks like data loss. If you already use Zod, replace `isSettings` with a schema.
- **I did not touch the save path.** You asked about loading, so that's what I scoped
  to. But if the load states were missing, the submit states almost certainly are too —
  no pending state on the button, no confirmation, no failure message. Worth a
  follow-up.

## Not covered

- Error boundaries for render-time crashes (different failure class from a failed
  request; the union doesn't help there).
- Offline detection via `navigator.onLine` / the `online` event, which would let you
  auto-retry when connectivity returns.
- Visual regression or a11y-audit tests (axe) for the three states.
- Anything about *why* the API 500s — this is purely making the frontend honest about
  it.
