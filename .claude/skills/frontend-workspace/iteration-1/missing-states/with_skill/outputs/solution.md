# Settings page: loading, empty, error, populated

## What was actually broken

Two symptoms, one root cause. The page had a happy path and an implicit
"everything else":

- while the request was in flight it rendered the populated markup with no data
  in it — a blank white box, indistinguishable from a broken page
- when the request failed, the failure went nowhere the user could see (at best
  a `console.error`), so the component stayed in its initial state forever

So "loading" and "failed" looked identical to a user, and both looked like
"broken". The fix is not a spinner bolted on top; it is making the four states
explicit and impossible to skip.

## The four states

| State | What the user sees |
|---|---|
| Loading | A skeleton that mirrors the final layout, announced as "Loading your settings…" |
| Empty | For connected accounts: why it's empty and a button to fix it |
| Error | What failed, in a sentence, plus a Try again control |
| Populated | The settings |

The page heading and description render in every state. Only the data region
swaps, so the user always knows what page they are on — even mid-failure.

## Shape of the code

Five small files, split on responsibility rather than length:

- `settingsApi.ts` — transport. Turns every failure mode (5xx, 401/403, other
  4xx, network, unparseable 200) into one `LoadError` with a `kind`. Nothing
  downstream sniffs at `Response` or `err.message`.
- `useSettings.ts` — owns the request and exposes a discriminated union:
  `{ status: 'loading' } | { status: 'error', error } | { status: 'success', data }`.
- `statusMessages.ts` — error copy in one place, reviewable by someone who does
  not read TSX.
- `SettingsStates.tsx`, `SettingsView.tsx` — presentational. Render what they are
  given, report events upward, know nothing about fetching.
- `SettingsPage.tsx` — the container: owns data, decides which state to show.

The union is the load-bearing part. A `switch` over it with a
`const unreachable: never = state` default means adding a state without handling
it is a compile error, not a blank page in production. That is what stops this
class of bug from coming back.

## Request lifecycle

Four things go wrong with fetching that the original code did not handle:

- **Response after unmount** — the effect aborts its `AbortController` on
  cleanup, and a `mountedRef` guards the setState. No "update on unmounted
  component" noise, no ghost renders.
- **Out-of-order responses** — every load takes a monotonic request id; a
  response whose id is not the current one is dropped. A slow first request can
  no longer overwrite a fast second one.
- **Silent failures** — failures set the `error` state, which renders. The
  `console.error` stays for operators, but it is no longer the only place the
  failure exists.
- **Retry without a reload** — `retry()` re-runs the same load, aborting
  whatever is in flight. The user never has to refresh the browser.

Error copy is per-kind because the right next action differs: a 500 says "try
again in a moment" and offers retry; a 403 says the session expired and offers
Sign in, because retrying the identical request cannot help.

## No layout shift

The skeleton uses the same row metrics as the populated list (`.settings-row`,
`min-height: 2.75rem`), and the region has a `min-height` floor. Content does not
jump under a cursor mid-click when the response lands. The shimmer is disabled
under `prefers-reduced-motion`.

## Accessibility

- the loading placeholder carries a visually hidden `role="status"`; the
  decorative bars are `aria-hidden`, so a screen reader hears "Loading your
  settings…" and not a run of empty boxes
- the error panel is `role="alert"`, so it is announced when it replaces the
  skeleton — otherwise a non-sighted user waits forever on a page that quietly
  gave up
- Try again and Sign in are `<button>`s (they act, they do not navigate),
  keyboard-reachable, with a visible `:focus-visible` ring
- red is reinforcement only; the title and detail text carry the state

## Tests

`SettingsPage.test.tsx` drives the page the way a user does — queries by
accessible name and visible text, clicks, asserts on what appears. Nothing binds
to component internals or state shape, so a refactor that keeps the screen
identical keeps the suite green.

Covered: loading placeholder is present and labelled; heading survives the swap;
500 shows an explained error and retry recovers; a network failure reads
differently from a server failure; 403 offers sign-in and no retry; the empty
accounts list explains itself; retry shows progress rather than flashing empty;
the whole error state is operable by keyboard alone; a stale response cannot
overwrite a newer one; a response after unmount is ignored.

`useSettings.test.ts` adds a handful of hook-level tests for the things that are
not visible in pixels: error classification, abort on unmount, and a 200 with an
unreadable body (a gateway HTML page, typically) being treated as a failure
rather than rendering nothing.

To confirm the tests are worth their maintenance, break the implementation on
purpose: delete the `error` branch from `SettingsPage`'s switch and the error
tests must fail. A test that passes against a deliberately broken implementation
is proving nothing.

## Verifying by hand

Beyond the suite, the two checks worth doing in a browser, since jsdom cannot
see layout or motion:

1. Throttle the network in devtools and watch the swap — nothing should jump.
2. Force a 500 and tab through the page with the mouse untouched; the Try again
   button should be reachable, visibly focused, and announced.
