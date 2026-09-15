# Bumping prod Postgres from db.t3.medium → db.r6g.large

Short version: the Terraform diff is one line, but it's a **reboot of prod** and a **jump to Graviton (ARM)**, so the work is mostly in the pre-flight checks and the cutover plan, not the code change.

Note: I don't have your repo in front of me, so the file paths and module layout below are guesses — adjust to how yours is wired.

---

## 1. What's actually changing

| | db.t3.medium | db.r6g.large |
|---|---|---|
| vCPU | 2 (burstable, CPU credits) | 2 (Graviton2, sustained) |
| RAM | 4 GiB | 16 GiB |
| CPU behaviour | throttles when credits run out | no credit system |
| Arch | x86_64 | arm64 |
| Cost | baseline | roughly 3x on-demand (check the calculator for your region/AZ/Multi-AZ setup) |

This is a good move for a prod Postgres — burstable instances are a bad fit for a database that has a steady baseline load, and 4 GiB is a small shared_buffers/page-cache budget. The 4x memory is the real win.

The ARM switch doesn't affect your application: RDS manages the engine binary, and the wire protocol is identical. Nothing in your app code or connection strings changes.

---

## 2. Pre-flight checks (do these before writing the diff)

**Engine version supports Graviton.** `db.r6g` needs a reasonably modern PostgreSQL — roughly 12.4+. If prod is on an older 11.x or 12.x minor you'll need a minor-version upgrade first, which is a separate change with its own reboot. Confirm against the "Supported DB engines for DB instance classes" page for your exact version before planning anything else.

**Instance class is offered in your region and AZs.** r6g isn't in every AZ everywhere. If you're Multi-AZ, it has to be available in *both* your AZs, or the modify fails partway. This is checkable from the RDS console's modify screen (the dropdown only shows what's actually available) without running anything.

**Parameter group memory formulas.** Most RDS default/derived parameters are expressions over `{DBInstanceClassMemory}` and will scale themselves — `shared_buffers`, `effective_cache_size`, `max_connections`, work_mem-ish derivations. But if your custom parameter group **hardcodes** any of these (a literal `max_connections = 200`, a literal `shared_buffers` in 8kB pages), they will *not* pick up the extra RAM and you'll have paid for memory you don't use. Read the parameter group resource in Terraform and decide which literals should become formulas. Note that some of those are static parameters requiring a reboot — which you're getting anyway, so fold it into the same window.

**Multi-AZ or not.** This determines your downtime and your whole cutover story:
- **Multi-AZ**: AWS modifies the standby, fails over, then modifies the old primary. Outage is the failover itself — typically 60–120 seconds of connection errors. Total operation runs longer than that in the background.
- **Single-AZ**: a straight stop/resize/start. Expect several minutes of hard downtime, occasionally longer.

**Read replicas.** If prod has replicas, their instance class is a *separate* resource/argument and won't change with the primary. Convention is replicas at least as large as the primary — a t3.medium replica behind an r6g.large primary will fall behind on replay. Plan to resize replicas too (usually replicas first, then primary, so you never have an undersized standby).

**Reserved Instances / Savings Plans.** If you have an RI on `db.t3.medium`, RI size flexibility does **not** cross instance families. That RI becomes dead weight and the r6g runs at on-demand. Loop in whoever owns the RI commitments before you apply — this is the part that surprises finance, not the hourly rate.

**Alarms and dashboards.** Any CloudWatch alarm on `CPUCreditBalance` / `CPUCreditUsage` / `BurstBalance` for this instance becomes meaningless — the metric stops being published and the alarm goes to INSUFFICIENT_DATA, which either pages someone or, worse, silently sits there looking green. Delete or replace those in the same PR. Also revisit any `FreeableMemory` threshold expressed as an absolute byte count — it's calibrated for a 4 GiB box.

---

## 3. The Terraform change

Find where the class is set. It's usually one of:
- `variable "db_instance_class"` with a default, overridden in `envs/prod/terraform.tfvars` or `prod.auto.tfvars`
- a `locals` map keyed by environment
- a module input in `envs/prod/main.tf`

Change it **only in the prod path** — if it's a shared default, you'll silently resize staging too. Grep for `t3.medium` across the repo to see everywhere it appears before editing.

Things to check in the `aws_db_instance` resource while you're in there:

- **`apply_immediately`**. If `false` (the default), the resize is queued for the next maintenance window. Terraform will report success, the instance shows `pending-modified-values`, and nothing has actually happened — and your next `plan` may look clean while the box is still a t3. For a scheduled change, I'd rather set `apply_immediately = true` and run the apply *during* your own chosen window, so the change is deterministic and you're watching when it happens. Whichever you choose, be explicit about it.
- **`blue_green_update { enabled = true }`** is worth considering if the failover blip is a problem. It stands up a parallel green environment on the new class, keeps it in sync, and switches over in ~a minute with a rollback path. More moving parts, and it churns endpoints/parameter groups, so only reach for it if seconds of downtime genuinely matter.
- **`lifecycle { ignore_changes = [instance_class] }`** — if someone added this after a manual console resize, your change will plan as a no-op. Worth a look.

---

## 4. Verifying the plan

`terraform plan` against the prod workspace/state. What you want to see:

- `~ instance_class = "db.t3.medium" -> "db.r6g.large"` marked **update in-place**.
- **No `-/+ must be replaced`.** A replacement on `aws_db_instance` destroys the database. If anything shows forced replacement, stop and work out why (it's usually an unrelated attribute drifting, not the class itself).
- **Nothing else in the diff.** Prod state often carries accumulated drift or a provider-version-induced diff. A one-line intent should be a one-line plan; anything extra rides along into prod under cover of this change. Save the plan to a file and apply exactly that artifact.

---

## 5. Cutover

1. Announce the window; confirm no migrations, batch jobs, or deploys are scheduled across it.
2. Take a **manual snapshot** immediately beforehand. Automated backups exist, but a named pre-change snapshot is the thing you actually want at 2am.
3. Check the app's connection pool behaviour: pools that don't handle a dropped connection gracefully will surface this as a longer outage than the database's. Confirm retry/reconnect works, or plan a brief app-side pause.
4. Apply the saved plan. Watch RDS events and your error rate, not just the Terraform output — Terraform returns when the API call settles, which isn't the same as the instance being fully available.
5. After: verify the instance reports the new class and status `available`, confirm `SHOW shared_buffers` / `SHOW max_connections` reflect the larger box, watch `FreeableMemory`, `CPUUtilization`, and replica lag for a full business cycle.

---

## 6. Rollback

Not free. Reverting means another modify and another reboot, plus the resized instance needs the smaller class to still be a valid target. Restoring the snapshot is a new endpoint and loses everything written since. So: the rollback for "it's slower than expected" is another scheduled window, not an instant undo. The genuinely fast-abort path is blue/green, which is part of why it's worth considering.

Realistically, the failure mode here isn't "r6g is worse" — it's the resize hanging on capacity in an AZ, or a hardcoded parameter that doesn't scale. Both are caught by the pre-flight checks above.

---

## Summary of work

| Item | Notes |
|---|---|
| Confirm engine version supports r6g | Blocking — may require a minor upgrade first |
| Confirm r6g available in region + both AZs | Blocking |
| Audit parameter group for hardcoded memory values | Likely a code change in the same PR |
| Resize read replicas | Separate argument; do replicas first |
| Check RI / Savings Plan exposure | Talk to whoever owns the commitment |
| Remove CPU-credit alarms, retune memory alarms | Same PR |
| Edit prod-scoped class variable | The one-liner |
| Decide `apply_immediately` / blue-green | Determines cutover shape |
| Plan review: in-place, no replacement, no extra drift | Blocking |
| Snapshot + apply in window | 60–120s outage Multi-AZ; minutes if Single-AZ |

If you point me at the repo I can find the actual variable, check whether the parameter group has hardcoded values, and draft the PR.
