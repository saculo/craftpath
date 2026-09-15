# User notes — RDS instance class bump

## Scope of what I could actually check

- Searched `/home/lgrula/Projects/craftpath` for `*.tf` files: **none exist**. There is no Terraform codebase here, so nothing in the answer is grounded in the user's real config.
- Ran **no** cloud or Terraform commands (explicit constraint, and correct regardless — the useful ones here are read-only but still hit a real account).
- Modified no existing file; wrote only into the outputs directory.

## Assumptions made

1. **Engine is PostgreSQL on RDS**, not Aurora. This matters — Aurora's resize semantics and parameter-group behaviour differ (Aurora has no `apply_immediately` reboot in the same shape, and writer/reader failover works differently). If it's Aurora PostgreSQL, the `aws_db_instance` advice needs rewriting against `aws_rds_cluster_instance`.
2. **Single `aws_db_instance` resource**, class set either literally or via a variable. Did not assume a specific module structure.
3. **Multi-AZ status unknown** — covered both branches explicitly rather than guessing, since the downtime estimate swings from ~90s to ~15min on it.
4. **Read replicas: existence unknown.** Flagged conditionally.
5. **Custom parameter group: existence unknown.** The hardcoded-values warning is conditional.
6. Assumed the user has CloudWatch alarms of some kind; the CPU-credit-alarm point is the highest-value item in the answer and is worth stating even if they don't.

## Uncertainties / things I deliberately did not pin down

- **Cost multiple.** Said "roughly 2–3×" rather than quoting a figure. On-demand RDS pricing varies by region and I can't verify current numbers; a confident wrong price is worse than a range plus "check the calculator."
- **Engine version floor for Graviton.** Said "12.x and up, with some minor-version floors" rather than naming an exact minimum — the floors have shifted across AWS announcements and I'd rather the user run `describe-orderable-db-instance-options`, which is authoritative and read-only.
- **Downtime numbers** (60–120s Multi-AZ, 5–15min single-AZ) are typical-case, not contractual. Told the user to time it in staging and use *that* number when announcing — this is the honest workaround for an estimate I can't guarantee.
- **`max_connections` formula result** (~400 → ~1700) is derived from the standard `DBInstanceClassMemory/9531392` default and rounded loosely. Presented as approximate.
- **RI size-flexibility**: stated that RIs are flexible within a family but not across families/architectures. Confident, but the user should confirm with whoever owns their RI/Savings Plan portfolio before assuming the delta.

## Workarounds / judgement calls

- Since there's no repo to inspect, I converted every "I would check X" into a **command or grep the user can run themselves**, all read-only. This keeps the answer actionable without me fabricating findings about a config I've never seen.
- Chose to lead with the `apply_immediately` trap prominently rather than burying it — it's the failure mode where Terraform reports success while state and reality diverge, which is the least obvious and most damaging item on the list.
- Deliberately pushed three things *out* of this change (engine upgrade, gp2→gp3, parameter group rewrite) rather than folding them in, on blast-radius grounds, while still naming them so they don't get forgotten.
- Raised the "vCPU count is unchanged" point up front. The user asked *what's involved*, not *should I* — but if they're bumping to fix CPU saturation, 2 vCPU → 2 vCPU is a surprise worth surfacing before they spend the money. Framed as information, not as blocking their decision.
- Noted `lifecycle { ignore_changes }` on `instance_class` as possible evidence of manual resizing, and recommended surfacing it as drift rather than silently removing it.

## What I did not produce

- No artifact published — the task specified `answer.md` as the deliverable and this is advisory content the user acts on directly.
- No proposed diff/PR, since there is no file to diff against.
