# Notes: assumptions and open questions

## Assumptions I made (flag any that are wrong)

- **Stack**: React 18 + TypeScript, function components and hooks. Tests with
  Vitest + React Testing Library + `@testing-library/user-event` and
  `jest-dom` matchers. If you're on Jest, the only change is the import line;
  if you're on Vue/Svelte/Angular, the layering in `solution.md` transfers but
  the code doesn't.
- **No form library in use.** I wrote it with plain `useState`. If the codebase
  standardises on react-hook-form or Formik, the `parseErrorBody` boundary and
  the test list still apply — only the hook changes (`setError(field, ...)`).
- **Error envelope**: I don't know yours, so `parseErrorBody` handles the three
  common shapes. In a real codebase I'd delete the two you don't use rather than
  keep speculative branches.
- **Status codes**: 422 (and 400) carry field errors; everything else is a
  generic failure. Some APIs use 409 for "email already taken" — worth checking.
- **Endpoint**: `PUT /api/profile` returning the updated profile. Invented.
- **Fields**: name, email, bio only. Bio limit of 500 chars is invented — the
  counter is cosmetic unless it matches the real server rule.
- **The form has an `initialValues` prop** supplied by a parent that already
  loaded the profile. I did not write the loading/empty/error states for that
  fetch; they belong to the parent.
- **Styling**: class names only (`field-error`, `form-error-summary`). No CSS
  written — I don't know your system (Tailwind? CSS modules?).

## Things I'm uncertain about / would ask

1. **What is actually resetting the form today?** I fixed the state ownership,
   which is the usual cause, but if the real cause is a route redirect on error
   or a `key` prop churn in the parent, that lives outside this component and my
   change alone won't fix it. Worth confirming against the real code.
2. **Should errors clear on change or on blur?** I chose change — it feels most
   responsive. Some teams prefer blur because the message vanishing on the first
   keystroke can feel like the app "forgot" the problem. Easy to switch.
3. **Should the first message win, or should all messages for a field show?** I
   show the first. If your server sends genuinely distinct problems per field
   ("too short" AND "contains a URL"), you may want a list.
4. **Unsaved-changes guard.** If a user can navigate away mid-edit, the typed
   content is still lost — a different instance of the same complaint. Worth a
   `beforeunload` / router block on dirty state, but I left it out as scope.
5. **Draft persistence.** For the bio specifically, persisting a draft to
   `sessionStorage` would survive a tab crash or accidental reload. Probably
   over-engineering for three fields; mention it if bio is long-form.
6. **Optimistic concurrency.** If two sessions edit the same profile, someone's
   changes get overwritten. If that matters, an ETag / `updated_at` check with a
   409 conflict path is a separate piece of work.
7. **Email change flow.** Changing an email often needs re-verification. If so,
   the success message here is misleading and should say "check your inbox".

## Not verified

The code is illustrative and was never compiled or run — there's no project to
run it in. Types and test matchers are written from knowledge, so expect minor
import-path or config adjustments when dropping it into a real repo.
