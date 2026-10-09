/**
 * What each eval scenario must leave behind, judged from files and git -- never
 * from the transcript, so a grade does not depend on what the model said it did.
 *
 * `collect` reads an outcome from a finished run; each grader is a pure
 * function of it, so the graders are tested against recorded outcomes.
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { Fixture } from "./fixture";
import { ID, WORK } from "./fixture";

export interface Outcome {
    /** Work item files, CLAUDE.md, AGENTS.md and docs/adr/*, by path relative to the worktree. */
    files: Record<string, string>;
    /** Commits on the branch since it left main, oldest first. */
    commits: { sha: string; subject: string; files: string[] }[];
    /** Exit code of check.py <name> for each file that exists. */
    checks: Record<string, number>;
    /** Every module's tests passed. */
    testsGreen: boolean;
    /** The gh stub's recorded calls, and the PR body it was given. */
    gh: { calls: string; body: string };
    /** The commit that fixed R1, for gap-fixed. */
    fixSha?: string;
    /** How many work item worktrees exist. */
    worktrees?: number;
}

export interface Grade {
    pass: boolean;
    reasons: string[];
}

const grade = (reasons: string[]): Grade => ({ pass: reasons.length === 0, reasons });
const file = (o: Outcome, name: string) => o.files[`${WORK}/${name}`] ?? "";
const ticked = (o: Outcome, task: string) => file(o, "PLAN.md").includes(`- [x] ${task} `);
const taskCommits = (o: Outcome, task: string) =>
    o.commits.filter((c) => c.subject.includes(`(${ID}/${task})`));
const points = (o: Outcome) =>
    file(o, "REVIEW.md")
        .split("\n")
        .filter((l) => /^- \[[ x-]\] R\d+ /.test(l));
const candidates = (o: Outcome) =>
    file(o, "KNOWLEDGE.md")
        .split("\n")
        .filter((l) => /^- \[[ x]\] K\d+ /.test(l));

/** E1: `work all` on two tasks in two modules -- both done, one commit each, tests green. */
export function e1(o: Outcome): Grade {
    const reasons: string[] = [];
    for (const t of ["T-0001", "T-0002"]) {
        if (!ticked(o, t)) reasons.push(`${t} is not ticked`);
        const n = taskCommits(o, t).length;
        if (n !== 1) reasons.push(`${t} has ${n} commits, not 1`);
    }
    if (!o.testsGreen) reasons.push("the modules' tests are not green");
    return grade(reasons);
}

/** E2: `review` on work with S3 left out -- an open major point names it. */
export function e2(o: Outcome): Grade {
    const reasons: string[] = [];
    const found = points(o).some(
        (l) =>
            l.startsWith("- [ ]") &&
            l.includes("[major]") &&
            /S3|empty range|RangeError|min > max/i.test(l),
    );
    if (!found) reasons.push("no open major point names the missing S3");
    if (o.checks.review !== 0) reasons.push("check.py review fails");
    return grade(reasons);
}

/** E3: `review` after R1 was fixed -- R1 solved by the fixing commit, unchanged, nothing new open. */
export function e3(o: Outcome): Grade {
    const reasons: string[] = [];
    const all = points(o);
    const r1 = all.find((l) => / R1 /.test(l)) ?? "";
    if (!r1.startsWith("- [x]")) reasons.push("R1 is not marked solved");
    if (!o.fixSha || !new RegExp(`\\(solved in ${o.fixSha.slice(0, 7)}[0-9a-f]*\\)$`).test(r1))
        reasons.push("R1 does not name the commit that fixed it");
    if (!r1.includes("S3 is not implemented")) reasons.push("R1's wording changed");
    const open = all.filter((l) => l.startsWith("- [ ]"));
    if (open.length > 0) reasons.push(`points still open: ${open.join("; ")}`);
    if (o.checks.review !== 0) reasons.push("check.py review fails");
    return grade(reasons);
}

/** E4: `learn` with a decision and a trap in the Notes -- an ADR, an instruction line, at most 3 in all. */
export function e4(o: Outcome): Grade {
    const reasons: string[] = [];
    const all = candidates(o);
    if (!all.some((l) => l.includes("[ADR]") && /swap|RangeError|empty|throw|refuse/i.test(l)))
        reasons.push("no ADR candidate for throwing instead of swapping the bounds");
    if (!all.some((l) => /\[(CLAUDE|AGENTS)\.md\]/.test(l) && /bun test/.test(l)))
        reasons.push("no CLAUDE.md / AGENTS.md candidate about where to run bun test");
    if (all.length > 3) reasons.push(`${all.length} candidates; at most 3 were worth proposing`);
    if (o.checks.knowledge !== 0) reasons.push("check.py knowledge fails");
    return grade(reasons);
}

/** E5: `learn-apply` then `pr` with K1 [ADR] and K2 [CLAUDE.md] ticked. */
export function e5(o: Outcome): Grade {
    const reasons: string[] = [];
    if (!o.files["docs/adr/ADR-0001.md"]?.includes("Refuse an empty clamp range"))
        reasons.push("docs/adr/ADR-0001.md was not written from K1");
    if (!/## Learned\n\n- Run `bun test` from the repository root/.test(o.files["CLAUDE.md"] ?? ""))
        reasons.push("CLAUDE.md has no Learned line from K2");
    if (!o.commits.some((c) => c.subject === `docs(${ID}): add knowledge`))
        reasons.push("no knowledge commit");
    if (!o.gh.calls.includes("pr create")) reasons.push("no pull request was opened");
    if (!o.gh.body.includes("## Knowledge")) reasons.push("the PR body lists no knowledge");
    return grade(reasons);
}

/** E6: the whole flow from a one-line request -- every step's file complete, every task done, tests green. */
export function e6(o: Outcome): Grade {
    const reasons: string[] = [];
    for (const name of ["spec", "plan", "review"]) {
        if (o.checks[name] !== 0) reasons.push(`check.py ${name} fails or its file is missing`);
    }
    const tasks = file(o, "PLAN.md")
        .split("\n")
        .filter((l) => /^- \[[ x]\] T-\d{4} /.test(l));
    if (tasks.length === 0) reasons.push("the plan has no task");
    const open = tasks.filter((l) => l.startsWith("- [ ]"));
    if (open.length > 0) reasons.push(`tasks not done: ${open.join("; ")}`);
    if (!o.testsGreen) reasons.push("the modules' tests are not green");
    return grade(reasons);
}

/** E7: `spec <id> <answers>` -- the answers worked into the spec, nothing left open, no second work item. */
export function e7(o: Outcome): Grade {
    const reasons: string[] = [];
    const spec = file(o, "SPEC.md");
    const [before, after] = spec.split("## Out of scope");
    if (o.checks.spec !== 0) reasons.push("check.py spec fails");
    if (!/^### S\d+[^\n]*\n[\s\S]*RangeError/m.test(before ?? ""))
        reasons.push("no scenario says min > max throws a RangeError");
    if (!/NaN/.test(after ?? "")) reasons.push("NaN is not out of scope");
    if (!/## Open questions\s+None/.test(spec)) reasons.push("open questions are left");
    if (!spec.includes("### S1") || !spec.includes("### S2")) reasons.push("S1 or S2 was lost");
    if (o.worktrees !== 1) reasons.push(`${o.worktrees} work items, not 1`);
    return grade(reasons);
}

export const GRADERS: Record<string, (o: Outcome) => Grade> = {
    E1: e1,
    E2: e2,
    E3: e3,
    E4: e4,
    E5: e5,
    E6: e6,
    E7: e7,
};

/** The outcome of a finished run, read from the fixture's worktree. */
export async function collect(fx: Fixture): Promise<Outcome> {
    const tree = fx.tree;
    const files: Record<string, string> = {};
    const read = async (rel: string) => {
        const f = Bun.file(join(tree, rel));
        if (await f.exists()) files[rel] = await f.text();
    };
    for (const name of ["SPEC.md", "DESIGN.md", "PLAN.md", "REVIEW.md", "KNOWLEDGE.md"])
        await read(`${WORK}/${name}`);
    for (const name of ["CLAUDE.md", "AGENTS.md"]) await read(name);
    for (const name of await readdir(join(tree, "docs/adr")).catch(() => [] as string[]))
        await read(`docs/adr/${name}`);

    const git = (...args: string[]) => Bun.$`git -C ${tree} ${args}`.quiet().nothrow().text();
    const since = (await git("merge-base", "main", "HEAD")).trim();
    const commits = [];
    for (const sha of (await git("rev-list", "--reverse", `${since}..HEAD`))
        .trim()
        .split("\n")
        .filter(Boolean)) {
        commits.push({
            sha,
            subject: (await git("log", "-1", "--format=%s", sha)).trim(),
            files: (await git("show", "--name-only", "--format=", sha)).trim().split("\n"),
        });
    }

    const checks: Record<string, number> = {};
    for (const [name, path] of Object.entries({
        spec: "SPEC.md",
        plan: "PLAN.md",
        review: "REVIEW.md",
        knowledge: "KNOWLEDGE.md",
    })) {
        if (!files[`${WORK}/${path}`]) continue;
        checks[name] = (
            await Bun.$`python3 .craftpath/scripts/check.py ${name} ${ID}`
                .cwd(tree)
                .quiet()
                .nothrow()
        ).exitCode;
    }

    const config = Bun.TOML.parse(await Bun.file(join(tree, ".craftpath/config.toml")).text()) as {
        modules?: Record<string, { path?: string; test?: string }>;
    };
    let testsGreen = true;
    for (const m of Object.values(config.modules ?? {})) {
        const dir = join(tree, m.path ?? ".");
        const run = await Bun.$`sh -c ${m.test ?? "false"}`.cwd(dir).quiet().nothrow();
        if (run.exitCode !== 0) testsGreen = false;
    }

    const stub = async (name: string) => {
        const f = Bun.file(join(fx.stub, name));
        return (await f.exists()) ? f.text() : "";
    };
    return {
        files,
        commits,
        checks,
        testsGreen,
        gh: { calls: await stub("calls"), body: await stub("body.md") },
        fixSha: fx.fixSha,
        worktrees: (
            await readdir(join(fx.root, ".craftpath/worktrees")).catch(() => [] as string[])
        ).length,
    };
}
