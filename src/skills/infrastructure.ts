/** The `infrastructure` skill, written to `.claude/skills/infrastructure/SKILL.md` by `craftpath init`. */
export const INFRASTRUCTURE_SKILL = `---
name: infrastructure
description: Change infrastructure safely — declarative configuration, plan-before-apply discipline, idempotence, state and secret handling, blast radius, and rollback. Use whenever a task touches infrastructure-as-code, CI or CD pipelines, containers, Kubernetes manifests, cloud resources, networking, DNS, IAM, or deployment configuration. Trigger on mentions of terraform, infra, provisioning, deploys, environments, clusters, pipelines, or "why did the deploy break". Use it before running anything that mutates a real environment, because the expensive mistakes here are the ones that are hard to reverse.
---

# Infrastructure

Infrastructure changes differ from application changes in one way that governs
everything else: the blast radius is larger and the undo button is unreliable.
A bad deploy of application code is rolled back. A deleted database is restored
from a backup, if the backup works.

Work accordingly. Slower is usually correct here.

## Declarative, and actually the source of truth

Every change goes through the configuration, never through a console or an
imperative command against a live environment. A manual fix works immediately and
then silently diverges, so the next person's plan proposes to undo it.

If you find drift — something in the environment that the configuration does not
describe — say so explicitly rather than quietly reconciling it. Drift is
evidence about how the system is really operated, and it usually means someone
was blocked and worked around the tooling.

## Read the plan before you change anything

The generated plan is the single best safety mechanism available, and it only
helps if it is actually read. Before applying anything, check:

- what is being **destroyed** or **replaced** — these are the dangerous verbs
- whether a resource you expected to update is instead being recreated
- whether the change touches more resources than the task calls for
- whether anything stateful is in the list

A replacement of a stateful resource — a database, a volume, a queue with
in-flight messages — is a data-loss event wearing the costume of a routine
update. Stop and raise it rather than proceeding.

**Say which one it is, in words, before anyone applies anything.** "This updates
in place" and "this replaces the instance" are different changes with different
consequences, and a reader skimming a plan will not work it out for themselves.
Name the verb you saw.

Surface the plan for a human when the change destroys, replaces, or touches
anything holding data. Not as a suggestion to consider — state it as a
requirement of the change: *the plan goes in front of a person before apply.*
An implied approval ("stop and work out why", "this is blocking") is one a tired
operator reads straight past at 2am. The cost of asking is a minute; the cost of
not asking can be unrecoverable.

Be equally direct about rollback. Say whether a real rollback position exists,
what it costs — usually the same downtime again — and whether the thing you would
roll back to can actually carry the load that made you change it. "Revert the
variable and re-apply" is not a rollback if the previous size is what was
failing.

## Test-first applies here too, in the form the tooling allows

The repo rule (\`.claude/rules/tdd.md\`) is not suspended because the subject is a
cluster instead of a class. The equivalents:

- write the policy check, conftest rule, or plan assertion that fails against
  today's configuration, then make the configuration satisfy it
- for a limit or a guard, assert the rejection first — a request over the cap is
  refused at the edge — and confirm that assertion fails before the limit exists
- assert idempotence as a check, not a hope: applying twice produces no diff on
  the second run is a testable claim, so test it

Where a criterion genuinely can only be proven by applying to a real environment,
say so in the plan and get the apply approved. Do not quietly downgrade it to
"verified by inspection".

## Read and write are not the same risk

Treat these categories differently, and never blur them:

| Safe to run freely | Requires explicit approval |
|---|---|
| plan, validate, diff, describe, get | apply, destroy, delete |
| dry runs | force pushes to shared branches |
| reading logs and state | anything against production |

A command that only reads can be run to answer a question. A command that mutates
is a decision, and decisions in shared environments belong to a person.

## Idempotence

Applying the same configuration twice must produce the same result. A change that
only works the first time will be run a second time — during a retry, a
re-deploy, or a recovery — and will fail exactly when things are already going
badly.

Watch for configuration that depends on current state, generates a new value on
each run, or assumes a resource does not yet exist.

## State and secrets

Remote state is shared, mutable, and the one thing that cannot be rebuilt from
the repository. Lock it, back it up, never edit it by hand, and never commit it.

Secrets never enter the repository, the plan output, the logs, or an environment
variable printed during CI. Reference them from a secret store and keep them out
of anything that gets written down or shipped to a log aggregator.

If a secret is exposed, rotating it is the fix. Deleting the commit is not —
assume anything pushed has been read.

## Blast radius

Before applying, know the answer to: *if this is wrong, what breaks and who
notices?*

Reduce the radius where you can:

- change one environment at a time, lowest-stakes first
- separate the change that adds capacity from the change that removes it
- prefer additive steps that leave the previous path working
- roll out gradually when the tooling supports it

Removing the old path in the same change as adding the new one means there is no
position to retreat to.

## Rollback

Know the rollback before applying, and be honest about whether it exists.
Some changes genuinely cannot be rolled back — a deleted resource, a destructive
migration, a rotated credential other systems already picked up. For those, the
protection is care beforehand, not a plan to undo it afterwards.

Write the rollback down in the task notes when it is not obvious. The person who
needs it will be under time pressure.

## Pipelines

CI configuration is infrastructure with the same rules. In particular:

- **Pin to an immutable reference, not a moving tag.** \`@v4\` is a pointer the
  publisher can repoint; a commit SHA is not. For any step holding credentials —
  a cloud role, a registry push, a deploy — pin the full SHA and put the version
  in a trailing comment (\`uses: actions/checkout@11bd719… # v4.2.2\`). A floating
  major tag on a step with write access to your registry is a supply-chain
  dependency you have not reviewed.
- **Scope credentials to the job and the moment.** Grant the token permission at
  job level rather than workflow level, request it only on the path that
  publishes, and avoid persisting checkout credentials into \`.git/config\` for
  later steps to inherit.
- Prefer short-lived identity (OIDC role assumption) over stored long-lived keys.
  Where a trust policy allows it, scope it to the repository *and* the branch —
  a repo-only condition is assumable from any workflow in that repo.
- Never echo a credential, and remember that a value interpolated into a \`run:\`
  block can land in the log.
- Make a failing pipeline fail loudly rather than continue on error, and bound it
  with a timeout so a hung job fails instead of burning a runner.
- Tag published artifacts with something traceable — the commit SHA — not only a
  moving tag like \`latest\`. Rollback means naming an old version, and \`latest\`
  cannot be named.
- Treat a pipeline that must be re-run to pass as a defect, not a quirk.

## Verifying the work

Prefer verification that does not require a real apply: validation, formatting,
policy checks, plan output, and a dry run against a throwaway environment.

Where a criterion can only be proven by applying, say so plainly and get the
apply approved rather than performing it and reporting afterwards.

Then run the real verification command and let its evidence stand. An
infrastructure change that was "verified by inspection" has not been verified.
`;
