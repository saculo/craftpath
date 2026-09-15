# Critique: Notifications Rework Plan

## Verdict

The plan does not hold up. Not because the three items are wrong things to do —
they are — but because they are **phases, not tasks**. "Build it / test it / ship
it" is the shape work takes when you describe it afterwards, not a decomposition
someone can execute one piece at a time.

The sharpest way to see the problem: if task 2 never happens, you have shipped
untested notifications. If task 3 never happens, you have code that runs nowhere.
A task is supposed to leave the codebase working and verifiable on its own. None
of these three do.

Below: what's structurally wrong, what's substantively missing, then a corrected
decomposition.

---

## Structural problems

### 1. Task 1 is at least six tasks

"Build the notification service and wire up the UI" fails every sizing signal at
once:

- the title contains "and"
- it touches a data model *and* a user interface
- it crosses the backend/frontend boundary, so it needs two discipline skills
- you cannot name a single verification command for it without qualifying it

An executor handed this task has to invent the decomposition themselves, in a
fresh session, with less context than you have now. That is the exact failure the
plan gate exists to prevent.

### 2. "Add tests" is not a task

This is the most consequential item to fix. Tests are not a work item that
follows implementation; they are how each task proves it is done. Pulling them
out has three costs:

- **Task 1 has no acceptance criteria that can be bound to anything.** If the
  tests don't exist until task 2, then task 1's criteria are either vague or
  unverifiable, and it gets approved on trust.
- **Task 2 has no definition of done.** "Add tests" is complete at one test and
  at four hundred. Nobody can review it, so nobody will.
- **Tests written after the fact test what the code does**, not what the
  requirement said. They lock in whatever got built, including the bugs.

Delete this task. Every implementation task below carries its own criteria with
named selectors.

### 3. "Deploy it" hides the infrastructure work rather than planning it

Some of the infra work almost certainly has to happen *before* the service, not
after — a queue to provision, provider credentials to put somewhere, a feature
flag to create. Parking all of it behind the implementation means you discover
the ordering constraint during execution, which is the expensive time to
discover it.

Deployment also is not one thing here. Provisioning, cutover from whatever
exists today, and decommissioning the old path are three different changes with
different risk profiles and different rollback stories.

### 4. There are no acceptance criteria at all

Three titles, no statements about observable behavior. Nothing in this plan can
fail review, because there is nothing specific enough to disagree with. That is
the quiet failure mode: it gets approved, and the cost lands during execution.

### 5. The dependency chain is narrative, not real

1 → 2 → 3 reads as a story. Ask the real question for each edge: *would this
actually fail if run first?* Provisioning a queue would not fail if run first —
it should probably go first. Once tests live inside their tasks, several of the
remaining tasks are independent of each other and can proceed in parallel.

---

## Substantive gaps

These are things the three-line plan gives an executor no guidance on, each of
which will otherwise be decided by guesswork in a fresh session:

**The word "rework" is doing a lot of unexamined work.** A rework replaces
something. The plan has no task for the existing notification path: no cutover,
no dual-run, no backfill of in-flight or historical notifications, no
decommission, no back-compat window. In practice this is the riskiest part of
the whole effort and it is currently invisible.

**Channels are unspecified.** In-app only? Email? Push? SMS? Each is a separate
delivery path with its own failure modes, and the answer changes the task count
by several.

**Delivery semantics are unspecified.** What happens when a send fails — retry,
how many times, with what backoff, and where does it go when it finally gives
up? Is a duplicate notification acceptable? If the answer is no, something needs
an idempotency key, and that is a schema decision that must be made before the
first task, not after.

**User preferences and opt-out.** Almost every notifications rework acquires a
preferences surface. If it's in scope, it's backend plus frontend plus a
migration for existing users' defaults. If it's out of scope, say so explicitly
or someone will build it.

**Read state and unread counts.** "Wire up the UI" implies a feed. A feed
implies read/unread, which implies a write path from the client and a count
endpoint that stays correct under concurrent reads.

**Real-time or polling.** Whether the bell updates live changes the frontend
task and may add a transport (WebSocket/SSE) task with its own infra needs.

**Templating and localization.** If notifications have any user-visible copy
beyond a string, someone has to decide where that copy lives.

**Rate limiting / batching.** Protection against a loop that emits ten thousand
notifications for one user is normally discovered in production.

**Observability.** Delivery failures on an async path are silent by
construction. If nothing emits metrics for send/fail/retry-exhausted, you will
learn about outages from users.

I would not add all of these. I would force a decision on each, and record the
ones you're deliberately not doing under out-of-scope.

---

## Corrected decomposition

**Read this as a shape, not a final answer.** It assumes in-app plus email,
event-driven dispatch, an existing notifier being replaced, and a web frontend.
Where those assumptions are wrong the task list changes — see `user_notes.md`.
Selectors are commitments about tests that will exist, not claims that they do.

Before any of this is real, the open questions above need answers. A plan built
on guessed scope is a plan that gets re-approved mid-execution.

---

```yaml
- id: T1
  title: Provision notification queue and delivery-provider credentials
  skills: [infrastructure]
  depends_on: []
  acceptance:
    - id: A1
      text: >
        Applying the module in a clean environment creates the notifications
        queue and its dead-letter queue; a second apply reports no changes
      verified_by:
        - cmd: test-infra
          selector: NotificationQueueTest#applyIsIdempotent
    - id: A2
      text: >
        The email provider API key is read from the secret store at runtime and
        appears in no plan output, log line, or committed file
      verified_by:
        - cmd: test-infra
          selector: NotificationSecretsTest#apiKeyNotPresentInPlanOutput
    - id: A3
      text: >
        The notifications feature flag exists and evaluates to off for all users
        in staging and production
      verified_by:
        - cmd: test-infra
          selector: FeatureFlagTest#notificationsDefaultsOff
  out_of_scope:
    - Application code that reads the queue (T2)
    - Enabling the flag for any user (T9)
```

```yaml
- id: T2
  title: Persist a notification record when a domain event is consumed
  skills: [backend, messaging-eda, testing]
  depends_on: [T1]
  acceptance:
    - id: A1
      text: >
        Consuming an order-shipped event writes one notification row for the
        order's owner with status PENDING
      verified_by:
        - cmd: test-integration
          selector: NotificationIngestIT#persistsPendingNotification
    - id: A2
      text: >
        Redelivering an event with the same event id writes no second row and
        acknowledges the message
      verified_by:
        - cmd: test-integration
          selector: NotificationIngestIT#duplicateEventIdIsIgnored
    - id: A3
      text: >
        An event whose recipient no longer exists is acknowledged, writes
        nothing, and increments the dropped-notification counter
      verified_by:
        - cmd: test-integration
          selector: NotificationIngestIT#unknownRecipientIsDroppedNotRetried
  out_of_scope:
    - Sending anything; this task only records (T4)
    - Any event type other than order-shipped
```

```yaml
- id: T3
  title: Serve a paginated notification feed with unread count
  skills: [backend, testing]
  depends_on: [T2]
  acceptance:
    - id: A1
      text: >
        GET /notifications returns the caller's notifications newest-first,
        capped at 20 per page, with a cursor for the next page
      verified_by:
        - cmd: test-integration
          selector: NotificationFeedIT#returnsNewestFirstPaged
    - id: A2
      text: >
        The response never includes a notification belonging to another user,
        even when that user's id is supplied as a query parameter
      verified_by:
        - cmd: test-integration
          selector: NotificationFeedIT#doesNotLeakOtherUsersNotifications
    - id: A3
      text: >
        unread_count reflects only notifications with no read_at timestamp
      verified_by:
        - cmd: test-integration
          selector: NotificationFeedIT#unreadCountExcludesReadNotifications
  out_of_scope:
    - Marking notifications read (T5)
    - Any UI (T6)
```

```yaml
- id: T4
  title: Deliver pending notifications by email with bounded retry
  skills: [backend, messaging-eda, testing]
  depends_on: [T2]
  acceptance:
    - id: A1
      text: >
        A PENDING notification is sent once and transitions to SENT with a
        delivery timestamp
      verified_by:
        - cmd: test-integration
          selector: EmailDeliveryIT#marksSentOnSuccess
    - id: A2
      text: >
        A provider 5xx is retried with exponential backoff up to 3 attempts;
        after the third the notification is FAILED and the message is on the
        dead-letter queue
      verified_by:
        - cmd: test-integration
          selector: EmailDeliveryIT#exhaustsRetriesThenDeadLetters
    - id: A3
      text: >
        A provider 400 is not retried and the notification is FAILED
        immediately
      verified_by:
        - cmd: test-integration
          selector: EmailDeliveryIT#permanentFailureIsNotRetried
    - id: A4
      text: >
        Each terminal outcome increments a counter labelled by channel and
        result
      verified_by:
        - cmd: test-integration
          selector: EmailDeliveryIT#emitsDeliveryMetrics
  out_of_scope:
    - Push and SMS channels
    - Honouring user preferences (T5)
```

```yaml
- id: T5
  title: Honour per-channel notification preferences at dispatch
  skills: [backend, testing]
  depends_on: [T4]
  acceptance:
    - id: A1
      text: >
        A user with email disabled gets an in-app notification row and no email
        send attempt
      verified_by:
        - cmd: test-integration
          selector: NotificationPreferenceIT#suppressesDisabledChannel
    - id: A2
      text: >
        A user with no stored preference row is treated as opted in to all
        channels
      verified_by:
        - cmd: test-integration
          selector: NotificationPreferenceIT#defaultsToOptedIn
    - id: A3
      text: >
        PUT /notification-preferences updates only the calling user's row and
        rejects an unknown channel name with 400
      verified_by:
        - cmd: test-integration
          selector: NotificationPreferenceIT#rejectsUnknownChannel
  out_of_scope:
    - The preferences UI (T8)
    - Per-notification-type granularity; channel-level only
```

```yaml
- id: T6
  title: Render the notification bell with unread badge
  skills: [frontend, testing]
  depends_on: [T3]
  acceptance:
    - id: A1
      text: >
        The bell shows the unread count as a badge, and shows no badge when the
        count is zero
      verified_by:
        - cmd: test-unit
          selector: NotificationBell.test.tsx > hides badge at zero unread
    - id: A2
      text: >
        Opening the panel with no notifications shows the empty state, not a
        blank panel or a spinner
      verified_by:
        - cmd: test-unit
          selector: NotificationPanel.test.tsx > renders empty state
    - id: A3
      text: >
        A failed feed request shows an error state with a retry control that
        refetches
      verified_by:
        - cmd: test-unit
          selector: NotificationPanel.test.tsx > retries after fetch failure
    - id: A4
      text: The panel is reachable and dismissable by keyboard alone
      verified_by:
        - cmd: test-unit
          selector: NotificationPanel.test.tsx > supports keyboard navigation
  out_of_scope:
    - Marking notifications read (T7)
    - Live updates; this polls on open
```

```yaml
- id: T7
  title: Mark notifications read from the panel
  skills: [frontend, testing]
  depends_on: [T5, T6]
  acceptance:
    - id: A1
      text: >
        Opening a notification marks it read optimistically and decrements the
        badge without a full refetch
      verified_by:
        - cmd: test-unit
          selector: NotificationPanel.test.tsx > decrements badge on read
    - id: A2
      text: >
        A failed mark-read request restores the unread state and surfaces a
        non-blocking error
      verified_by:
        - cmd: test-unit
          selector: NotificationPanel.test.tsx > rolls back failed mark read
  out_of_scope:
    - Bulk mark-all-read
```

```yaml
- id: T8
  title: Expose notification preferences in account settings
  skills: [frontend, testing]
  depends_on: [T5]
  acceptance:
    - id: A1
      text: >
        Each channel renders a toggle reflecting the stored preference, and a
        user with no stored row sees all toggles on
      verified_by:
        - cmd: test-unit
          selector: NotificationPreferences.test.tsx > reflects stored state
    - id: A2
      text: >
        Toggling a channel persists on change and reverts visibly if the
        request fails
      verified_by:
        - cmd: test-unit
          selector: NotificationPreferences.test.tsx > reverts on save failure
  out_of_scope:
    - Unsubscribe links inside emails
```

```yaml
- id: T9
  title: Route legacy notification senders through the new service behind the flag
  skills: [backend, testing]
  depends_on: [T4]
  acceptance:
    - id: A1
      text: >
        With the flag off, every existing caller still sends via the legacy
        path and no notification row is written
      verified_by:
        - cmd: test-integration
          selector: NotificationCutoverIT#flagOffUsesLegacyPath
    - id: A2
      text: >
        With the flag on for a user, that user's notification goes through the
        new service exactly once and the legacy path is not invoked
      verified_by:
        - cmd: test-integration
          selector: NotificationCutoverIT#flagOnSendsOnceViaNewService
    - id: A3
      text: >
        Turning the flag off at runtime returns traffic to the legacy path
        without a restart
      verified_by:
        - cmd: test-integration
          selector: NotificationCutoverIT#flagIsRuntimeReversible
  out_of_scope:
    - Removing legacy code (T10)
    - Backfilling historical notifications into the new feed
```

```yaml
- id: T10
  title: Remove the legacy notification sender
  skills: [backend, testing]
  depends_on: [T9]
  acceptance:
    - id: A1
      text: >
        No production source file references the legacy sender, and the build
        passes with its module deleted
      verified_by:
        - cmd: test-unit
          selector: ArchitectureTest#noReferencesToLegacyNotifier
    - id: A2
      text: >
        The flag check is gone and all callers use the new service
        unconditionally
      verified_by:
        - cmd: test-integration
          selector: NotificationCutoverIT#allTrafficUsesNewService
  out_of_scope:
    - Dropping legacy database tables; do that after a retention window
```

---

## Plan-gate checklist against the corrected version

| # | Check | Status |
|---|---|---|
| 1 | Every scenario maps to a criterion | **Blocked** — the requirement scenarios don't exist yet; this is the gap to close first |
| 2 | Every criterion names a selector | Pass |
| 3 | Every task verifiable alone | Pass |
| 4 | Every `depends_on` would really fail | Pass — T1 first because the queue must exist; UI tasks after their endpoints; T10 after T9 |
| 5 | Skills match the work | Pass — one discipline skill each, `testing` everywhere tests are written |
| 6 | No title contains "and" | Pass |
| 7 | Out of scope stated | Pass |

Check 1 is the one that matters. Everything above is a plausible shape built on
assumptions I made; it is not yet a plan you can approve, because the
requirement it decomposes hasn't been written down.

## What I'd do next

1. Write down the notifications requirement as scenarios — channels, delivery
   guarantees, what happens to the existing system, whether preferences are in
   scope.
2. Answer the idempotency and retry questions before T2, since both are schema
   decisions.
3. Re-derive the task list from those scenarios and check each one maps to a
   criterion.
4. Then take it to review, where someone can say "no, split T4" — which is the
   whole point of having a plan at all.
