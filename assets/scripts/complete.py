"""`complete.py <work id> <task id>`: tick a task once its modules' tests pass.

Runs the `test` command of every module the task touches, in the module's
directory. When all pass, ticks the task in PLAN.md and commits the changes
under those modules plus the task file and PLAN.md, as
`<type>(<work id>/<task id>): <title>`. When one fails, prints its output and
changes nothing. The work step runs it once per task, one task at a time, so
parallel tasks never commit at once.
"""

import re
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import COMMENT, FIELD, module_paths, plan_tasks, touched_modules  # noqa: E402
from craftpath import Refusal, config, git, work_item  # noqa: E402


class TestsFailed(Exception):
    """A module's tests failed; the output has been printed."""


def run_tests(root: Path, modules: list[str], paths: dict[str, str]) -> None:
    commands = config(root).get("modules", {})
    for module in modules:
        command = commands[module].get("test", "")
        if not command:
            raise Refusal(f"Module {module} has no test command -- set it in .craftpath/config.toml")
        print(f"{module}: {command}")
        result = subprocess.run(command, shell=True, cwd=root / paths[module], capture_output=True, text=True)
        if result.returncode != 0:
            print(result.stdout + result.stderr)
            raise TestsFailed(f"{module}'s tests failed (exit {result.returncode}); the task stays open.")


def main(argv: list[str]) -> None:
    if len(argv) != 2:
        raise Refusal("usage: complete.py <work id> <task id>")
    work_id, work = work_item(argv[0], "complete.py")
    task_id = argv[1]
    root = work.parents[2]
    plan_file = work / "PLAN.md"
    plan = plan_file.read_text()
    line = next((line for tid, _, line in plan_tasks(plan) if tid == task_id), None)
    if line is None:
        raise Refusal(f"{task_id} is not in {work_id}'s PLAN.md")
    if line.startswith("- [x]"):
        raise Refusal(f"{task_id} is already done")

    task_file = work / "tasks" / f"{task_id}.md"
    task = task_file.read_text()
    paths = module_paths(root)
    touched, _ = touched_modules(task_id, task, paths)
    run_tests(root, sorted(touched), paths)

    plan_file.write_text(plan.replace(line, "- [x]" + line[len("- [ ]") :], 1))
    kind = dict(FIELD.findall(COMMENT.sub("", task))).get("Type", "").strip()
    title = re.sub(r"^- \[ \] T-\d{4} — ", "", line)
    git("add", "-A", "--", *(paths[m] or "." for m in sorted(touched)), str(task_file), str(plan_file), cwd=root)
    git("commit", "-q", "-m", f"{kind}({work_id}/{task_id}): {title}", cwd=root)
    print(f"{task_id} is done: {git('log', '-1', '--format=%h %s', cwd=root)}")


if __name__ == "__main__":
    try:
        main(sys.argv[1:])
    except (Refusal, TestsFailed) as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
