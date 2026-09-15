# Critique: Notifications Rework Plan

## The plan as written

1. Build the notification service and wire up the UI
2. Add tests
3. Deploy it

## Verdict

It doesn't hold up. It's a phase list, not a task decomposition. Three items, and the
first one is the entire project. Nothing here can be picked up, finished, and verified
independently — which is the only thing a task breakdown is for.

Three structural problems, in order of severity.

### 1. Task 1 is the whole feature

"Build the notification service and wire up the UI" bundles a backend service, a
delivery mechanism, a persistence model, an API contract, and a frontend integration
into one item. It can't be estimated, can't be split across people, can't be reviewed
as one PR, and can't be partially shipped. When it slips — and it will — you have no
signal about *where* it slipped, because there are no internal checkpoints.

A useful heuristic: if a task can't be done in roughly a day or two and land as a
single reviewable change, it's a milestone wearing a task costume.

### 2. "Add tests" is not a task

Tests are not a phase that comes after building. Making them a separate task is the
single most reliable way to not get them:

- Task 1 is now "done" without tests, so it gets marked done and the team moves on.
- Whoever picks up task 2 is testing someone else's code from the outside, weeks late,
  without the context that made the edge cases obvious.
- The code was written without tests in mind, so it's untestable, and task 2 quietly
  becomes "refactor everything to be testable, then test it."

Tests belong inside each task's definition of done. Verification is an *attribute* of a
task, not a successor to it.

### 3. "Deploy it" hides all the actual risk

Deployment of a notification system is where the interesting failures live, and here
it's one word. What's missing: how it's rolled out (flagged? percentage?), how you know
it's working, how you turn it off, and what happens to the old notification path during
the overlap. Also — notifications are user-visible and irreversible. You cannot unsend
an email or a push. A bad deploy here isn't "roll back and try again"; it's "we
notified 40,000 people at 3am." That deserves more than a bullet.

## What's missing entirely

These aren't nitpicks — each one is a decision that, unmade, will block or rework
task 1 mid-flight:

- **Channels.** In-app? Email? Push? SMS? Each is a separate integration with its own
  provider, failure mode, and cost. "Notifications" without a channel list is unscoped.
- **The trigger side.** What *produces* notifications? Something has to emit the events.
  If it's a sync call from request handlers, you've coupled notification latency to user
  requests. If it's async, you need a queue and the outbox/delivery guarantees that come
  with it. This is arguably a bigger design decision than the service itself, and it's
  not mentioned.
- **Delivery semantics.** At-least-once means duplicates; users notice duplicate emails.
  You need idempotency keys and dedup, or you need to accept the duplicates explicitly.
- **User preferences / opt-out.** Per-channel, per-category. Not optional — in most
  jurisdictions unsubscribe is a legal requirement for email, and it's a product
  requirement everywhere else.
- **The "rework" part.** This is a *rework*, so something exists today. There's no
  migration story: what happens to existing notification data, in-flight notifications,
  and existing user preferences? No dual-run or cutover plan. Rework plans that don't
  name the old system tend to discover it in production.
- **Retries, failures, and dead letters.** A provider will be down. What then?
- **Rate limiting / batching.** The classic notification disaster is the fan-out storm —
  one event, thousands of sends, or a loop that notifies the same user 200 times.
- **Observability.** Sent/failed/bounced counts, per-channel latency. Otherwise you have
  no way to know the deploy in task 3 went well.
- **Templating and localization**, if you have more than one locale or more than a few
  message types.

## A corrected decomposition

Ordered so each task lands independently and the thing is usable earlier. Every task
carries its own tests — that is not a separate line item anywhere below.

**Phase 0 — decide before building**

- **0.1 Write down the scope decisions.** Channels in v1, event catalogue (which events
  notify whom), delivery guarantee, and what happens to the existing system. One page.
  Done when someone who wasn't in the room can read it and build from it.
  *This is the task that prevents task 1 from being a swamp.*

**Phase 1 — core, behind a flag**

- **1.1 Notification data model + migration.** Notification records, status, user
  preferences table. Done when migrations run forward and back on a prod-sized copy.
- **1.2 Notification domain service — create and persist.** No delivery yet. Takes an
  event, resolves recipients, applies preferences, writes a pending notification.
  Idempotent on a caller-supplied key. Done when duplicate submissions produce one row.
- **1.3 Event ingestion path.** How events reach the service (direct call, queue
  consumer, or outbox poller — per 0.1). Done when an emitted event produces a pending
  notification without blocking the emitting request.
- **1.4 First channel dispatcher (pick the lowest-risk one, usually in-app).** Reads
  pending, delivers, marks sent/failed, retries with backoff, dead-letters after N.
  Done when a forced provider failure retries and eventually dead-letters, visibly.

**Phase 2 — surface**

- **2.1 Notification read API.** List, unread count, mark-read. Paginated.
- **2.2 UI: notification list and unread badge.** Including empty, loading, and error
  states — those are the ones that get skipped and the ones users hit.
- **2.3 UI: preferences screen.** Per-channel, per-category toggles, wired to 1.1.

**Phase 3 — second channel (repeat per channel)**

- **3.1 Email dispatcher** (provider integration, templates, bounce handling).
- **3.2 Unsubscribe link + honoring it.** Non-negotiable if email is in scope.

**Phase 4 — operational readiness (this is what "deploy it" actually was)**

- **4.1 Metrics and alerting.** Per-channel send/fail/latency; alert on failure rate and
  on queue depth. Do this *before* the rollout, not after.
- **4.2 Rate limiting and fan-out caps.** A per-user ceiling and a global kill switch.
  The kill switch is the single highest-value item in this plan.
- **4.3 Staged rollout.** Internal users → small percentage → full, with dual-run
  against the old system if one exists and a defined comparison window.
- **4.4 Decommission the old path.** Only after the new one has been clean for a
  defined period. Rework isn't done until the old thing is gone.

## The short version

Your three items are real — they're just phases, not tasks, and two of the three
("tests", "deploy") are things that should be folded into every task rather than
appended after all of them. The genuine gap is upstream of all of it: nobody has
decided which channels, what triggers a notification, or what happens to the system
you're replacing. Answer those three questions first and the decomposition mostly
writes itself.
