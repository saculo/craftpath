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


def check_plan(work: Path) -> list[str]:
    text = (work / "PLAN.md").read_text()
    problems = generic("PLAN.md", text, ["Goal", "Approach", "Tasks"])
    listed = plan_tasks(text)
    if not listed:
        problems.append("PLAN.md: no task is listed -- add each with task.py")
    waves = {tid: wave for tid, wave, _ in listed}
    scenarios = scenario_ids((work / "SPEC.md").read_text())
    for tid, _, _ in listed:
        file = work / "tasks" / f"{tid}.md"
        if not file.exists():
            problems.append(f"PLAN.md lists {tid}, but tasks/{tid}.md does not exist")
            continue
        problems += check_task(tid, file.read_text(), scenarios, waves)
    for file in sorted((work / "tasks").glob("T-*.md")) if (work / "tasks").exists() else []:
        if file.stem not in waves:
            problems.append(f"tasks/{file.name} is not listed in PLAN.md")
    return problems


CHECKS = {"spec": ("SPEC.md", check_spec), "design": ("DESIGN.md", check_design), "plan": ("PLAN.md", check_plan)}


def incomplete(name: str, problems: list[str]) -> None:
    """Refuse, listing the problems, when there are any."""
    if problems:
        from craftpath import Refusal

        raise Refusal("\n".join([f"{name} is not complete yet:", *[f"- {p}" for p in problems]]))
