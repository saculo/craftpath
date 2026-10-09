"""What "complete" means for each step's file.

Used by the guards -- a step is refused while its inputs are incomplete -- and
by `check.py`, which each step runs on its own output before it ends. Every
problem is a sentence naming the file and what to fix.
"""

import re
from pathlib import Path

COMMENT = re.compile(r"<!--.*?-->", re.S)
FENCE = re.compile(r"```.*?```", re.S)
INLINE = re.compile(r"`[^`\n]*`")
PLACEHOLDER = re.compile(r"<[a-z][a-z0-9 ,'./|_-]*>")
FIELD = re.compile(r"^- \*\*([A-Za-z][A-Za-z ]*):\*\*\s*(.*)$", re.M)
TASK_LINE = re.compile(r"^- \[( |x)\] (T-\d{4}) — (.+)$")
TYPES = ("feat", "fix", "test", "refactor", "docs", "perf", "chore")


def sections(text: str, level: str = "## ") -> dict[str, str]:
    """Heading -> body, for headings at exactly `level`."""
    out: dict[str, str] = {}
    name = None
    for line in text.splitlines():
        if line.startswith(level):
            name = line[len(level) :].strip()
            out[name] = ""
        elif name is not None:
            out[name] += line + "\n"
    return out


def generic(label: str, text: str, required: list[str]) -> list[str]:
    problems = []
    if COMMENT.search(text):
        problems.append(f"{label}: a guidance comment is still there -- delete each once its section is written")
    bare = INLINE.sub("", FENCE.sub("", COMMENT.sub("", text)))
    for placeholder in sorted(set(PLACEHOLDER.findall(bare))):
        problems.append(f"{label}: the placeholder {placeholder} is still there")
    found = sections(COMMENT.sub("", text))
    for name in required:
        if name not in found:
            problems.append(f"{label}: the section '## {name}' is missing")
        elif not found[name].strip():
            problems.append(f"{label}: the section '{name}' is empty")
    return problems


def resolved(body: str) -> bool:
    lines = [re.sub(r"^[-*]\s*", "", line).strip() for line in body.strip().splitlines() if line.strip()]
    return len(lines) == 1 and lines[0].rstrip(".").lower() in ("none", "n/a", "-")


def scenario_ids(spec_text: str) -> list[str]:
    return re.findall(r"^### (S\d+)\b", spec_text, re.M)


def check_spec(work: Path) -> list[str]:
    text = (work / "SPEC.md").read_text()
    problems = generic("SPEC.md", text, ["Problem", "Scenarios", "Out of scope", "Open questions"])
    body = sections(COMMENT.sub("", text))
    scenarios = sections(body.get("Scenarios", ""), "### ")
    if not scenarios:
        problems.append("SPEC.md: there is no scenario -- add '### S1 — <name>' with Given / When / Then")
    for heading, scenario in scenarios.items():
        sid = heading.split()[0]
        for word in ("Given", "When", "Then"):
            if not re.search(rf"\b{word}\b", scenario):
                problems.append(f"SPEC.md: scenario {sid} has no {word}")
    questions = body.get("Open questions", "")
    if questions.strip() and not resolved(questions):
        listed = "; ".join(line.strip("-* ").strip() for line in questions.strip().splitlines() if line.strip())
        problems.append(f"SPEC.md: the Open questions are not resolved ({listed}) -- resolve them, then write None")
    return problems


def check_design(work: Path) -> list[str]:
    text = (work / "DESIGN.md").read_text()
    problems = generic("DESIGN.md", text, ["Context", "Decisions", "Boundaries", "Risks"])
    decisions = sections(sections(COMMENT.sub("", text)).get("Decisions", ""), "### ")
    if not decisions:
        problems.append("DESIGN.md: there is no decision -- add '### D1 — <decision>'")
    for heading, decision in decisions.items():
        for field in ("Options", "Chosen"):
            if f"**{field}:**" not in decision:
                problems.append(f"DESIGN.md: decision {heading.split()[0]} has no {field}")
    return problems


def plan_tasks(plan_text: str) -> list[tuple[str, int, str]]:
    """(task id, wave, line) for every task listed in PLAN.md's Tasks section."""
    tasks = []
    wave = 0
    for line in sections(plan_text).get("Tasks", "").splitlines():
        heading = re.match(r"^### Wave (\d+)\s*$", line)
        if heading:
            wave = int(heading.group(1))
        match = TASK_LINE.match(line)
        if match:
            tasks.append((match.group(2), wave, line))
    return tasks


def check_task(task_id: str, text: str, scenarios: list[str], waves: dict[str, int]) -> list[str]:
    label = f"tasks/{task_id}.md"
    problems = generic(label, text, ["Acceptance criteria"])
    fields = {name: value.strip() for name, value in FIELD.findall(COMMENT.sub("", text))}
    if fields.get("Type") not in TYPES:
        problems.append(f"{task_id}: Type must be one of {', '.join(TYPES)}")
    wave = fields.get("Wave", "")
    if not wave.isdigit():
        problems.append(f"{task_id}: Wave must be a number")
    elif int(wave) != waves.get(task_id):
        problems.append(f"{task_id}: Wave says {wave}, but PLAN.md lists it under wave {waves.get(task_id)}")
    touches = fields.get("Touches", "")
    if not touches or PLACEHOLDER.search(touches):
        problems.append(f"{task_id}: Touches must name the files or modules it changes")
    named = re.findall(r"\bS\d+\b", fields.get("Scenarios", ""))
    if not named:
        problems.append(f"{task_id}: Scenarios must name the SPEC.md scenarios it implements")
    for sid in named:
        if sid not in scenarios:
            problems.append(f"{task_id}: scenario {sid} is not in SPEC.md")
    for dep in re.findall(r"\bT-\d{4}\b", fields.get("Depends on", "")):
        if dep not in waves:
            problems.append(f"{task_id}: depends on {dep}, which is not in PLAN.md")
        elif wave.isdigit() and waves[dep] >= int(wave):
            problems.append(f"{task_id}: depends on {dep}, which is not in an earlier wave")
    criteria = re.findall(r"^- \*\*(A\d+)\*\*(.*)$", sections(COMMENT.sub("", text)).get("Acceptance criteria", ""), re.M)
    if not criteria:
        problems.append(f"{task_id}: there is no acceptance criterion -- add '- **A1** ...'")
    for cid, criterion in criteria:
        if not re.search(r"proven by (an? )?(integration|e2e) test", criterion, re.I):
            problems.append(f"{task_id} {cid}: not proven by an integration or e2e test -- say which one")
    return problems


def module_paths(root: Path) -> dict[str, str]:
    """Module name -> its path relative to the repository, "" for the root."""
    from craftpath import config

    modules = config(root).get("modules", {})
    paths = {name: str(m.get("path", "")).strip() for name, m in modules.items()}
    return {name: "" if path in ("", ".", "./") else path.removeprefix("./").strip("/") for name, path in paths.items()}


def module_of(entry: str, modules: dict[str, str]) -> str | None:
    """The module a Touches entry names, or whose path holds it (the longest wins)."""
    if entry in modules:
        return entry
    path = entry.removeprefix("./")
    holding = [name for name, base in modules.items() if not base or path == base or path.startswith(base + "/")]
    return max(holding, key=lambda name: len(modules[name]), default=None)


def touched_modules(task_id: str, text: str, modules: dict[str, str]) -> tuple[set[str], list[str]]:
    """The modules a task's Touches resolve to, and a problem per entry in none."""
    fields = dict(FIELD.findall(COMMENT.sub("", text)))
    found: set[str] = set()
    problems = []
    for entry in (e.strip().strip("`").strip() for e in fields.get("Touches", "").split(",")):
        if not entry or PLACEHOLDER.search(entry):
            continue
        module = module_of(entry, modules)
        if module is None:
            problems.append(f"{task_id}: Touches names {entry}, which is in no module of .craftpath/config.toml")
        else:
            found.add(module)
    return found, problems


def check_plan(work: Path) -> list[str]:
    text = (work / "PLAN.md").read_text()
    problems = generic("PLAN.md", text, ["Goal", "Approach", "Tasks"])
    listed = plan_tasks(text)
    if not listed:
        problems.append("PLAN.md: no task is listed -- add each with task.py")
    waves = {tid: wave for tid, wave, _ in listed}
    scenarios = scenario_ids((work / "SPEC.md").read_text())
    modules = module_paths(work.parents[2])
    owner: dict[tuple[int, str], str] = {}  # (wave, module) -> the first task touching it
    for tid, wave, _ in listed:
        file = work / "tasks" / f"{tid}.md"
        if not file.exists():
            problems.append(f"PLAN.md lists {tid}, but tasks/{tid}.md does not exist")
            continue
        text = file.read_text()
        problems += check_task(tid, text, scenarios, waves)
        touched, unowned = touched_modules(tid, text, modules)
        problems += unowned
        for module in sorted(touched):
            first = owner.setdefault((wave, module), tid)
            if first != tid:
                problems.append(
                    f"{first} and {tid} both touch module {module} in wave {wave} -- "
                    "tasks in one wave run in parallel, so move one to another wave"
                )
    for file in sorted((work / "tasks").glob("T-*.md")) if (work / "tasks").exists() else []:
        if file.stem not in waves:
            problems.append(f"tasks/{file.name} is not listed in PLAN.md")
    return problems


def selected_waves(plan_text: str, words: list[str], command: str) -> list[int]:
    """The waves `wave <n>` or `all` selects, refusing a wave that cannot run yet."""
    from craftpath import Refusal

    tasks = plan_tasks(plan_text)
    waves = sorted({wave for _, wave, _ in tasks})
    if words == ["all"]:
        return waves
    if len(words) != 2 or words[0] != "wave" or not words[1].isdigit():
        raise Refusal(f"Say which tasks to work on: {command} <work id> wave <n>, or {command} <work id> all")
    wave = int(words[1])
    if wave not in waves:
        raise Refusal(f"The plan has no wave {wave}; its waves are {', '.join(map(str, waves))}")
    open_before = [tid for tid, w, line in tasks if w < wave and not line.startswith("- [x]")]
    if open_before:
        raise Refusal(f"Wave {wave} builds on earlier waves, and these tasks are not done yet: {', '.join(open_before)}")
    return [wave]


POINT = re.compile(r"^- \[( |x|-)\] (R\d+) \[(?:major|minor)\] \S.* -- \S.*$")


def review_points(text: str) -> list[tuple[str, str, str]]:
    """(state, point id, line) for every well-formed point in REVIEW.md."""
    body = sections(COMMENT.sub("", text)).get("Points", "")
    return [(m.group(1), m.group(2), line) for line in body.splitlines() if (m := POINT.match(line))]


def is_commit(root: Path, sha: str) -> bool:
    from craftpath import git_ok

    return git_ok("cat-file", "-e", f"{sha}^{{commit}}", cwd=root)


def check_review(work: Path) -> list[str]:
    text = (work / "REVIEW.md").read_text()
    problems = generic("REVIEW.md", text, ["Points"])
    root = work.parents[2]
    reviewed = dict(FIELD.findall(COMMENT.sub("", text))).get("Reviewed at", "").strip()
    if not reviewed or not is_commit(root, reviewed):
        problems.append("REVIEW.md: Reviewed at must name the commit reviewed -- review.py writes it")
    body = sections(COMMENT.sub("", text)).get("Points", "")
    if resolved(body):
        return problems
    seen: set[str] = set()
    for line in (line.strip() for line in body.splitlines()):
        if not line:
            continue
        match = POINT.match(line)
        if match is None:
            problems.append(f"REVIEW.md: not a point: {line} -- write '- [ ] R<n> [major|minor] <where> -- <what>'")
            continue
        state, rid = match.group(1), match.group(2)
        if rid in seen:
            problems.append(f"REVIEW.md: {rid} is used twice -- a new point takes the next free number")
        seen.add(rid)
        if state == "x":
            solved = re.search(r"\(solved in ([0-9a-f]{7,40})\)$", line)
            if solved is None:
                problems.append(f"REVIEW.md: {rid} is marked solved without its commit -- end it with (solved in <sha>)")
            elif not is_commit(root, solved.group(1)):
                problems.append(f"REVIEW.md: {rid} is solved in {solved.group(1)}, which is not a commit here")
        if state == "-" and not re.search(r"\(won't fix: \S.*\)$", line):
            problems.append(f"REVIEW.md: {rid} is marked won't fix without a reason -- end it with (won't fix: <reason>)")
    return problems


CHECKS = {
    "spec": ("SPEC.md", check_spec),
    "design": ("DESIGN.md", check_design),
    "plan": ("PLAN.md", check_plan),
    "review": ("REVIEW.md", check_review),
}


def incomplete(name: str, problems: list[str]) -> None:
    """Refuse, listing the problems, when there are any."""
    if problems:
        from craftpath import Refusal

        raise Refusal("\n".join([f"{name} is not complete yet:", *[f"- {p}" for p in problems]]))
