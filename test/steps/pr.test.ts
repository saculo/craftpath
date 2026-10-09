/**
 * Step 4b: `/craftpath-pr <work id>`.
 *
 * The guard wants a review with no open point that saw the code being
 * proposed; `pr.py` commits REVIEW.md, pushes the branch and opens the pull
 * request with `gh`, or pushes to the one already open.
 *
 * `origin` is a local bare repository and `gh` a stub on PATH that records
 * its arguments and the body, so no test touches GitHub.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch, scratch } from "../scratch";
import { commitsSince, done, git, guard, head, ID, review, script } from "./kit";

afterAll(cleanScratch);

const BRANCH = "craftpath/C-00001-health-endpoint";
const URL = "https://github.example/o/app/pull/7";

// `gh pr view` finds a PR only when `existing` is there; `pr create` fails when
// `fail` is there. Every call is appended to `calls`, the body copied to `body.md`.
const GH = `#!/bin/sh
d="$GH_STUB"
echo "$*" >> "$d/calls"
case "$1 $2" in
  "pr view") [ -f "$d/existing" ] && { echo "${URL}"; exit 0; }; echo "no pull requests found" >&2; exit 1 ;;
  "pr create")
    [ -f "$d/fail" ] && { echo "GraphQL: base branch not found" >&2; exit 1; }
    while [ $# -gt 0 ]; do [ "$1" = "--body-file" ] && cp "$2" "$d/body.md"; shift; done
    echo "${URL}" ;;
esac
`;

/** A reviewed work item, with a bare `origin` and the gh stub. */
async function reviewed(points = "None"): Promise<{ tree: string; stub: string }> {
    const { root, tree } = await done();
    const origin = join(root, "..", "origin.git");
    await git(root, "init", "-q", "--bare", origin);
    await git(root, "remote", "add", "origin", origin);
    await script(tree, "review", ID);
    await Bun.write(
        review(tree),
        `# C-00001 — Health endpoint: review\n\n- **Reviewed at:** ${await head(tree)}\n\n## Points\n\n${points}\n`,
    );
    const stub = await scratch("craftpath-gh-");
    await Bun.write(join(stub, "gh"), GH);
    await Bun.$`chmod +x ${join(stub, "gh")}`;
    return { tree, stub };
}

async function pr(tree: string, stub: string) {
    const p = Bun.spawn(["python3", ".craftpath/scripts/pr.py", ID], {
        cwd: tree,
        env: { ...process.env, PATH: `${stub}:${process.env.PATH}`, GH_STUB: stub },
        stdout: "pipe",
        stderr: "pipe",
    });
    const [out, err] = await Promise.all([
        new Response(p.stdout).text(),
        new Response(p.stderr).text(),
    ]);
    return { exit: await p.exited, out, err };
}

const calls = async (stub: string) => {
    const file = Bun.file(join(stub, "calls"));
    return (await file.exists()) ? await file.text() : "";
};
const remoteHead = async (tree: string) =>
    (await git(tree, "ls-remote", "origin", BRANCH)).text().split("\t")[0];

describe("/craftpath-pr guard", () => {
    test("P1 is refused without REVIEW.md, saying to review first", async () => {
        const { tree } = await done();

        const { blocked, reason } = await guard(tree, "pr", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("REVIEW.md");
        expect(reason).toContain("/craftpath-review");
    });

    test("P1 is refused while a point is open, naming it", async () => {
        const { tree } = await reviewed(
            [
                "- [ ] R1 [major] src/app.ts:1 -- health says ok without checking anything",
                "- [-] R2 [minor] README.md -- no endpoint list (won't fix: out of scope)",
            ].join("\n"),
        );

        const { blocked, reason } = await guard(tree, "pr", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("R1 [major]");
        expect(reason).not.toContain("R2");
    });

    test("P2 is refused when code changed after the review, naming the commit", async () => {
        const { tree } = await reviewed();
        await Bun.write(join(tree, "src/app.ts"), "export const health = 'ok!';\n");
        await git(tree, "commit", "-q", "-am", "fix: louder health");

        const { blocked, reason } = await guard(tree, "pr", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("fix: louder health");
        expect(reason).toContain("/craftpath-review");
    });

    test("P2 lets a commit that changes only the work item's files through", async () => {
        const { tree } = await reviewed();
        await git(tree, "add", review(tree));
        await git(tree, "commit", "-q", "-m", "docs: the review");

        expect((await guard(tree, "pr", ID)).blocked).toBe(false);
    });

    test("L9 lets commits that change only docs/adr, CLAUDE.md or AGENTS.md through", async () => {
        const { tree } = await reviewed();
        await Bun.write(join(tree, "docs/adr/ADR-0001-health.md"), "# ADR-0001 — Health\n");
        await Bun.write(join(tree, "CLAUDE.md"), "## Learned\n\n- Run bun test.\n");
        await Bun.write(join(tree, "AGENTS.md"), "## Learned\n\n- Run bun test.\n");
        await git(tree, "add", "docs", "CLAUDE.md", "AGENTS.md");
        await git(tree, "commit", "-q", "-m", "docs(C-00001): add knowledge");

        expect((await guard(tree, "pr", ID)).blocked).toBe(false);
    });

    test("L9 still refuses a commit that changes code along with the knowledge", async () => {
        const { tree } = await reviewed();
        await Bun.write(join(tree, "CLAUDE.md"), "## Learned\n\n- Run bun test.\n");
        await Bun.write(join(tree, "src/app.ts"), "export const health = 'ok!';\n");
        await git(tree, "add", "CLAUDE.md", "src/app.ts");
        await git(tree, "commit", "-q", "-m", "docs: knowledge and a sneaky change");

        const { blocked, reason } = await guard(tree, "pr", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("sneaky change");
    });
});

describe("pr.py -- commit the review, push, open the pull request", () => {
    const REVIEWED = [
        "- [x] R1 [minor] src/app.ts:1 -- no type (solved in HEAD)",
        "- [-] R2 [minor] README.md -- no endpoint list (won't fix: out of scope)",
    ].join("\n");

    test("P3 commits REVIEW.md, and nothing else, as the review", async () => {
        const { tree, stub } = await reviewed();
        await Bun.write(join(tree, "notes.txt"), "mine\n");
        const before = await head(tree);

        await pr(tree, stub);

        expect(await commitsSince(tree, before)).toEqual([
            { subject: "docs(C-00001): add review", files: [".craftpath/work/C-00001/REVIEW.md"] },
        ]);
    });

    test("P4 pushes the branch and opens the PR with the title and a body from the files", async () => {
        const { tree, stub } = await reviewed();
        const sha = (await head(tree)).slice(0, 7);
        await Bun.write(
            review(tree),
            (await Bun.file(review(tree)).text()).replace("None", REVIEWED.replace("HEAD", sha)),
        );

        const { exit, out } = await pr(tree, stub);

        expect(exit).toBe(0);
        expect(out).toContain(URL);
        expect(await remoteHead(tree)).toBe(await head(tree));
        expect(await calls(stub)).toContain(
            `pr create --base main --head ${BRANCH} --title feat(C-00001): Health endpoint --body-file`,
        );
        const body = await Bun.file(join(stub, "body.md")).text();
        const task = (await git(tree, "log", "-1", "--format=%h %s", "--grep", "C-00001/T-0001"))
            .text()
            .trim();
        for (const part of [
            "Load balancers cannot tell whether the API is up.",
            "S1 — Health check succeeds",
            task,
            `R1 [minor] src/app.ts:1 -- no type (solved in ${sha})`,
            "won't fix: out of scope",
            "Checking the database.",
        ]) {
            expect({ part, found: body.includes(part) }).toEqual({ part, found: true });
        }
    });

    test("L10 the body lists the applied knowledge candidates, and only those", async () => {
        const { tree, stub } = await reviewed();
        await Bun.write(
            join(tree, ".craftpath/work", ID, "KNOWLEDGE.md"),
            [
                "# C-00001 — Health endpoint: knowledge",
                "",
                "## Candidates",
                "",
                "- [x] K1 [CLAUDE.md] Run `bun test` from the module root. (applied: CLAUDE.md)",
                "",
                "- [ ] K2 [CLAUDE.md] Prefer tabs.",
                "",
            ].join("\n"),
        );

        await pr(tree, stub);

        const body = await Bun.file(join(stub, "body.md")).text();
        expect(body).toContain("## Knowledge");
        expect(body).toContain(
            "[CLAUDE.md] Run `bun test` from the module root. (applied: CLAUDE.md)",
        );
        expect(body).not.toContain("Prefer tabs");
    });

    test("P4 takes fix as the title's type when no task is a feat", async () => {
        const { tree, stub } = await reviewed();
        const task = join(tree, ".craftpath/work", ID, "tasks/T-0001.md");
        await Bun.write(
            task,
            (await Bun.file(task).text()).replace("**Type:** feat", "**Type:** fix"),
        );
        await git(tree, "commit", "-q", "-am", "docs: it was a fix");

        await pr(tree, stub);

        expect(await calls(stub)).toContain("--title fix(C-00001): Health endpoint");
    });

    test("P5 with a PR already open, pushes the new commits and opens no second one", async () => {
        const { tree, stub } = await reviewed();
        await Bun.write(join(stub, "existing"), "");

        const { exit, out } = await pr(tree, stub);

        expect(exit).toBe(0);
        expect(out).toContain(URL);
        expect(await remoteHead(tree)).toBe(await head(tree));
        expect(await calls(stub)).not.toContain("pr create");
    });

    test("P6 when the push fails, exits 1 with git's error and opens nothing", async () => {
        const { tree, stub } = await reviewed();
        await git(tree, "remote", "remove", "origin");

        const { exit, err } = await pr(tree, stub);

        expect(exit).toBe(1);
        expect(err).toContain("origin");
        expect(await calls(stub)).not.toContain("pr create");
    });

    test("P6 when gh pr create fails, exits 1 with gh's error", async () => {
        const { tree, stub } = await reviewed();
        await Bun.write(join(stub, "fail"), "");

        const { exit, err } = await pr(tree, stub);

        expect(exit).toBe(1);
        expect(err).toContain("base branch not found");
    });
});
