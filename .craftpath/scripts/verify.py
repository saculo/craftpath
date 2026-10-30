"""`/craftpath-verify <work id>`: run every module's tests, then create or reuse VERIFY.md.

Runs after the guard has found every task done and committed. When a module's
tests or checks fail, prints their output and changes nothing. Otherwise
commits the work step's decisions when they are uncommitted, creates VERIFY.md
from the template, or keeps the existing one with all its points, records the
commit verified, commits VERIFY.md once no point is open, and prints what to
verify: the spec, the plan, the range, its commits and files, the open points
and the next free point id.
"""

import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import module_paths, open_fixes, verify_closed, verify_points  # noqa: E402
from craftpath import Refusal, TestsFailed, branch_base, command, commit_files, from_template, git, run_tests, title_of, work_item  # noqa: E402

VERIFIED_AT = re.compile(r"^- \*\*Verified at:\*\*.*$", re.M)
ROUND_OPTION = re.compile(r"\s*--round[ =]+(\S+)")
MAX_ROUNDS = 2


def split_round(args: str) -> tuple[str, int]:
    """The arguments without `--round <n>`, and the round (1 when absent).

    The fix loop passes the round; this script is the one place that caps it.
    """
    found = ROUND_OPTION.search(args)
    if not found:
        return args, 1
    if not found.group(1).isdigit() or int(found.group(1)) < 1:
        raise Refusal(f"--round takes a number from 1, not {found.group(1)!r}")
    return ROUND_OPTION.sub("", args, 1), int(found.group(1))


def main(args: str) -> None:
    args, verify_round = split_round(args)
    work_id, work = work_item(args, command("verify"))
    root = work.parents[2]
    if verify_round > MAX_ROUNDS:
        path = work / "VERIFY.md"
        left = open_fixes(path.read_text()) if path.exists() else []
        listed = "".join(f"\n  {line}" for _, line in left)
        raise Refusal(
            f"Round {verify_round} is refused: verify stops after {MAX_ROUNDS} rounds."
            + (f" Still open [fix] points:{listed}" if left else "")
        )
    paths = module_paths(root)
    run_tests(root, sorted(paths), paths)

    # The work step gathered its decisions; commit them so learn and pr find
    # them. The verify agents are not given them.
    decisions = commit_files(work, work_id, "decisions", [work / "DECISIONS.md"])
    if decisions:
        print(f"  decisions: {decisions}")

    path = work / "VERIFY.md"
    exists = path.exists()
    head = git("rev-parse", "HEAD", cwd=root)
    if exists:
        text = path.read_text()
        verified = f"- **Verified at:** {head}"
        text = VERIFIED_AT.sub(verified, text, 1) if VERIFIED_AT.search(text) else text.replace("\n", f"\n\n{verified}\n", 1)
        path.write_text(text)
        state = "already exists -- re-check its open points"
    else:
        text = from_template(work, "VERIFY.md", {"ID": work_id, "TITLE": title_of(work), "SHA": head})
        path.write_text(text)
        state = "created"

    # A closed VERIFY.md is the verify record, not pending work for the PR step.
    # Leave a newly-created template uncommitted so the verifier can fill it in.
    if exists:
        try:
            verify_closed(work, work_id)
        except Refusal:
            pass
        else:
            commit_files(work, work_id, "verify", [path])

    base = branch_base(root)
    own = f":(exclude){work.relative_to(root)}"
    print(f"\nWork item {work_id}: {title_of(work)}")
    print(f"  verify: {path} ({state})")
    print(f"  spec:   {work / 'SPEC.md'}")
    print(f"  plan:   {work / 'PLAN.md'}")
    print(f"\nVerify {base[:7]}..{head[:7]}, every module's tests green.")
    print("Commits:")
    print("\n".join(f"  {line}" for line in git("log", "--reverse", "--format=%h %s", f"{base}..HEAD", cwd=root).splitlines()))
    print(f"Diff: git diff {base}..{head} -- . ':{own[1:]}'")
    print("Files changed:")
    print("\n".join(f"  {f}" for f in git("diff", "--name-only", f"{base}..HEAD", "--", ".", own, cwd=root).splitlines()))
    points = verify_points(text)
    open_points = [line for state, _, line in points if state == " "]
    print("Open points:" if open_points else "Open points: none")
    for line in open_points:
        print(f"  {line}")
    highest = max((int(fid[1:]) for _, fid, _ in points), default=0)
    print(f"next point: F{highest + 1}")


if __name__ == "__main__":
    try:
        main(" ".join(sys.argv[1:]))
    except (Refusal, TestsFailed) as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
