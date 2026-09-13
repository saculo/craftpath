# Build-and-push workflow — why it looks like this

Install the file as `.github/workflows/build-and-push.yml`.

## Authentication: OIDC, not access keys

The workflow assumes an IAM role through GitHub's OIDC provider rather than
storing `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` as repository secrets.
Static keys in CI are long-lived credentials with no natural expiry; every fork,
log, and workflow change is then a potential exposure, and the fix for an
exposure is rotation across every consumer. OIDC credentials last for the job.

This requires one-time setup outside the workflow (see "What this does not do").

`id-token: write` is granted only on the job that needs it, and `contents` stays
`read`. `persist-credentials: false` on checkout stops the job's `GITHUB_TOKEN`
from being left in `.git/config` where later steps — or a build — could read it.

## Pull requests build but do not push

A PR build proves the Dockerfile still builds without mutating anything, and it
runs with no AWS credentials configured at all. Publishing happens only on
`push` to `main`. This keeps read-shaped verification freely runnable and keeps
the write to a shared registry tied to a merge decision.

## Tagging: commit SHA is the real tag

Every image is tagged with the full commit SHA. That tag is immutable and maps
one-to-one back to source, which is what makes rollback and incident forensics
possible. The `main` tag also moves to the newest build as a convenience for
humans, but nothing should deploy by following it — a moving tag means two
deploys of "the same" version can be different images.

Deliberately no `latest`.

## Pinned versions

Every action is pinned to a commit SHA with the human-readable version in a
trailing comment, and the runner is `ubuntu-24.04` rather than
`ubuntu-latest`. A floating tag is a third party's mutable pointer inside your
supply chain; pinning means the pipeline changes when someone chooses to change
it. Renovate/Dependabot can bump these as reviewable PRs.

## Idempotence and re-runs

Re-running the workflow on the same commit rebuilds and re-pushes the identical
SHA tag — an overwrite with equivalent content, not an error and not a new
identity. Nothing in the workflow generates a value per run or assumes a
resource is absent, so a retry during a bad day behaves the same as the first
run.

If ECR tag immutability is enabled on the repository, the re-push of an existing
SHA tag will fail; see user_notes.md.

## Failure behaviour

No `continue-on-error` anywhere, and a 30-minute timeout so a hung build fails
rather than occupying a runner. A failed build fails the workflow loudly.

## Concurrency

Builds are serialised per ref. Superseded PR builds are cancelled to save
runners; `main` builds are never cancelled, so each merged commit reliably
produces an image and there is no gap in the SHA-tagged history.

## Blast radius and rollback

Publishing an image is additive — it creates a new tag and changes no running
workload — so the blast radius is small by design. The dangerous step is
deployment, which this workflow intentionally does not perform.

Rollback for a bad image is to redeploy the previous commit's SHA tag; the image
is still in ECR. There is no rollback for the push itself, and none is needed.

## What this does not do, on purpose

- **It does not create the ECR repository.** The registry, its lifecycle policy,
  scanning settings, and the IAM role belong in your Terraform/CDK, where they
  are reviewed and planned. A pipeline that provisions its own infrastructure
  hides that infrastructure from the plan everyone else reads.
- **It does not deploy.** Build/publish and deploy are separated so that a
  rollback is a deploy of a known-good tag rather than a rebuild.
- **It does not scan or sign.** Worth adding (ECR scan-on-push, or cosign) but
  each is a separate, reviewable change.

## Verification before merging

This can be checked without any real AWS call:

- `actionlint .github/workflows/build-and-push.yml` — syntax, expression, and
  shell checks.
- Open it as a PR against a throwaway branch: the PR path exercises checkout,
  Buildx, and the actual `docker build` with no credentials in play.

The push path cannot be proven without a real push to ECR. Do that once,
knowingly, after the IAM role exists — it is safe to merge first because nothing
deploys — and confirm the tags in the registry. Treat "looks right" as unverified
until that first run is green.
