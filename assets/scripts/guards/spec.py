"""Guard for /craftpath-spec <title>: a title, and craftpath on the base branch."""

from craftpath import Refusal, base_branch, config, git_ok, main_root


def check(cwd: str, args: str, command: str) -> None:
    if not args.strip():
        raise Refusal(f"Give the work item a title: {command} <title>")
    root = main_root(cwd)
    base = base_branch(config(root))
    if not git_ok("rev-parse", "--verify", "--quiet", f"{base}^{{commit}}", cwd=root):
        raise Refusal(f'The base branch "{base}" does not exist. Set base_branch in .craftpath/config.toml.')
    if not git_ok("cat-file", "-e", f"{base}:.craftpath/scripts/spec.py", cwd=root):
        raise Refusal(
            f"craftpath's files are not on {base} yet. The work item's worktree is created "
            f"from {base}, so commit .craftpath/ (and the harness files) there first."
        )
