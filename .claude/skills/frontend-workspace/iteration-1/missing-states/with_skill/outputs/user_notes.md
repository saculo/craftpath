# Notes, assumptions, and things you should check

## Assumptions I made (no codebase was available to me)

- **Stack**: React 18 + TypeScript, function components, hooks. Tests are
  Vitest + React Testing Library + `@testing-library/user-event`. If you are on
  Jest, the only changes are the import line and `vi` → `jest`; the test bodies
  are identical.
- **No data-fetching library**. I wrote the fetch lifecycle by hand. If you
  already use TanStack Query, SWR, or a router loader, **throw `useSettings.ts`
  away** and keep the rest — the four-state rendering in `SettingsPage.tsx`, the
  error classification in `settingsApi.ts`, and the copy in `statusMessages.ts`
  all sit on top of `{ isPending, error, data }` unchanged. The abort and
  race-condition handling in my hook is exactly what those libraries already do
  better than a hand-rolled version.
- **Endpoint** is `GET /api/settings` returning a flat JSON object. Field names
  (`displayName`, `timezone`, `marketingEmails`, `connectedAccounts`) are
  invented — swap in your real shape.
- **Styling**: a plain CSS file, because I did not know whether you use Tailwind,
  CSS modules, styled-components, or a design system. If you have a design
  system, use its Skeleton / Alert / EmptyState primitives instead of
  `SettingsStates.tsx` and keep only the state logic.

## Uncertainties

- **The empty state is the one I am least sure about.** A settings page usually
  has no meaningful "empty" — the user always has settings. I modelled it on a
  sub-list (connected accounts) because that is a place where a real user
  genuinely sees nothing. If your page has a different list (API keys, team
  members, sessions), move the empty state there. If it has no list at all, drop
  it and keep three states.
- **`saveSettings` is included but unused.** The task was about read states. I
  left it in `settingsApi.ts` because a settings page always grows a save path
  and you will want the same error classification there. Delete it if that is
  not on the roadmap. Note that a save path also needs its own in-flight state,
  a disabled submit button, and preserved form input on failure — that is a
  separate piece of work and I did not do it.
- **Error copy** is written for an end user, not an operator. Your product voice
  may differ, and the strings contain typographic apostrophes (’) which the tests
  match literally — if you rewrite the copy, update the assertions.
- **Whether a 404 should be an error at all.** I classify it as `client` and show
  a generic message. If your API returns 404 for "user has no settings row yet",
  that is an empty state, not an error, and should be mapped in `settingsApi.ts`.

## Workarounds / known limits

- **jsdom cannot measure layout**, so no test actually proves the absence of
  layout shift. The skeleton shares row metrics with the populated list and the
  region has a `min-height`, but verify it by eye with a throttled network, or
  add a Playwright/visual-regression check if this matters enough. I called this
  out as a manual check rather than pretending a unit test covers it.
- **`new Response(...)` in tests** needs Node 18+ (or `undici`). If your test
  environment predates that, replace `jsonResponse` with a plain object literal
  `{ ok, status, json: async () => body }`.
- **The `console.error` assertion** in the "response after unmount" test is a
  proxy for React's unmounted-setState warning. It is a little indirect; it will
  also fail if anything else logs an error, which I consider a feature.
- **The abort test** asserts the signal is passed and that the retry resolves
  cleanly, not that the underlying HTTP connection was torn down — that is not
  observable from jsdom.
- **Retries are manual only.** No automatic backoff. A settings page is not worth
  a retry storm against an already-struggling server, and a user-driven retry is
  more honest. If you want automatic retry, put it in the data layer, not the
  component.
- I wrote these as standalone files rather than wiring them into a real tree, so
  imports assume all seven files sit in one directory. Move them into your
  feature folder structure and fix the relative paths.
