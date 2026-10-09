"""`/craftpath-plan <work id>`: create PLAN.md.

Runs after the guard has found SPEC.md -- and DESIGN.md, if there is one --
complete. Tasks are added one at a time with task.py. An existing PLAN.md is
left as it is, for the agent to revise.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from craftpath import Refusal, commit_files, from_template, title_of, work_item  # noqa: E402


def main(args: str) -> None:
    work_id, work = work_item(args, "/craftpath-plan")
    commit_files(work, work_id, "spec", [work / "SPEC.md"])
    commit_files(work, work_id, "design", [work / "DESIGN.md"])
    plan = work / "PLAN.md"
    print(f"Work item {work_id}: {title_of(work)}")
    print(f"  spec:   {work / 'SPEC.md'}")
    if (work / "DESIGN.md").exists():
        print(f"  design: {work / 'DESIGN.md'}")
    if plan.exists():
        print(f"  plan:   {plan} (already exists -- revise it)")
    else:
        plan.write_text(from_template(work, "PLAN.md", {"ID": work_id, "TITLE": title_of(work)}))
        print(f"  plan:   {plan}")
    print(f"  tasks:  {work / 'tasks'}")
    print(f'Add each task with: python3 .craftpath/scripts/task.py {work_id} --wave <n> "<task title>"')


if __name__ == "__main__":
    try:
        main(" ".join(sys.argv[1:]))
    except Refusal as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
