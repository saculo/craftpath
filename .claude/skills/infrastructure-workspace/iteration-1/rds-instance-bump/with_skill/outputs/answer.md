# Bumping prod Postgres from db.t3.medium to db.r6g.large

Short version: the Terraform diff is one line, the change itself is an in-place modify (no replacement, no data loss), but it is **not** a no-op — it reboots your production primary, it crosses an architecture boundary (Intel → Graviton/ARM), and it invalidates some of your monitoring and probably a reserved instance. Plan for a window.

I don't have your repo here, so the checks below are things to run yourself. Everything I list is read-only unless I say otherwise.

---

## What actually changes

| | db.t3.medium | db.r6g.large |
|---|---|---|
| vCPU | 2 (burstable, CPU credits) | 2 (sustained, Graviton2 / ARM) |
| Memory | 4 GiB | 16 GiB |
| CPU behaviour | throttled to baseline when credits run out | full 2 vCPU always |
| On-demand cost | baseline | roughly 2–3× (region-dependent — check the calculator) |

Note vCPU count is **unchanged**. If your pain is CPU saturation, you're buying *consistency* (no more credit exhaustion), not more cores. If your pain is cache hit ratio / disk reads, the 4× memory is the real win. Worth being clear which problem you're solving before you spend the money — if CPU credits aren't actually being exhausted, `db.m6g.large` is cheaper for the same vCPU, or `db.r6g.large` is right if you want the RAM.

---

## Pre-flight checks (all read-only)

**1. Is r6g even orderable for your engine version and region?**

```
aws rds describe-orderable-db-instance-options \
  --engine postgres --engine-version <your version> \
  --db-instance-class db.r6g.large --region <region> \
  --query 'OrderableDBInstanceOptions[].{AZ:AvailabilityZones[].Name,MultiAZ:MultiAZCapable,Storage:StorageType}'
```

Graviton classes need a reasonably modern PG (12.x and up, with some minor-version floors). If this comes back empty, you need an engine upgrade first — **do that as a separate change**, not bundled with the resize.

**2. Is there anything already pending on the instance?**

```
aws rds describe-pending-maintenance-actions --region <region>
```

A modify window applies pending actions too. If there's a queued OS or engine patch, it will ride along with your resize and you'll be debugging two changes at once.

**3. Is `instance_class` actually driven by the config you think it is?**

Grep for the value and the variable — in a multi-env module, the same variable default can feed staging and prod, and you want to change prod only:

```
grep -rn "t3.medium" --include=*.tf --include=*.tfvars .
```

Also check the `aws_db_instance` resource for `lifecycle { ignore_changes = [instance_class] }`. If it's there, someone has been resizing by hand — that's drift, and it means the repo has not been the source of truth for this field. Worth raising rather than quietly deleting the ignore.

**4. Read replicas.** If any exist, they do **not** inherit the class. A t3.medium replica behind an r6g primary becomes the new bottleneck, and if it's a failover/promotion target you've just made your DR worse than your prod. Resize replicas *first* (lower stakes, and it rehearses the change), primary last.

---

## The Terraform change

```hcl
resource "aws_db_instance" "prod_postgres" {
  instance_class = "db.r6g.large"   # was db.t3.medium
}
```

Run `terraform plan` and read it before anything else. What you want to see:

```
~ instance_class = "db.t3.medium" -> "db.r6g.large"
```

**A single `~` update, and nothing else.** Stop and escalate if you see:

- `-/+ must be replaced` or `# forces replacement` on the DB instance — that is a destroy-and-recreate of your production database. It should not happen for an instance class change; if it does, something else in the diff (identifier, subnet group, engine, storage encryption) is the real cause and you've picked up an unintended change.
- Anything touching `aws_db_instance` storage, snapshots, or the parameter group you didn't intend.
- More resources in the plan than you expected — a module-wide variable change bleeding into other environments.

Because this touches a stateful production resource, the plan goes in front of a human before apply. That's not ceremony; a replace here is unrecoverable-in-practice even with backups.

### The `apply_immediately` trap

This is the one people get wrong. `aws_db_instance` defaults to `apply_immediately = false`, which means:

- `terraform apply` returns success
- Terraform's state records `db.r6g.large`
- **The database is still db.t3.medium** until the next maintenance window

You now have state that disagrees with reality, and the actual downtime happens unattended at 3am on whatever day the window falls. Pick one deliberately:

- **`apply_immediately = true`** — change happens now, during your chosen window, with you watching. This is what I'd do for a planned resize.
- **leave it false** — accept that the reboot happens in the maintenance window and that Terraform state is optimistic until then. Only reasonable if the window is imminent and someone will be awake.

If you flip `apply_immediately` to true, remember it's a persistent attribute — it will make *future* unrelated modifications immediate too. Set it back afterwards if that's not what you want.

---

## Downtime

There is downtime. How much depends on Multi-AZ:

- **Multi-AZ**: AWS resizes the standby, fails over, then resizes the old primary. Outage is the failover itself — typically 60–120 seconds. Endpoint DNS is unchanged, but every existing connection is dropped.
- **Single-AZ**: the instance is stopped, resized, and started. Realistically 5–15 minutes, sometimes more.

Either way, all connections drop. Before the window, confirm:

- the app reconnects rather than sitting on dead pooled connections (check pool max-lifetime / validation query settings)
- if you run PgBouncer or RDS Proxy, that it drains and reconnects cleanly
- health checks won't cascade into a deploy or autoscaling event while the DB is away

---

## The things that quietly break

**CPU credit alarms become dead weight.** r6g is not burstable — `CPUCreditBalance` and `CPUCreditUsage` stop being emitted. Any CloudWatch alarm on those goes to `INSUFFICIENT_DATA` and never fires again. If that alarm was part of your paging story for "database is starving", you've silently removed a signal. Delete or replace those alarms as part of the same PR, and add a plain `CPUUtilization` alarm if you don't have one.

**Parameter group values that don't scale.** The RDS defaults are formulas over `DBInstanceClassMemory`, so `shared_buffers` and friends scale with the instance automatically. But if you have a custom parameter group with *hardcoded* numbers — a literal `shared_buffers`, `work_mem`, `effective_cache_size`, or `max_connections` — they will not move, and you'll pay for 16 GiB while Postgres uses 4 GiB worth. Check the custom group; if values are hardcoded, updating them is a second change (and static params need their own reboot, so ideally fold that reboot into the same window).

Conversely, if `max_connections` *is* formula-driven, it jumps roughly 4× (~400 → ~1700). More headroom, but it also means a connection storm can now actually reach a number that hurts. If you don't have a pooler, this is worth a thought rather than a shrug.

**Storage may become the new bottleneck.** r6g.large has meaningfully more EBS throughput than t3.medium. If you're on gp2, your IOPS are still tied to volume size and unchanged — you may just move the wait from CPU to I/O. Look at `ReadIOPS`/`WriteIOPS`/`DiskQueueDepth` before and after; gp3 might be the change you actually wanted. Separate PR, though.

**Reserved Instances.** If you have an RI on db.t3.medium, it's now stranded and you're paying on-demand for the r6g on top of it. Check with finance/whoever owns RIs before, not after. RIs are size-flexible within a family, not across families or architectures.

---

## Rollback

Genuinely reversible, which is the good news: set `instance_class` back to `db.t3.medium` and apply. Two caveats to be honest about:

1. Rollback costs the **same downtime again** — another failover or another 5–15 minute outage. It is not a fast undo.
2. If the reason you're rolling back is that prod is under heavy load, a t3.medium may not be able to take that load either. The rollback target is the thing that was already struggling.

So the realistic failure mode isn't "the resize broke something and we reverted" — it's "the resize didn't help and we're out a window plus the cost delta." Take a **manual snapshot before the window** anyway; it's additive, cheap, and it's your only answer if the modify goes sideways in an unexpected way.

---

## Suggested order

1. Confirm r6g orderable for your engine version + region; upgrade engine separately first if not.
2. Check pending maintenance actions.
3. Make the change in **staging** first, on the same engine version. Time the actual outage there — that number is what you tell people.
4. Resize any **read replicas** in prod.
5. Same PR: remove/replace CPU-credit alarms; fix hardcoded parameter group values if any.
6. `terraform plan` for prod, read it for destroy/replace verbs, get it approved by a human.
7. Apply in an announced window with `apply_immediately = true`.
8. Watch `CPUUtilization`, `FreeableMemory`, `DatabaseConnections`, `ReadIOPS`/`DiskQueueDepth` and app error rate for at least a full traffic cycle before calling it done.

One PR per concern where you can — the resize, the alarm cleanup, and any gp3/parameter work are three separate blast radii, and bundling them means a bad night is also an ambiguous night.
