"""Guard for /craftpath-review-fix <work id>: a review exists, every task is done, and a point is open."""

from checks import plan_tasks, review_points
from craftpath import Refusal, command, work_item


def check(cwd: str, args: str, invoked: str) -> None:
    work_id, work = work_item(args, invoked, cwd)
    if not (work / "REVIEW.md").exists():
        raise Refusal(f"There is no REVIEW.md yet -- run {command('review')} {work_id} first.")
    tasks = plan_tasks((work / "PLAN.md").read_text())
    open_tasks = [tid for tid, _, line in tasks if not line.startswith("- [x]")]
    if open_tasks:
        raise Refusal(f"These tasks are not done yet: {', '.join(open_tasks)} -- run {command('work')} {work_id} all")
    if not any(state == " " for state, _, _ in review_points((work / "REVIEW.md").read_text())):
        raise Refusal("Nothing to fix: no review point is open in REVIEW.md.")
