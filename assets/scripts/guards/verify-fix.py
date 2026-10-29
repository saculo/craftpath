"""Guard for /craftpath-verify-fix <work id>: VERIFY.md exists, every task is done, and a point is open."""

from checks import plan_tasks, verify_points
from craftpath import Refusal, command, work_item


def check(cwd: str, args: str, invoked: str) -> None:
    work_id, work = work_item(args, invoked, cwd)
    if not (work / "VERIFY.md").exists():
        raise Refusal(f"There is no VERIFY.md yet -- run {command('verify')} {work_id} first.")
    tasks = plan_tasks((work / "PLAN.md").read_text())
    open_tasks = [tid for tid, _, line in tasks if not line.startswith("- [x]")]
    if open_tasks:
        raise Refusal(f"These tasks are not done yet: {', '.join(open_tasks)} -- run {command('work')} {work_id} all")
    if not any(state == " " for state, _, _ in verify_points((work / "VERIFY.md").read_text())):
        raise Refusal("Nothing to fix: no verify point is open in VERIFY.md.")
