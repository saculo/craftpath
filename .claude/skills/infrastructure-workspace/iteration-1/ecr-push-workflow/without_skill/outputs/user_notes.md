# User notes: assumptions and open questions

## Assumptions I made

1. **Branch name.** You said "main", so the trigger is `branches: [main]`. Worth noting that
   this repo's current branch is `master`. If the default branch really is `master`, change
   the trigger and the IAM trust policy's `sub` condition together - they must match or the
   job fails at the credentials step.
2. **A Dockerfile exists at the repo root** with build context `.`. If it lives elsewhere
   (e.g. `docker/Dockerfile`, or a monorepo subdirectory), adjust `context:` and `file:` in
   the build step.
3. **One image per repo.** If you build several images, this becomes a matrix over
   (dockerfile, ecr-repository) pairs rather than a single job.
4. **The ECR repository already exists** and is in the same AWS account the role lives in.
5. **linux/amd64 target.** No multi-arch build configured.
6. **You can create an IAM role and (if not already present) the GitHub OIDC identity
   provider in the account.** If you cannot, the workflow needs rewriting to use static
   access keys - tell me and I'll do that, but it is a meaningful security downgrade.

## Things I could not determine and you should check

- **Tag immutability.** If the ECR repo has `imageTagMutability: IMMUTABLE`, pushing `latest`
  on the second run fails with `ImageTagAlreadyExistsException`. Either drop the `latest`
  tag from the metadata step or set the repo to mutable. I left `latest` in because it is the
  more common setup, but this is the most likely cause of a first failure.
- **Region and account.** Left as repository variables rather than hardcoded. Nothing works
  until you set `AWS_REGION`, `AWS_ACCOUNT_ID`, `ECR_REPOSITORY`, and `AWS_ROLE_ARN` under
  Settings -> Secrets and variables -> Actions -> Variables.
- **Whether you want a `production` environment gate.** I included `environment: production`.
  If that environment doesn't exist, GitHub creates a deployment record for it silently -
  harmless but noisy. Remove the line if you don't use environments.
- **Whether a deploy should follow.** This only pushes. If merging to main should also roll
  out to ECS/EKS, that's a follow-up, and I'd argue for a separate gated workflow triggered
  by this one's success rather than a step inside this job.

## Risk notes

- The role this workflow assumes can write to your ECR repository. Anyone who can merge to
  main can therefore publish an image your infrastructure may deploy. Branch protection on
  main is load-bearing here, not optional.
- Pinning: actions are pinned to major versions (`@v4`, `@v6`). That gets you security fixes
  automatically but means an upstream change can alter behaviour without a commit on your
  side. If your threat model calls for it, pin to full commit SHAs and let Dependabot bump
  them.
- I have not run or validated this against a live AWS account - no cloud commands were
  executed. Treat the first run as the real test, ideally against a throwaway repository as
  described in notes.md.
