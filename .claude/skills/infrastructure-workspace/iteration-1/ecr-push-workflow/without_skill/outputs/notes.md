# Notes on the ECR push workflow

## Where the file goes

`docker-publish.yml` here is the deliverable; drop it at `.github/workflows/docker-publish.yml`
in the repo. I did not write into `.github/` directly because this run was scoped to the
outputs directory.

## Design choices

**OIDC instead of access keys.** `aws-actions/configure-aws-credentials@v4` with
`role-to-assume` plus `permissions: id-token: write` mints a short-lived token per run.
The alternative - storing `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` as repo secrets - means
a long-lived credential with ECR write access sitting in GitHub forever, rotated by nobody.
OIDC costs one IAM role to set up and removes the secret entirely. This is the single most
important choice in the file; if you only keep one thing, keep this.

The trust policy on the role should be scoped to the branch, not just the repo:

```json
{
  "Effect": "Allow",
  "Principal": { "Federated": "arn:aws:iam::<acct>:oidc-provider/token.actions.githubusercontent.com" },
  "Action": "sts:AssumeRoleWithWebIdentity",
  "Condition": {
    "StringEquals": {
      "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
      "token.actions.githubusercontent.com:sub": "repo:<org>/<repo>:ref:refs/heads/main"
    }
  }
}
```

Without the `sub` condition any workflow in any repo that can assume the role - including a
PR from a fork if you ever loosen triggers - can push images. The permission policy itself
needs `ecr:GetAuthorizationToken` (on `*`, AWS requires it) plus
`ecr:BatchCheckLayerAvailability`, `ecr:InitiateLayerUpload`, `ecr:UploadLayerPart`,
`ecr:CompleteLayerUpload`, `ecr:PutImage` scoped to the one repository ARN. Not `ecr:*`.

**Trigger is `push` to `main`, not `pull_request`.** "When something merges to main" is a
push event on main - a merge commit landing there fires it. Using `pull_request` with
`types: [closed]` and a `merged == true` check is the other common spelling; it is strictly
worse here because it misses direct pushes and doesn't fire for merges made outside a PR.

**Tags: immutable SHA plus `latest`.** The commit SHA tag is what deployments should
reference - it is unambiguous and lets you roll back by naming an old tag. `latest` is a
convenience for local pulls and should not be what production resolves. If your ECR
repository has tag immutability enabled (recommended), `latest` will fail to re-push; drop
the `type=raw,value=latest` line in that case. Flagged in user_notes.md.

**Concurrency group, no cancel.** Two merges landing seconds apart would otherwise race on
the `latest` tag and the layer cache. `cancel-in-progress: false` is deliberate: killing a
build mid-push leaves partially uploaded layers, and the run that "won" may be the older
commit. Serialising is cheap; a wrong `latest` is not.

**GitHub Actions cache for layers.** `cache-from/cache-to: type=gha` with `mode=max` caches
intermediate layers across runs. On a typical multi-stage build this is the difference
between a six-minute and a ninety-second build. `mode=max` caches intermediate stages too,
which matters for multi-stage Dockerfiles. The cache is scoped per-branch by GitHub with
fallback to the default branch, so main builds warm each other.

**`provenance: false`.** Buildx v0.11+ attaches a provenance attestation by default, which
turns the pushed artifact into a multi-platform image index. Several AWS consumers (older
ECS agents, Lambda container support, some scanners) choke on that index and report "image
not found" for what looks like a normal tag. Turning it off yields a plain single-manifest
image. If you want provenance and your consumers handle OCI indexes, remove this line.

**`environment: production`.** Optional but useful: it lets you attach required reviewers or
branch protections to the deploy step, and scopes any environment-level secrets. Remove it
if you have no such environment configured - an undefined environment name still works but
adds a deployment record you may not want.

## What this intentionally does not do

- **No deploy.** It pushes an image; nothing rolls it out to ECS/EKS/App Runner. That is a
  separate concern with a separate blast radius, and coupling them means a bad build takes
  production down without a gate.
- **No image scanning step.** ECR's own scan-on-push is better than a workflow step: it runs
  out of band and rescans as new CVEs are published. Enable it on the repository.
- **No multi-arch build.** If you run on Graviton, you need `platforms: linux/amd64,linux/arm64`
  plus `docker/setup-qemu-action` (slow) or a matrix across an ARM runner (fast). Not added
  because I don't know your target architecture.
- **No repository creation.** The workflow assumes the ECR repository already exists. Creating
  it from CI would mean giving the role `ecr:CreateRepository`, and the repository's lifecycle
  policy and immutability settings belong in your Terraform, not in a build pipeline.

## Verification path

There is no way to dry-run this meaningfully - Actions only runs on push. The low-risk
sequence: merge it with the `push` trigger commented out and only `workflow_dispatch` active,
run it manually once against a throwaway ECR repository, confirm the image and digest appear,
then enable the `push` trigger. That keeps the first failure off main's critical path.
