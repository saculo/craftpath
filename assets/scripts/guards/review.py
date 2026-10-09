"""Guard for /craftpath-review <work id>: every task is done and committed, and so is the code."""

from checks import check_plan, incomplete, plan_tasks
from craftpath import Refusal, branch_base, git, uncommitted_outside, work_item


def check(cwd: str, args: str, command: str) -> None:
    work_id, work = work_item(args, command, cwd)
    if not (work / "PLAN.md").exists():
        raise Refusal("There is no PLAN.md yet -- plan the work item first.")
    plan = (work / "PLAN.md").read_text()
    incomplete("PLAN.md", check_plan(work))
    tasks = plan_tasks(plan)
    open_tasks = [tid for tid, _, line in tasks if not line.startswith("- [x]")]
    if open_tasks:
        raise Refusal(f"These tasks are not done yet: {', '.join(open_tasks)} -- run /craftpath-work {work_id} all")
    root = work.parents[2]
    subjects = git("log", "--format=%s", f"{branch_base(root)}..HEAD", cwd=root)
    for tid, _, _ in tasks:
        if f"({work_id}/{tid})" not in subjects:
            raise Refusal(f"{tid} is ticked, but no commit carries ({work_id}/{tid}) -- complete.py commits a task")
    changed = uncommitted_outside(root, work)
    if changed:
        listed = "\n".join(f"- {path}" for path in changed)
        raise Refusal(f"Commit or discard these changes first -- the review sees only committed code:\n{listed}")
