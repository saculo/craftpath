# Notes: assumptions and uncertainties

## Assumptions made

- **AWS RDS for PostgreSQL**, not Aurora. Aurora changes the picture (no Multi-AZ standby in the same sense, replicas are cluster members, failover semantics differ). If it's Aurora PostgreSQL, the resource is `aws_rds_cluster_instance` and the writer/reader ordering advice changes.
- **Terraform, not CDK/Pulumi/CloudFormation**, and the resource is `aws_db_instance` from the `hashicorp/aws` provider.
- Typical repo layout: per-environment directories or workspaces with a variable or locals map holding the instance class. I did not verify this — the paths in the answer are illustrative.
- The user has authority to schedule a prod maintenance window, and there is an existing change/approval process I don't know the shape of.
- Prod is likely Multi-AZ (common for prod) but I covered both cases rather than assuming.

## Uncertainties the user should verify

- **Minimum PostgreSQL version for db.r6g.** I stated "roughly 12.4+". This is from memory and the exact minor version cutoff varies by major version line. Must be checked against AWS's supported-instance-classes documentation for their specific engine version. This is the most likely thing in the answer to be slightly wrong, and it's a blocking check.
- **Cost multiple (~3x).** Deliberately given as a rough ratio, not dollar figures — pricing varies by region, Multi-AZ, and license, and my numbers could be stale. Told them to use the calculator.
- **r6g regional/AZ availability.** Real constraint, but which regions/AZs is current-state information I can't confirm.
- **Blue/green deployment support** for RDS PostgreSQL exists, but version/configuration prerequisites apply (e.g. logical replication settings) that I didn't enumerate.
- **Downtime figures (60–120s Multi-AZ, "several minutes" Single-AZ)** are typical-case estimates, not guarantees. Real-world tail is longer.

## Things I deliberately did not do

- Did not run any terraform, AWS CLI, or cloud command (per constraints, and correct regardless — this is a read/plan-first change).
- Did not inspect or modify anything in the project repo.
- Did not write the actual diff, since I have no repo to locate the variable in.

## Judgement calls

- Led with "the diff is one line, the work is elsewhere" because the user's question ("what's involved") reads as someone who already knows the edit and is asking about blast radius.
- Included the Reserved Instance point prominently — it's non-obvious, costs real money, and RI size flexibility genuinely does not span instance families.
- Included the CPU-credit alarm cleanup because a stale alarm going to INSUFFICIENT_DATA is a quiet way to lose monitoring on a prod database.
- Flagged `lifecycle ignore_changes` and plan-shows-replacement explicitly; both are cheap to check and catastrophic to miss.
