/** The `frontend` skill, written to `.claude/skills/frontend/SKILL.md` by `craftpath init`. */
export const FRONTEND_SKILL = `---
name: frontend
description: Implement and verify user-facing interface behavior — component boundaries, state, data fetching, loading and error states, forms, and accessibility. Use whenever a task touches UI code, components, pages, templates, styling, client-side state, routing, or browser behavior. Trigger on mentions of the frontend, a screen, a page, a component, a form, a button, how something looks or behaves in the browser, responsive layout, or an interface feeling slow or broken. Use it even for a small visual change, because the states that get skipped — empty, loading, error — are what users actually hit.
---

# Frontend

You are implementing one task against approved acceptance criteria. Those
criteria describe what a person using the interface can observe. Build to that,
and verify the same way — through what the user sees and does, not through
internal component structure.

## Every view has four states

Most interface bugs are a missing state rather than a wrong one. Before writing
the component, decide what each of these looks like:

| State | What the user sees |
|---|---|
| Loading | Something that indicates progress, without layout jumping |
| Empty | Why it is empty and what to do about it |
| Error | What failed and what they can do next |
| Populated | The happy path everyone designs first |

Empty and error are where products feel broken. A spinner that never resolves and
a blank panel are indistinguishable to a user.

**Empty is a state of the data, not of the request.** This is the one most often
missed, because a request-status union (\`loading | error | success\`) looks
complete and has no room for it — a successful response carrying zero rows falls
into \`success\` and renders an empty container. Decide separately: the request
succeeded, *and there is nothing to show*. What does the user see, and what can
they do about it?

If a task's criteria name only loading and error, that is usually an omission
rather than a decision. Build the empty state, and say you did.

Avoid layout that shifts when data arrives — reserve the space, so content does
not jump under a cursor mid-click.

## Component boundaries

Split on responsibility, not on file length. A component that fetches, decides,
and renders is three things wearing one name, and it cannot be tested or reused
without dragging the others along.

A practical division:

- components that own data and decisions
- components that render what they are given and report events upward

Push state up only as far as it needs to go. State lifted too high causes
unrelated re-renders and makes the owning component a junk drawer; state kept too
low gets duplicated and drifts out of sync.

## Data fetching

Decide what happens when the request is slow, fails, or is superseded:

- a response arriving after the user navigated away must not update anything
- a second request must not be overwritten by a slower first one
- a failure must surface, not vanish into a console log
- a retry must be available without a full page reload

Show optimistic results only when you can undo them convincingly. An optimistic
update that silently reverts is worse than a brief spinner, because the user
already believed it worked.

## Forms

Forms are where careless implementations hurt most, because the user has invested
effort before anything goes wrong.

- validate on submit, and refine as the user corrects; validating every keystroke
  from the start punishes people mid-typing
- say what is wrong and how to fix it, next to the field it concerns
- keep entered data on a failed submit — never clear a form the user must retype
- disable the submit control while in flight, so a double click is not two records
- preserve focus position; do not steal focus on re-render

## Accessibility

This is not a separate checklist to bolt on afterwards. It is mostly a
consequence of using the right element:

- a control that navigates is a link; a control that acts is a button
- every input has a programmatically associated label
- every interactive element is reachable and operable by keyboard alone
- focus is visible, and follows a sensible order
- an icon-only control carries an accessible name
- color is never the only thing distinguishing a state

Announce dynamic changes that matter — a submitted form's result, a validation
failure — so someone not watching the screen learns about them.

Test by tabbing through the feature with the mouse untouched. Anything you cannot
reach is broken for more people than you expect.

## Performance that users feel

- do not block first render on data the first screen does not show
- keep long lists virtualized or paginated
- debounce work triggered by typing, not the typing itself
- measure before optimizing; most perceived slowness is a missing loading state
  rather than slow code

## You write the tests, and you write them first

The component and integration tests for this task are yours. They are not a later
phase and not someone else's skill. (\`testing\` covers end-to-end journeys and
suite health; it does not cover these.)

Write the test before the component, at the selector the criterion names, run it,
and watch it fail — the repo rule (\`.claude/rules/tdd.md\`) applies here like
everywhere else:

\`\`\`
RED       write the test at the criterion's selector, run it, watch it fail
GREEN     write the minimum code that makes it pass
REFACTOR  improve structure with the test green
\`\`\`

**RED has a condition:** it must fail because the behavior is missing, not
because the component failed to mount, a provider was absent, or a query matched
nothing for an unrelated reason. Read the failure. A test that went red for the
wrong reason and then green proves nothing about the behavior.

Driving the component from its test first is also the cheapest way to discover
that a component fetches, decides, and renders all at once: that design is
painful to test long before it is painful to change.

### Test the way a user interacts

Find elements by their accessible name or visible text, act on them, and assert
on what appears.

Reach for \`getByRole\`, \`getByLabelText\` and \`getByText\` first. A \`data-testid\` is
a last resort for something genuinely unreachable by role or text — and if the
loading and empty states are the parts that need one, that is a signal they lack
an accessible name a real user's screen reader would need anyway. Fix the markup
rather than the query.

Tests bound to internal structure — component internals, class names, state
shape — break during refactors that changed nothing a user could see, and pass
through changes that broke the interface. They cost maintenance and provide false
confidence, which is the worst combination.

### Which level, for frontend work

- **Component** — a unit with its rendering and interaction. Most of your tests:
  states, form behavior, keyboard operation, what appears after a click.
- **Integration** — a screen wired to a stubbed network layer, where the thing at
  risk is the wiring: request superseded, response after unmount, error mapped to
  the right message.

Stub at the network boundary rather than mocking your own modules. Mocking the
hook you just wrote tests the mock.

Cover the four states you designed above. The error and empty cases are exactly
the ones no one exercises by hand — and the ones users hit.

### Name the test as the claim

**Weak:** \`renders\`, \`test form\`, \`works\`
**Strong:** \`retainsFormValuesOnFailedSubmit\`, \`showsEmptyStateWhenNoAccountsConnected\`

State the condition and the outcome, so a failure is diagnosable from the report
alone. Check the selector runs on its own (\`bun test -t '<name>'\`) — a test that
only passes inside the full file is leaning on residue from the one above it.

## Verifying the work

The acceptance criteria name specific tests. Create them under those exact names
and confirm they fail when the behavior regresses — a test that passes against a
deliberately broken implementation is proving nothing.

Then run the real verification command and use its evidence. For a criterion
marked manual, look at the actual rendered result before acknowledging it.
`;
