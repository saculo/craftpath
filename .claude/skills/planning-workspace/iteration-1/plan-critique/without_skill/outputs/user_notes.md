# Notes on the critique

## Assumptions I made

The plan was three sentences, so most of the critique rests on assumptions. Flagging
them so you can discard the parts that don't apply:

- **"Rework" means something exists today.** I assumed there's an existing notification
  path being replaced, which is where the migration/dual-run/decommission tasks come
  from. If this is greenfield and "rework" meant "rethink", drop task 4.4 and the
  migration concerns.
- **More than one channel.** I assumed in-app plus at least email. If it's in-app only,
  phase 3 disappears and the plan gets meaningfully smaller.
- **Multi-user product with a real user base.** The rate-limiting, unsubscribe, and
  staged-rollout emphasis assumes enough users that a fan-out bug is expensive. For an
  internal tool with 30 users this is over-engineered.
- **"Wire up the UI" means a web frontend** you control, not a mobile app. Mobile adds
  push tokens, per-device registration, and store review cycles — none of which I
  covered.
- **Team of more than one.** Part of my objection to large tasks is parallelism. A solo
  developer can carry more context per task, so the sizing pressure is lower (the "one
  reviewable PR" argument still holds though).
- **No hard deadline forcing scope cuts.** If there's a date, phases 3 and 4 are where
  you'd negotiate, not phase 0.

## Uncertainties / where I could be wrong

- **Phase 0 could read as bureaucracy.** If the channel and trigger decisions are
  already settled in someone's head, 0.1 is just writing them down — thirty minutes, not
  a task. I kept it as a task because unstated decisions are the usual cause of a task-1
  swamp, but I may be solving a problem you don't have.
- **My task sizing is a guess.** Without knowing your stack, 1.2 might be an afternoon or
  a week. Treat the decomposition's *shape* as the recommendation, not its granularity.
- **I picked in-app as the first channel.** That's the low-risk default (reversible,
  no external provider), but if email is the actual business driver, sequencing it first
  may be right despite the risk.
- **Async vs sync event ingestion** is a real architectural fork I punted to your 0.1
  rather than recommending. It depends on whether notification latency can be allowed to
  affect user request latency, which I don't know.
- **I may be over-reading "add tests" as a phase.** Some teams write that line meaning
  "and obviously tests throughout." If that's you, item 2 in my critique is a
  vocabulary complaint rather than a substantive one — though I'd still argue the
  wording matters, because written plans outlive the intent behind them.
- **Nothing here was verified against code.** This is a reasoning critique of a plan,
  not an assessment of your codebase.
