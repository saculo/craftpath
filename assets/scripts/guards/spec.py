"""Guard for /craftpath-spec <title>: a short title, and craftpath set up on the base branch."""

from craftpath import WORKTREES, Refusal, base_branch, config, git_ok, main_root

MAX_WORDS = 6


def check(cwd: str, args: str, invoked: str) -> None:
    if not args.strip():
        raise Refusal(f"Give the work item a title: {invoked} <title>")
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
