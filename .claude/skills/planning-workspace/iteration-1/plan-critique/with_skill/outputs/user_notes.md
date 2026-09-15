# User Notes — Notifications Plan Critique

## What I was given

Three task titles and nothing else: build the service and wire up the UI, add
tests, deploy. No requirement document, no scenarios, no existing plan file, no
codebase. The critique is therefore about the *shape* of the decomposition,
which I can assess from the titles alone, plus the gaps the titles imply.

## Assumptions I made

None of these were stated. Each one changes the corrected decomposition if
wrong, so they are worth a look before treating the task list as real.

1. **"Rework" means replacing something that exists.** This drove T9 (cutover
   behind a flag) and T10 (decommission). If notifications are brand new, drop
   both and delete the flag from T1.
2. **Channels are in-app plus email.** Push or SMS each add a delivery task
   parallel to T4. In-app only would collapse T4 and T5 substantially.
3. **Dispatch is event-driven over a queue.** I assumed an async consumer, which
   is why T1 provisions a queue and dead-letter queue and why `messaging-eda`
   appears on T2 and T4. Synchronous in-process sending makes T1 much smaller
   and removes the DLQ criteria.
4. **User preferences are in scope.** Very common in a notifications rework and
   easy to have implied by "the UI", but genuinely a scope decision. If out,
   drop T5 and T8 and say so explicitly under out-of-scope, or someone will
   build it anyway.
5. **The feed polls; it is not real-time.** If the bell must update live, add a
   transport task (SSE or WebSocket) with its own infra work, and T6's
   acceptance criteria change.
6. **Java backend, TypeScript/React frontend.** Inferred from the skills
   available in this project. Selector syntax (`Class#method` versus
   `file > test name`) follows that guess and should be rewritten to whatever
   the actual runner uses.
7. **Verification commands are `test-unit`, `test-integration`, `test-infra`.**
   Placeholders. Replace with the project's real command names — a selector
   bound to a command that doesn't exist is as useless as no selector.
8. **One event type to start (order-shipped).** Used as a concrete example so
   the criteria could name real inputs. The real first event type comes from the
   requirement.

## Uncertainties

- **Task count.** Eleven tasks against three is a big expansion, and splitting
  has a real cost — several of these load overlapping context. T5 could
  plausibly fold into T4, and T7 into T6, if the team prefers fewer, larger
  units. I kept them apart because each changes a distinct observable behavior,
  but this is a judgment call, not a rule.
- **Whether T1 truly blocks T2.** It does if the consumer can't start without a
  queue. With a testcontainer or embedded broker for local development, T2 could
  begin in parallel and only integration-in-staging would block. I left the edge
  in because the cheap failure direction is under-declaring, and here the
  constraint looked real.
- **Backfill.** I put "backfill historical notifications" under T9's
  out-of-scope, but if users expect their existing notification history to
  appear in the new feed, that is a real task I have not written.
- **Whether the user wants a corrected decomposition at all.** They asked
  whether the plan holds up. I gave the assessment first and the decomposition
  as a shape to react to, flagged as assumption-dependent rather than as a
  deliverable to adopt.

## Workarounds

- **No codebase to check against**, per the constraints, so nothing here is
  grounded in real module names, existing test conventions, or the current
  notification code. Every selector is invented and needs replacing with a name
  that fits the repo's conventions.
- **No requirement scenarios**, so plan-gate check 1 ("every scenario maps to a
  criterion") cannot pass. Rather than fake scenarios to make the checklist
  green, I marked it blocked and made closing that gap the first next step. A
  green checklist built on invented scenarios would be worse than an honest red
  one.

## Files written

Both inside the outputs directory; nothing else in the repository was touched.

- `/home/lgrula/Projects/craftpath/.claude/skills/planning-workspace/iteration-1/plan-critique/with_skill/outputs/critique.md`
- `/home/lgrula/Projects/craftpath/.claude/skills/planning-workspace/iteration-1/plan-critique/with_skill/outputs/user_notes.md`
