"""`/craftpath-review-fix <work id>`: the open review points to turn into fix tasks.

Runs after the guard has found a review, every task done and a point open.
Commits REVIEW.md when it is uncommitted, then prints the work item's files,
the open points, the last task, the highest wave and the wave the fix tasks
start at. The agent adds the tasks with task.py; this script never writes
PLAN.md or a task file.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import plan_tasks, review_points  # noqa: E402
from craftpath import Refusal, command, commit_files, title_of, work_item  # noqa: E402


def main(args: str) -> None:
    work_id, work = work_item(args, command("review-fix"))
    path = work / "REVIEW.md"
    commit_files(work, work_id, "review", [path])
    tasks = plan_tasks((work / "PLAN.md").read_text())
    last = max(tid for tid, _, _ in tasks)
    highest = max(wave for _, wave, _ in tasks)

    print(f"Work item {work_id}: {title_of(work)}")
    print(f"  spec:   {work / 'SPEC.md'}")
    print(f"  plan:   {work / 'PLAN.md'}")
    print(f"  review: {path}")
    print(f"  tasks:  {work / 'tasks'}")
    print("Open points:")
    for state, _, line in review_points(path.read_text()):
        if state == " ":
            print(f"  {line}")
    print(f"last task: {last}")
    print(f"highest wave: {highest}")
    print(f"fix tasks start at wave {highest + 1}")
    print(f'Add each fix task with: python3 .craftpath/scripts/task.py {work_id} --wave <n> --type fix "<task title>"')


if __name__ == "__main__":
    try:
        main(" ".join(sys.argv[1:]))
    except Refusal as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
