"""Guard for /craftpath-pr <work id>: the review has no open point and saw the code proposed."""

from checks import FIELD, check_review, incomplete, review_points
from craftpath import Refusal, git, uncommitted_outside, work_item


def check(cwd: str, args: str, command: str) -> None:
    work_id, work = work_item(args, command, cwd)
    path = work / "REVIEW.md"
    if not path.exists():
        raise Refusal(f"There is no REVIEW.md yet -- run /craftpath-review {work_id} first.")
    incomplete("REVIEW.md", check_review(work))
    text = path.read_text()
    open_points = [line for state, _, line in review_points(text) if state == " "]
    if open_points:
        listed = "\n".join(open_points)
        raise Refusal(
            "These review points are open -- fix each and run /craftpath-review "
            f"{work_id} again, or mark it won't fix:\n{listed}"
        )
    root = work.parents[2]
    reviewed = dict(FIELD.findall(text))["Reviewed at"].strip()
    own = f":(exclude){work.relative_to(root)}"
    changed = git("log", "--format=%h %s", f"{reviewed}..HEAD", "--", ".", own, cwd=root)
    if changed:
        listed = "\n".join(f"- {line}" for line in changed.splitlines())
        raise Refusal(f"The code changed after the review -- run /craftpath-review {work_id} again:\n{listed}")
    dirty = uncommitted_outside(root, work)
    if dirty:
        listed = "\n".join(f"- {path}" for path in dirty)
        raise Refusal(f"Commit or discard these changes first -- the review did not see them:\n{listed}")
