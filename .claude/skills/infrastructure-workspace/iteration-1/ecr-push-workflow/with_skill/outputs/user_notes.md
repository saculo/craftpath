# Notes for you — assumptions, uncertainties, workarounds

## Things I assumed (please check these)

1. **There is a `Dockerfile` at the repository root.** I did not find one in
   this repo. If it lives elsewhere, or there are several, change `file:` and
   `context:` in the build step.
2. **The branch is called `main`.** You said "main", so the triggers use `main`.
   Worth confirming, since this repo's default branch is currently `master` —
   if that is the real deploy branch, change both `branches:` lists.
3. **The ECR repository already exists**, managed by your IaC. The workflow
   pushes to it but never creates it. If it does not exist yet, the first push
   fails with `RepositoryNotFoundException`.
4. **A GitHub OIDC identity provider and an IAM role already exist in the AWS
   account.** If not, this workflow cannot authenticate at all — that setup is a
   prerequisite, not something the workflow bootstraps.
5. **`linux/amd64` only.** If anything runs on Graviton or you want multi-arch,
   add `linux/arm64` to `platforms` — note this roughly doubles build time
   unless you add a native arm64 runner.
6. **You want SHA-based deploys.** The tag strategy assumes deploys reference
   the commit SHA tag, not `main`.

## Configuration you must add before this works

| Where | Name | Example |
|---|---|---|
| Repository **variable** | `AWS_REGION` | `eu-central-1` |
| Repository **variable** | `ECR_REPOSITORY` | `craftpath` |
| Repository **secret** | `AWS_ROLE_ARN` | `arn:aws:iam::123456789012:role/gha-ecr-push` |

The role's trust policy should restrict the OIDC subject to this repository and
ideally to `ref:refs/heads/main` — a role trusted for `repo:org/repo:*` can be
assumed from any branch or PR in the repo, which gives anyone who can open a
branch the ability to push images. Its permission policy needs only
`ecr:GetAuthorizationToken` (on `*`, as AWS requires) plus the
`ecr:BatchCheckLayerAvailability` / `ecr:InitiateLayerUpload` /
`ecr:UploadLayerPart` / `ecr:CompleteLayerUpload` / `ecr:PutImage` set scoped to
the one repository ARN. Not `ecr:*`.

I did not write the Terraform for this because I do not know which IaC tool or
account layout you use, and it belongs next to your other AWS resources rather
than invented here. Happy to draft it if you tell me where it should go.

## Genuine uncertainties

- **The pinned action SHAs are from memory and I could not verify them offline.**
  Before merging, confirm each SHA actually corresponds to the tag in the
  comment — e.g.
  `git ls-remote https://github.com/actions/checkout refs/tags/v4.2.2`.
  A wrong-but-valid SHA would silently run different code; a wrong-and-invalid
  one fails fast. Please do not skip this check. The same applies to the action
  versions themselves being current as of today.
- **`provenance: false`** is set because Buildx's default attestation produces an
  OCI image index that some ECR configurations and older consumers (certain ECS
  agent / Lambda paths) refuse to pull. If your tooling handles it fine and you
  want provenance, remove that line — but test a real deploy afterwards.
- **ECR tag immutability.** If the repository has immutable tags enabled, the
  `main` tag cannot be moved and re-running a build for an existing SHA will
  fail. In that case drop the `type=raw,value=main` line and rely on SHA tags
  only. I do not know your current setting.
- **GitHub Actions cache (`type=gha`)** is scoped per branch with limited
  cross-branch reuse and a 10 GB repo-wide eviction limit, so hit rates on `main`
  may be mediocre. If builds are slow, ECR-backed registry cache is the better
  option — it is a small change but needs extra IAM permissions.

## Workarounds / compromises

- The job `name:` uses a conditional expression purely for a readable UI label.
  Cosmetic; delete it if you dislike expressions in names.
- PR builds push nothing, which means the push path is not exercised until a
  merge lands. That is the correct trade (no credentials on PRs, including from
  forks), but it does mean the first real validation of the push happens on
  `main`. Since nothing deploys off this workflow, a failure there is noisy
  rather than harmful.
- I could not run `actionlint` or any AWS command here, so this workflow is
  **unverified by execution** — reviewed by inspection only. Run `actionlint`
  locally and let the first PR build stand as the real evidence.
