/**
 * Step 5: `/craftpath-learn <work id>` and `/craftpath-learn-apply <work id>`.
 *
 * `learn` proposes knowledge candidates in KNOWLEDGE.md, each holding the exact
 * text to keep; the user ticks the ones to keep; `learn-apply` writes the
 * ticked ones -- an ADR in docs/adr/, or a line appended to CLAUDE.md or
 * AGENTS.md -- marks them applied and commits them.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import { commitsSince, done, git, guard, head, ID, installed, script, verify, words } from "./kit";

afterAll(cleanScratch);

const knowledge = (tree: string) => join(tree, ".craftpath/work", ID, "KNOWLEDGE.md");

const decisions = (tree: string) => join(tree, ".craftpath/work", ID, "DECISIONS.md");

/**
 * A work item whose verification holds `points`. With `withDecisions`, a
 * DECISIONS.md is written before verify runs, so verify commits it.
 */
async function verified(points = "None", { withDecisions = false } = {}): Promise<string> {
    const { tree } = await done();
    if (withDecisions)
        await Bun.write(
            decisions(tree),
            "# C-00001 — decisions\n\n## T-0001\n\n- Named the field `health`: the spec says nothing.\n",
        );
    await script(tree, "verify", ID);
    await Bun.write(
        verify(tree),
        `# C-00001 — Health endpoint: verify\n\n- **Verified at:** ${await head(tree)}\n\n## Points\n\n${points}\n`,
    );
    return tree;
}

const ADR = (
    box: string,
    id = "K1",
) => `- [${box}] ${id} [ADR] Health checks bypass the auth middleware
  - **Context:** load balancers carry no token.
  - **Decision:** /health is mounted before the auth middleware.
  - **Consequences:** /health must never return anything secret.
  - **Source:** SPEC S1, review R1`;

const LINE = (
    box: string,
    id = "K2",
) => `- [${box}] ${id} [CLAUDE.md] Run \`bun test\` from the module root, not the repo root.
  - **Source:** T-0001 Notes`;

/** KNOWLEDGE.md with these candidates, as the user leaves it after ticking. */
async function withCandidates(tree: string, ...candidates: string[]): Promise<void> {
    await script(tree, "learn", ID);
    await Bun.write(
        knowledge(tree),
        `# C-00001 — Health endpoint: knowledge\n\n## Candidates\n\n${candidates.join("\n\n")}\n`,
    );
}

describe("/craftpath-learn", () => {
    test("S11 learn is refused while a verify point is open, naming it", async () => {
        const point =
            "- [ ] F1 [fix] src/app.ts:1 -- given no database, GET /health still answers ok";
        const tree = await verified(point);

        const { blocked, reason } = await guard(tree, "learn", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain(point);
        expect(reason).toContain(`/craftpath-verify ${ID}`);
    });

    test("S11 learn is refused without VERIFY.md, even with a closed REVIEW.md", async () => {
        const { tree } = await done();
        await Bun.write(
            join(tree, ".craftpath/work", ID, "REVIEW.md"),
            `# C-00001 — Health endpoint: review\n\n- **Reviewed at:** ${await head(tree)}\n\n## Points\n\nNone\n`,
        );

        const { blocked, reason } = await guard(tree, "learn", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("VERIFY.md");
        expect(reason).toContain(`/craftpath-verify ${ID}`);
    });

    test("S11 learn runs once VERIFY.md has no open point", async () => {
        const tree = await verified();
        expect(await script(tree, "check", "verify", ID)).toMatchObject({ exit: 0 });

        expect((await guard(tree, "learn", ID)).blocked).toBe(false);
    });

    test("S11 learn lists VERIFY.md among its sources, not REVIEW.md", async () => {
        const tree = await verified("None", { withDecisions: true });

        const { exit, out } = await script(tree, "learn", ID);

        expect(exit).toBe(0);
        const lines = out.split("\n");
        const sources = lines.slice(lines.indexOf("Learn from:") + 1);
        const task = sources.findLastIndex((line) => line.includes("/tasks/T-"));
        expect(sources[task + 1]).toBe(`  ${decisions(tree)}`);
        expect(sources[task + 2]).toBe(`  ${verify(tree)}`);
        expect(out).not.toContain("REVIEW.md");
    });

    test("L2 creates KNOWLEDGE.md and prints the sources, each task file included, and next id K1", async () => {
        const tree = await verified();

        const { exit, out } = await script(tree, "learn", ID);

        expect(exit).toBe(0);
        expect(await Bun.file(knowledge(tree)).text()).toStartWith(
            "# C-00001 — Health endpoint: knowledge",
        );
        expect(out).toContain(knowledge(tree));
        expect(out).toContain(join(tree, ".craftpath/work", ID, "SPEC.md"));
        expect(out).toContain(join(tree, ".craftpath/work", ID, "tasks/T-0001.md"));
        expect(out).toContain(verify(tree));
        expect(out).toContain("next candidate: K1");
    });

    test("L2 lists a committed DECISIONS.md among the sources", async () => {
        const tree = await verified("None", { withDecisions: true });
        expect((await git(tree, "status", "--porcelain")).text()).not.toContain("DECISIONS.md");

        const { exit, out } = await script(tree, "learn", ID);

        expect(exit).toBe(0);
        const lines = out.split("\n");
        const sources = lines.slice(lines.indexOf("Learn from:") + 1);
        const task = sources.findLastIndex((line) => line.includes("/tasks/T-"));
        expect(sources[task]).toBe(`  ${join(tree, ".craftpath/work", ID, "tasks/T-0001.md")}`);
        expect(sources[task + 1]).toBe(`  ${decisions(tree)}`);
        expect(sources[task + 2]).toBe(`  ${verify(tree)}`);
        expect(out).toContain(join(tree, ".craftpath/work", ID, "SPEC.md"));
    });

    test("L2 without DECISIONS.md, lists the other sources and creates none", async () => {
        const tree = await verified();

        const { exit, out, err } = await script(tree, "learn", ID);

        expect(exit).toBe(0);
        expect(await Bun.file(knowledge(tree)).exists()).toBe(true);
        expect(out).toContain(join(tree, ".craftpath/work", ID, "SPEC.md"));
        expect(out).toContain(join(tree, ".craftpath/work", ID, "tasks/T-0001.md"));
        expect(out).toContain(verify(tree));
        expect(out).not.toContain("DECISIONS.md");
        expect(err).toBe("");
        expect(await Bun.file(decisions(tree)).exists()).toBe(false);
    });

    test("L2 keeps an existing KNOWLEDGE.md and its candidates, and gives one past the highest id", async () => {
        const tree = await verified();
        await withCandidates(tree, ADR(" ", "K1"), LINE("x", "K4"));
        const before = await Bun.file(knowledge(tree)).text();

        const { out } = await script(tree, "learn", ID);

        expect(await Bun.file(knowledge(tree)).text()).toBe(before);
        expect(out).toContain("next candidate: K5");
    });
});

describe("learn proposes knowledge from decisions", () => {
    /** The installed learn skill on each harness. */
    const skills = () => installed("craftpath-learn");

    /** The word-normalised `[ADR]` section of the installed learn skill, on each harness. */
    async function adrSections(): Promise<string[]> {
        return (await skills()).map((skill) =>
            words(skill.split("### `[ADR]`")[1]?.split("###")[0] ?? ""),
        );
    }

    test("learn reads decisions, assumptions and the verification when proposing candidates", async () => {
        for (const skill of await skills()) {
            const instructions = (skill.split("## What is worth keeping")[0] ?? "")
                .split(/\n[ \t]*\d+\.[ \t]/)
                .map(words);
            const reading = instructions.find((i) =>
                i.includes("Change nothing but `KNOWLEDGE.md`"),
            );
            expect(reading).toBeDefined();
            for (const phrase of [
                "`DECISIONS.md`",
                "when it exists",
                "`## Assumptions`",
                "`SPEC.md`",
                "`VERIFY.md`",
            ])
                expect(reading).toContain(phrase);
        }
    });

    test("learn names recorded decisions and assumptions as ADR sources", async () => {
        for (const adr of await adrSections()) {
            expect(adr).toContain("`DECISIONS.md`");
            expect(adr).toContain("`## Assumptions`");
            expect(adr).toContain("`SPEC.md`");
            expect(adr).toContain("worth keeping");
        }
    });

    test("learn does not make every decision an ADR", async () => {
        for (const adr of await adrSections()) {
            expect(adr).not.toBe("");
            expect(adr.toLowerCase()).not.toContain("every decision");
            expect(adr.toLowerCase()).not.toContain("every assumption");
        }
    });
});

describe("check.py knowledge -- what 'complete' means for KNOWLEDGE.md", () => {
    test("L3 well-formed candidates pass, and so does None", async () => {
        const tree = await verified();
        await withCandidates(tree, ADR(" "), LINE("x"));
        expect(await script(tree, "check", "knowledge", ID)).toMatchObject({ exit: 0 });

        await withCandidates(tree, "None");
        expect(await script(tree, "check", "knowledge", ID)).toMatchObject({ exit: 0 });
    });

    test("L3 names a malformed line, a duplicate id, an unknown target and an ADR missing a field", async () => {
        const tree = await verified();
        await withCandidates(
            tree,
            ADR(" ", "K1"),
            LINE(" ", "K1"),
            "- [ ] K2 [README.md] Document /health.",
            "- K3 [CLAUDE.md] no checkbox",
            ADR(" ", "K4").replace(/\n {2}- \*\*Decision:\*\*.*$/m, ""),
        );

        const { exit, out } = await script(tree, "check", "knowledge", ID);

        expect(exit).toBe(1);
        expect(out).toContain("K1 is used twice");
        expect(out).toContain("README.md");
        expect(out).toContain("- K3 [CLAUDE.md] no checkbox");
        expect(out).toContain("K4 has no Decision");
    });
});

describe("/craftpath-learn-apply", () => {
    const apply = (tree: string) => script(tree, "learn-apply", ID);

    test("L4 is refused without KNOWLEDGE.md, or while it is incomplete", async () => {
        const tree = await verified();
        const missing = await guard(tree, "learn-apply", ID);

        await script(tree, "learn", ID);
        const untouched = await guard(tree, "learn-apply", ID);

        expect(missing.blocked).toBe(true);
        expect(missing.reason).toContain("/craftpath-learn");
        expect(untouched.blocked).toBe(true);
        expect(untouched.reason).toContain("KNOWLEDGE.md");
    });

    test("L4 with nothing ticked, applies nothing and commits KNOWLEDGE.md as the record", async () => {
        const tree = await verified();
        await withCandidates(tree, ADR(" "), LINE(" "));
        const before = await head(tree);

        expect((await guard(tree, "learn-apply", ID)).blocked).toBe(false);
        const { exit, out } = await apply(tree);

        expect(exit).toBe(0);
        expect(out).toContain("Nothing to apply");
        expect(await Bun.file(join(tree, "docs/adr")).exists()).toBe(false);
        expect(await Bun.file(join(tree, "CLAUDE.md")).exists()).toBe(false);
        expect(await commitsSince(tree, before)).toEqual([
            {
                subject: "docs(C-00001): add knowledge",
                files: [".craftpath/work/C-00001/KNOWLEDGE.md"],
            },
        ]);
    });

    test("L5 a ticked ADR is written to docs/adr as ADR-<n>.md, numbered after the highest there", async () => {
        const tree = await verified();
        await Bun.write(join(tree, "docs/adr/ADR-0002-use-bun.md"), "# ADR-0002 — Use Bun\n");
        await withCandidates(tree, ADR("x"));

        const { exit } = await apply(tree);

        expect(exit).toBe(0);
        const adr = await Bun.file(join(tree, "docs/adr/ADR-0003.md")).text();
        expect(adr).toStartWith("# ADR-0003 — Health checks bypass the auth middleware");
        expect(adr).toContain("load balancers carry no token.");
        expect(adr).toContain("/health is mounted before the auth middleware.");
        expect(adr).toContain("/health must never return anything secret.");
        expect(adr).toContain("C-00001 K1");
        expect(adr).toContain("SPEC S1, review R1");
    });

    test("L6 a ticked CLAUDE.md line is appended under Learned, leaving the rest unchanged", async () => {
        const tree = await verified();
        const existing =
            "# App\n\nUse tabs.\n\n## Learned\n\n- Keep handlers small.\n\n## Release\n\nTag it.\n";
        await Bun.write(join(tree, "CLAUDE.md"), existing);
        await withCandidates(tree, LINE("x"));

        await apply(tree);

        expect(await Bun.file(join(tree, "CLAUDE.md")).text()).toBe(
            existing.replace(
                "- Keep handlers small.\n",
                "- Keep handlers small.\n- Run `bun test` from the module root, not the repo root.\n",
            ),
        );
    });

    test("L6 without a Learned section, it is added at the end", async () => {
        const tree = await verified();
        await Bun.write(join(tree, "CLAUDE.md"), "# App\n\nUse tabs.\n");
        await withCandidates(tree, LINE("x"));

        await apply(tree);

        expect(await Bun.file(join(tree, "CLAUDE.md")).text()).toBe(
            "# App\n\nUse tabs.\n\n## Learned\n\n- Run `bun test` from the module root, not the repo root.\n",
        );
    });

    test("L7 writes only ticked candidates, marks them applied, and applies nothing twice", async () => {
        const tree = await verified();
        await Bun.write(join(tree, "CLAUDE.md"), "# App\n");
        await withCandidates(tree, ADR(" "), LINE("x"));

        await apply(tree);
        const again = await apply(tree);

        expect(await Bun.file(join(tree, "docs/adr")).exists()).toBe(false);
        const text = await Bun.file(knowledge(tree)).text();
        expect(text).toContain("- [ ] K1 [ADR] Health checks bypass the auth middleware\n");
        expect(text).toContain("not the repo root. (applied: CLAUDE.md)");
        expect(again).toMatchObject({ exit: 0 });
        expect(again.out).toContain("Nothing to apply");
        expect((await Bun.file(join(tree, "CLAUDE.md")).text()).match(/bun test/g)).toHaveLength(1);
    });

    test("L8 commits only what it wrote and KNOWLEDGE.md, as the knowledge, and prints the commit", async () => {
        const tree = await verified();
        await withCandidates(tree, ADR("x"), LINE("x"));
        const before = await head(tree);

        const { out } = await apply(tree);

        const commit = (await git(tree, "log", "-1", "--format=%h %s")).text().trim();
        expect(out).toContain(`Committed: ${commit}`);
        expect(await commitsSince(tree, before)).toEqual([
            {
                subject: "docs(C-00001): add knowledge",
                files: [
                    ".craftpath/work/C-00001/KNOWLEDGE.md",
                    "CLAUDE.md",
                    "docs/adr/ADR-0001.md",
                ],
            },
        ]);
    });
});
