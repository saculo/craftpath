"""`/craftpath-work <work id> wave <n> | all`: the open tasks to run, by wave.

Runs after the guard has found the plan complete and the wave runnable. Lists
each open task with its file and the test command of every module it touches;
the step runs one subagent per task, a wave at a time, and completes each with
complete.py.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import module_paths, plan_tasks, selected_waves, touched_modules  # noqa: E402
from craftpath import Refusal, config, title_of, work_item  # noqa: E402


def main(args: str) -> None:
    work_id, work = work_item(args, "/craftpath-work")
    root = work.parents[2]
    plan = (work / "PLAN.md").read_text()
    waves = selected_waves(plan, args.split()[1:], "/craftpath-work")
    modules = module_paths(root)
    tests = {name: m.get("test", "") for name, m in config(root).get("modules", {}).items()}

    print(f"Work item {work_id}: {title_of(work)}")
    print(f"  worktree: {root}")
    print(f"  spec:     {work / 'SPEC.md'}")
    open_tasks = [(tid, wave, line) for tid, wave, line in plan_tasks(plan) if wave in waves and line.startswith("- [ ]")]
    if not open_tasks:
        print("Nothing to do: every selected task is done.")
        return
    for wave in waves:
        in_wave = [(tid, line) for tid, w, line in open_tasks if w == wave]
        if not in_wave:
            continue
        print(f"\nWave {wave}")
        for tid, line in in_wave:
            task = work / "tasks" / f"{tid}.md"
            touched, _ = touched_modules(tid, task.read_text(), modules)
            print(f"  {line.removeprefix('- [ ] ')}")
            print(f"    task:  {task}")
            for module in sorted(touched):
                print(f"    tests: {module}: {tests.get(module) or '(no test command)'}")
    print(f"\nComplete each task with: python3 .craftpath/scripts/complete.py {work_id} <task id>")


if __name__ == "__main__":
    try:
        main(" ".join(sys.argv[1:]))
    except Refusal as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
