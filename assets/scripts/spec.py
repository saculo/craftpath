"""`/craftpath-spec <title>`: create a work item.

Allocates the next id (C-00001), creates its worktree inside the project
(`.craftpath/worktrees/C-00001-<slug>/`, git-ignored) on a branch from the base
branch, and writes SPEC.md there from the template.
Prints where everything is, for the agent that fills the spec in.

`spec.py <work id>` revises an existing work item's spec instead: it creates
nothing, and prints where the spec is and its open questions, for the agent to
work the user's answers in.
"""

import sys
from pathlib import Path

sys.dont_write_bytecode = True  # no __pycache__ in the project
sys.path.insert(0, str(Path(__file__).parent))
from checks import COMMENT, sections  # noqa: E402
from craftpath import (  # noqa: E402
    WORK_ID_ARG,
    Refusal,
    base_branch,
    command,
    config,
    git,
    main_root,
    next_id,
    slugify,
    title_of,
    work_item,
    worktrees_dir,
)


def revise(args: str) -> None:
    work_id, work = work_item(args, command("spec"))
    spec = work / "SPEC.md"
    questions = sections(COMMENT.sub("", spec.read_text())).get("Open questions", "").strip()
    print(
        "\n".join(
            [
                f"Revising work item {work_id}: {title_of(work)}",
                f"  worktree: {work.parents[2]}",
                f"  spec:     {spec}",
                "Open questions:",
                *[f"  {line}" for line in (questions or "None").splitlines() if line.strip()],
            ]
        )
    )


def main(title: str) -> None:
    if title.split() and WORK_ID_ARG.match(title.split()[0]):
        revise(title)
        return
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
