"""Guard for /craftpath-work <work id> wave <n> | all: the plan is complete and the wave can run."""

from checks import check_plan, incomplete, selected_waves
from craftpath import Refusal, work_item


def check(cwd: str, args: str, command: str) -> None:
    _, work = work_item(args, command, cwd)
    if not (work / "PLAN.md").exists():
        raise Refusal("There is no PLAN.md yet -- plan the work item first.")
    incomplete("PLAN.md", check_plan(work))
    selected_waves((work / "PLAN.md").read_text(), args.split()[1:], command)
