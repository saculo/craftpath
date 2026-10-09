"""Guard for /craftpath-spec <title>: a short title, and craftpath set up on the base branch.

For /craftpath-spec <work id> <answers>, a revision of that work item's spec:
the work item exists and has no plan yet -- once planned, its spec is fixed.
"""

from craftpath import WORK_ID_ARG, WORKTREES, Refusal, base_branch, config, git_ok, main_root, work_item

MAX_WORDS = 6


def check(cwd: str, args: str, invoked: str) -> None:
    if not args.strip():
        raise Refusal(f"Give the work item a title: {invoked} <title>")
    if WORK_ID_ARG.match(args.split()[0]):
        work_id, work = work_item(args, invoked, cwd)
        if (work / "PLAN.md").exists():
            raise Refusal(
                f"{work_id} already has a PLAN.md, so its spec can no longer be revised: the plan "
                "was made from it. Start a new work item for the change instead."
            )
        return
    if len(args.split()) > MAX_WORDS:
        raise Refusal(
            f"Give the work item a short title, at most {MAX_WORDS} words -- it names the branch "
            "and the worktree. Put the request itself in SPEC.md."
        )
    root = main_root(cwd)
    base = base_branch(config(root))
    if not git_ok("rev-parse", "--verify", "--quiet", f"{base}^{{commit}}", cwd=root):
        raise Refusal(f'The base branch "{base}" does not exist. Set base_branch in .craftpath/config.toml.')
    if not git_ok("cat-file", "-e", f"{base}:.craftpath/scripts/spec.py", cwd=root):
        raise Refusal(
            f"craftpath's files are not on {base} yet. The work item's worktree is created "
            f"from {base}, so commit .craftpath/ (and the harness files) there first."
        )
    if not git_ok("check-ignore", "-q", f"{WORKTREES}/C-00000", cwd=root):
        raise Refusal(
            f"{WORKTREES}/ is not git-ignored, so a work item's worktree would show as changes "
            "in this checkout. Run craftpath init and commit .gitignore."
        )
