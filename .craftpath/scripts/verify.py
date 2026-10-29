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
from checks import module_paths, verify_closed, verify_points  # noqa: E402
from craftpath import Refusal, TestsFailed, branch_base, command, commit_files, from_template, git, run_tests, title_of, work_item  # noqa: E402

VERIFIED_AT = re.compile(r"^- \*\*Verified at:\*\*.*$", re.M)


def main(args: str) -> None:
    work_id, work = work_item(args, command("verify"))
    root = work.parents[2]
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
