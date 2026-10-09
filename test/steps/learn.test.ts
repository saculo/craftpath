/**
 * Step 5: `/craftpath:learn <work id>` and `/craftpath:learn-apply <work id>`.
 *
 * `learn` proposes knowledge candidates in KNOWLEDGE.md, each holding the exact
 * text to keep; the user ticks the ones to keep; `learn-apply` writes the
 * ticked ones -- an ADR in docs/adr/, or a line appended to CLAUDE.md or
 * AGENTS.md -- marks them applied and commits them.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch } from "../scratch";
import { commitsSince, done, guard, head, ID, review, script } from "./kit";

afterAll(cleanScratch);

const knowledge = (tree: string) => join(tree, ".craftpath/work", ID, "KNOWLEDGE.md");

/** A work item whose review has no point left open. */
async function reviewed(points = "None"): Promise<string> {
    const { tree } = await done();
    await script(tree, "review", ID);
    await Bun.write(
        review(tree),
        `# C-00001 — Health endpoint: review\n\n- **Reviewed at:** ${await head(tree)}\n\n## Points\n\n${points}\n`,
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

describe("/craftpath:learn", () => {
    test("L1 is refused without REVIEW.md, and while a review point is open", async () => {
        const { tree } = await done();
        const missing = await guard(tree, "learn", ID);

        const open = await guard(
            await reviewed("- [ ] R1 [major] src/app.ts:1 -- health says ok without checking"),
            "learn",
            ID,
        );

        expect(missing.blocked).toBe(true);
        expect(missing.reason).toContain("REVIEW.md");
        expect(open.blocked).toBe(true);
        expect(open.reason).toContain("R1 [major]");
        expect((await guard(await reviewed(), "learn", ID)).blocked).toBe(false);
    });

    test("L2 creates KNOWLEDGE.md and prints the sources, each task file included, and next id K1", async () => {
        const tree = await reviewed();

        const { exit, out } = await script(tree, "learn", ID);

        expect(exit).toBe(0);
        expect(await Bun.file(knowledge(tree)).text()).toStartWith(
            "# C-00001 — Health endpoint: knowledge",
        );
        expect(out).toContain(knowledge(tree));
        expect(out).toContain(join(tree, ".craftpath/work", ID, "SPEC.md"));
        expect(out).toContain(join(tree, ".craftpath/work", ID, "tasks/T-0001.md"));
        expect(out).toContain(review(tree));
        expect(out).toContain("next candidate: K1");
    });

    test("L2 keeps an existing KNOWLEDGE.md and its candidates, and gives one past the highest id", async () => {
        const tree = await reviewed();
        await withCandidates(tree, ADR(" ", "K1"), LINE("x", "K4"));
        const before = await Bun.file(knowledge(tree)).text();

        const { out } = await script(tree, "learn", ID);

        expect(await Bun.file(knowledge(tree)).text()).toBe(before);
        expect(out).toContain("next candidate: K5");
    });
});

describe("check.py knowledge -- what 'complete' means for KNOWLEDGE.md", () => {
    test("L3 well-formed candidates pass, and so does None", async () => {
        const tree = await reviewed();
        await withCandidates(tree, ADR(" "), LINE("x"));
        expect(await script(tree, "check", "knowledge", ID)).toMatchObject({ exit: 0 });

        await withCandidates(tree, "None");
        expect(await script(tree, "check", "knowledge", ID)).toMatchObject({ exit: 0 });
    });

    test("L3 names a malformed line, a duplicate id, an unknown target and an ADR missing a field", async () => {
        const tree = await reviewed();
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

describe("/craftpath:learn-apply", () => {
    const apply = (tree: string) => script(tree, "learn-apply", ID);

    test("L4 is refused when no candidate is ticked, and when every ticked one is applied", async () => {
        const tree = await reviewed();
        await withCandidates(tree, ADR(" "));
        const none = await guard(tree, "learn-apply", ID);

        await withCandidates(
            tree,
            `${ADR("x").split("\n")[0]} (applied: docs/adr/ADR-0001-x.md)${ADR("x").slice(ADR("x").indexOf("\n"))}`,
        );
        const applied = await guard(tree, "learn-apply", ID);

        expect(none.blocked).toBe(true);
        expect(none.reason).toContain("Tick");
        expect(applied.blocked).toBe(true);
        expect(applied.reason).toContain("already applied");
    });

    test("L5 a ticked ADR is written to docs/adr, numbered after the highest there", async () => {
        const tree = await reviewed();
        await Bun.write(join(tree, "docs/adr/ADR-0002-use-bun.md"), "# ADR-0002 — Use Bun\n");
        await withCandidates(tree, ADR("x"));

        const { exit } = await apply(tree);

        expect(exit).toBe(0);
        const adr = await Bun.file(
            join(tree, "docs/adr/ADR-0003-health-checks-bypass-the-auth-middleware.md"),
        ).text();
        expect(adr).toStartWith("# ADR-0003 — Health checks bypass the auth middleware");
        expect(adr).toContain("load balancers carry no token.");
        expect(adr).toContain("/health is mounted before the auth middleware.");
        expect(adr).toContain("/health must never return anything secret.");
        expect(adr).toContain("C-00001 K1");
        expect(adr).toContain("SPEC S1, review R1");
    });

    test("L6 a ticked CLAUDE.md line is appended under Learned, leaving the rest unchanged", async () => {
        const tree = await reviewed();
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
        const tree = await reviewed();
        await Bun.write(join(tree, "CLAUDE.md"), "# App\n\nUse tabs.\n");
        await withCandidates(tree, LINE("x"));

        await apply(tree);

        expect(await Bun.file(join(tree, "CLAUDE.md")).text()).toBe(
            "# App\n\nUse tabs.\n\n## Learned\n\n- Run `bun test` from the module root, not the repo root.\n",
        );
    });

    test("L7 writes only ticked candidates, marks them applied, and applies nothing twice", async () => {
        const tree = await reviewed();
        await Bun.write(join(tree, "CLAUDE.md"), "# App\n");
        await withCandidates(tree, ADR(" "), LINE("x"));

        await apply(tree);
        const again = await apply(tree);

        expect(await Bun.file(join(tree, "docs/adr")).exists()).toBe(false);
        const text = await Bun.file(knowledge(tree)).text();
        expect(text).toContain("- [ ] K1 [ADR] Health checks bypass the auth middleware\n");
        expect(text).toContain("not the repo root. (applied: CLAUDE.md)");
        expect(again.exit).toBe(1);
        expect((await Bun.file(join(tree, "CLAUDE.md")).text()).match(/bun test/g)).toHaveLength(1);
    });

    test("L8 commits only what it wrote and KNOWLEDGE.md, as the knowledge", async () => {
        const tree = await reviewed();
        await withCandidates(tree, ADR("x"), LINE("x"));
        const before = await head(tree);

        await apply(tree);

        expect(await commitsSince(tree, before)).toEqual([
            {
                subject: "docs(C-00001): add knowledge",
                files: [
                    ".craftpath/work/C-00001/KNOWLEDGE.md",
                    "CLAUDE.md",
                    "docs/adr/ADR-0001-health-checks-bypass-the-auth-middleware.md",
                ],
            },
        ]);
    });
});
