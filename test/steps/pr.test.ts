/**
 * Step 4b: `/craftpath-pr <work id>`.
 *
 * The guard wants a verification with no open point that saw the code being
 * proposed; `pr.py` commits VERIFY.md, pushes the branch and opens the pull
 * request with `gh`, or pushes to the one already open.
 *
 * `origin` is a local bare repository and `gh` a stub on PATH that records
 * its arguments and the body, so no test touches GitHub.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { cleanScratch, scratch } from "../scratch";
import { commitsSince, done, git, guard, head, ID, review, script, verify } from "./kit";

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

/** A verified work item, with a bare `origin` and the gh stub. */
async function verified(points = "None"): Promise<{ tree: string; stub: string }> {
    const { root, tree } = await done();
    const origin = join(root, "..", "origin.git");
    await git(root, "init", "-q", "--bare", origin);
    await git(root, "remote", "add", "origin", origin);
    await script(tree, "verify", ID);
    await Bun.write(
        verify(tree),
        `# C-00001 — Health endpoint: verify\n\n- **Verified at:** ${await head(tree)}\n\n## Points\n\n${points}\n`,
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
    test("S11 pr is refused while a verify point is open, naming it", async () => {
        const point =
            "- [ ] F1 [major] src/app.ts:1 -- given no database, GET /health still answers ok";
        const { tree } = await verified(point);

        const { blocked, reason } = await guard(tree, "pr", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain(point);
        expect(reason).toContain(`/craftpath-verify ${ID}`);
    });

    test("S11 pr is refused without VERIFY.md, even with a closed REVIEW.md", async () => {
        const { tree } = await done();
        await script(tree, "review", ID);
        await Bun.write(
            review(tree),
            `# C-00001 — Health endpoint: review\n\n- **Reviewed at:** ${await head(tree)}\n\n## Points\n\nNone\n`,
        );

        const { blocked, reason } = await guard(tree, "pr", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("VERIFY.md");
        expect(reason).toContain(`/craftpath-verify ${ID}`);
    });

    test("S11 pr is refused when code changed after Verified at", async () => {
        const { tree } = await verified();
        await Bun.write(join(tree, "src/app.ts"), "export const health = 'ok!';\n");
        await git(tree, "commit", "-q", "-am", "fix: louder health");

        const { blocked, reason } = await guard(tree, "pr", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("fix: louder health");
        expect(reason).toContain(`run /craftpath-verify ${ID} again`);
    });

    test("S11 pr lets a commit to the work item's own files through", async () => {
        const { tree } = await verified();
        await git(tree, "add", verify(tree));
        await git(tree, "commit", "-q", "-m", "docs: the verification");

        expect((await guard(tree, "pr", ID)).blocked).toBe(false);
    });

    test("L9 lets commits that change only docs/adr, CLAUDE.md or AGENTS.md through", async () => {
        const { tree } = await verified();
        await Bun.write(join(tree, "docs/adr/ADR-0001-health.md"), "# ADR-0001 — Health\n");
        await Bun.write(join(tree, "CLAUDE.md"), "## Learned\n\n- Run bun test.\n");
        await Bun.write(join(tree, "AGENTS.md"), "## Learned\n\n- Run bun test.\n");
        await git(tree, "add", "docs", "CLAUDE.md", "AGENTS.md");
        await git(tree, "commit", "-q", "-m", "docs(C-00001): add knowledge");

        expect((await guard(tree, "pr", ID)).blocked).toBe(false);
    });

    test("L9 still refuses a commit that changes code along with the knowledge", async () => {
        const { tree } = await verified();
        await Bun.write(join(tree, "CLAUDE.md"), "## Learned\n\n- Run bun test.\n");
        await Bun.write(join(tree, "src/app.ts"), "export const health = 'ok!';\n");
        await git(tree, "add", "CLAUDE.md", "src/app.ts");
        await git(tree, "commit", "-q", "-m", "docs: knowledge and a sneaky change");

        const { blocked, reason } = await guard(tree, "pr", ID);

        expect(blocked).toBe(true);
        expect(reason).toContain("sneaky change");
    });
});

const DECISIONS = [
    "# C-00001 — Decisions",
    "",
    "## T-0001 — Add the endpoint",
    "",
    "- Named the route /health -- it matches the spec",
    "",
    "## T-0002 — Document it",
    "",
    "None",
    "",
].join("\n");
const DECIDED = [
    "### T-0001 — Add the endpoint",
    "",
    "- Named the route /health -- it matches the spec",
    "",
    "### T-0002 — Document it",
    "",
    "None",
].join("\n");

/** Writes DECISIONS.md into the work item and commits it, as the verify step does. */
async function decide(tree: string) {
    await Bun.write(join(tree, ".craftpath/work", ID, "DECISIONS.md"), DECISIONS);
    await git(tree, "add", join(".craftpath/work", ID, "DECISIONS.md"));
    await git(tree, "commit", "-q", "-m", "docs(C-00001): add decisions");
}

/** The text of the body's `## name` section, up to the next `## ` heading. */
function section(body: string, name: string): string | undefined {
    const parts = body.split(/^## /m);
    const found = parts.find((part) => part.startsWith(`${name}\n`));
    return found?.slice(name.length + 1).trim();
}

const headings = (body: string) =>
    body
        .split("\n")
        .filter((line) => line.startsWith("## "))
        .map((line) => line.slice(3));

describe("pr.py -- commit the verification, push, open the pull request", () => {
    const VERIFIED = [
        "- [x] F1 [minor] src/app.ts:1 -- given a POST request, it answers 405 (solved in HEAD)",
        "- [-] F2 [minor] README.md:1 -- given a reader, no endpoint list (won't fix: out of scope)",
    ].join("\n");

    test("S11 pr commits VERIFY.md and builds the body's Verify section from it", async () => {
        const { tree, stub } = await verified();
        await Bun.write(join(tree, "notes.txt"), "mine\n");
        const before = await head(tree);

        await pr(tree, stub);

        expect(await commitsSince(tree, before)).toEqual([
            { subject: "docs(C-00001): add verify", files: [".craftpath/work/C-00001/VERIFY.md"] },
        ]);
        const body = await Bun.file(join(stub, "body.md")).text();
        expect(section(body, "Verify")).toBe("No points.");
        expect(headings(body)).not.toContain("Review");
    });

    test("P4 pushes the branch and opens the PR with the title and a body from the files", async () => {
        const { tree, stub } = await verified();
        const sha = (await head(tree)).slice(0, 7);
        await Bun.write(
            verify(tree),
            (await Bun.file(verify(tree)).text()).replace("None", VERIFIED.replace("HEAD", sha)),
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
            `F1 [minor] src/app.ts:1 -- given a POST request, it answers 405 (solved in ${sha})`,
            "won't fix: out of scope",
            "Checking the database.",
        ]) {
            expect({ part, found: body.includes(part) }).toEqual({ part, found: true });
        }
    });

    test("L10 the body lists the applied knowledge candidates, and only those", async () => {
        const { tree, stub } = await verified();
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
        const { tree, stub } = await verified();
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
        const { tree, stub } = await verified();
        await Bun.write(join(stub, "existing"), "");

        const { exit, out } = await pr(tree, stub);

        expect(exit).toBe(0);
        expect(out).toContain(URL);
        expect(await remoteHead(tree)).toBe(await head(tree));
        expect(await calls(stub)).not.toContain("pr create");
    });

    test("P6 when the push fails, exits 1 with git's error and opens nothing", async () => {
        const { tree, stub } = await verified();
        await git(tree, "remote", "remove", "origin");

        const { exit, err } = await pr(tree, stub);

        expect(exit).toBe(1);
        expect(err).toContain("origin");
        expect(await calls(stub)).not.toContain("pr create");
    });

    test("D1 the body carries the recorded decisions under Decisions, right after Tasks", async () => {
        const { tree, stub } = await verified();
        await decide(tree);

        const { exit } = await pr(tree, stub);

        expect(exit).toBe(0);
        const body = await Bun.file(join(stub, "body.md")).text();
        expect(section(body, "Decisions")).toBe(DECIDED);
        const order = headings(body);
        expect(order[order.indexOf("Tasks") + 1]).toBe("Decisions");
    });

    test("D1 drops the decisions file's own title and nests its task headings", async () => {
        const { tree, stub } = await verified();
        await decide(tree);

        await pr(tree, stub);

        const lines = (await Bun.file(join(stub, "body.md")).text()).split("\n");
        expect(lines.filter((line) => line.startsWith("# "))).toEqual([]);
        expect(lines).not.toContain("## T-0001 — Add the endpoint");
        expect(lines).not.toContain("## T-0002 — Document it");
    });

    test("D1 changes nothing in the body but adding the Decisions section", async () => {
        const { tree, stub } = await verified();
        await pr(tree, stub);
        const without = await Bun.file(join(stub, "body.md")).text();
        await decide(tree);

        await pr(tree, stub);

        const withDecisions = await Bun.file(join(stub, "body.md")).text();
        expect(withDecisions).toBe(
            without.replace("## Verify", `## Decisions\n\n${DECIDED}\n\n## Verify`),
        );
    });

    test("D2 without DECISIONS.md, the body has no Decisions section", async () => {
        const { tree, stub } = await verified();

        const { exit } = await pr(tree, stub);

        expect(exit).toBe(0);
        const body = await Bun.file(join(stub, "body.md")).text();
        expect(body.split("\n").filter((line) => line.startsWith("### T-"))).toEqual([]);
        expect(headings(body)).toEqual(["Problem", "Scenarios", "Tasks", "Verify", "Out of scope"]);
        expect(await Bun.file(join(tree, ".craftpath/work", ID, "DECISIONS.md")).exists()).toBe(
            false,
        );
    });

    test("P6 when gh pr create fails, exits 1 with gh's error", async () => {
        const { tree, stub } = await verified();
        await Bun.write(join(stub, "fail"), "");

        const { exit, err } = await pr(tree, stub);

        expect(exit).toBe(1);
        expect(err).toContain("base branch not found");
    });
});
