"""`/craftpath-review <work id>`: run every module's tests, then create or reuse REVIEW.md.

Runs after the guard has found every task done and committed. When a module's
tests fail, prints their output and changes nothing. Otherwise creates
REVIEW.md from the template, or keeps the existing one with all its points,
records the commit reviewed, and prints what to review: the range, its
commits and files, the open points and the next free point id.
"""

import re
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import module_paths, review_points  # noqa: E402
from craftpath import Refusal, TestsFailed, branch_base, from_template, git, run_tests, title_of, work_item  # noqa: E402

REVIEWED_AT = re.compile(r"^- \*\*Reviewed at:\*\*.*$", re.M)


def main(args: str) -> None:
    work_id, work = work_item(args, "/craftpath-review")
    root = work.parents[2]
    paths = module_paths(root)
    run_tests(root, sorted(paths), paths)

    path = work / "REVIEW.md"
    head = git("rev-parse", "HEAD", cwd=root)
    if path.exists():
        text = path.read_text()
        reviewed = f"- **Reviewed at:** {head}"
        text = REVIEWED_AT.sub(reviewed, text, 1) if REVIEWED_AT.search(text) else text.replace("\n", f"\n\n{reviewed}\n", 1)
        path.write_text(text)
        state = "already exists -- re-check its open points"
    else:
        text = from_template(work, "REVIEW.md", {"ID": work_id, "TITLE": title_of(work), "SHA": head})
        path.write_text(text)
        state = "created"

    base = branch_base(root)
    own = f":(exclude){work.relative_to(root)}"
    print(f"\nWork item {work_id}: {title_of(work)}")
    print(f"  review: {path} ({state})")
    print(f"  spec:   {work / 'SPEC.md'}")
    print(f"  plan:   {work / 'PLAN.md'}")
    print(f"\nReview {base[:7]}..{head[:7]}, every module's tests green.")
    print("Commits:")
    print("\n".join(f"  {line}" for line in git("log", "--reverse", "--format=%h %s", f"{base}..HEAD", cwd=root).splitlines()))
    print("Files changed:")
    print("\n".join(f"  {f}" for f in git("diff", "--name-only", f"{base}..HEAD", "--", ".", own, cwd=root).splitlines()))
    points = review_points(text)
    open_points = [line for state, _, line in points if state == " "]
    print("Open points:" if open_points else "Open points: none")
    for line in open_points:
        print(f"  {line}")
    highest = max((int(rid[1:]) for _, rid, _ in points), default=0)
    print(f"next point: R{highest + 1}")


if __name__ == "__main__":
    try:
        main(" ".join(sys.argv[1:]))
    except (Refusal, TestsFailed) as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
