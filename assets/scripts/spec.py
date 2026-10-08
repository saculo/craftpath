"""`/craftpath-spec <title>`: create a work item.

Allocates the next id (C-00001), creates its worktree next to the repository
on a branch from the base branch, and writes SPEC.md there from the template.
Prints where everything is, for the agent that fills the spec in.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from craftpath import Refusal, base_branch, config, git, main_root, next_id, slugify, worktrees_dir  # noqa: E402


def main(title: str) -> None:
    root = main_root()
    base = base_branch(config(root))
    work_id = next_id(root)
    name = f"{work_id}-{slugify(title)}"
    branch = f"craftpath/{name}"
    tree = worktrees_dir(root) / name

    tree.parent.mkdir(parents=True, exist_ok=True)
    git("worktree", "add", "--quiet", "-b", branch, str(tree), base, cwd=root)

    template = (tree / ".craftpath" / "templates" / "SPEC.md").read_text()
    spec = tree / ".craftpath" / "work" / work_id / "SPEC.md"
    spec.parent.mkdir(parents=True, exist_ok=True)
    spec.write_text(template.replace("{{ID}}", work_id).replace("{{TITLE}}", title.strip()))

    print(
        "\n".join(
            [
                f"Work item {work_id}: {title.strip()}",
                f"  worktree: {tree}",
                f"  branch:   {branch} (from {base})",
                f"  spec:     {spec}",
            ]
        )
    )


if __name__ == "__main__":
    try:
        main(" ".join(sys.argv[1:]))
    except Refusal as reason:
        print(reason, file=sys.stderr)
        sys.exit(1)
