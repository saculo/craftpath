/**
 * `craftpath pr body` -- the pull request description, generated from what was
 * proven.
 *
 * Never freehand (D5): a reviewer gets the same shape every time, and nothing in
 * it is a claim the kernel did not check. Refuses unless completion is proven,
 * because it is piped straight into `gh pr create`.
 */
import { join } from "node:path";
import type { Acceptance } from "../schema";
import { type Task, isStale } from "../transitions";
import { proveComplete } from "./validate";
import { WORK } from "./work";

export async function prBody(root: string): Promise<string> {
    const { work, tasks, hash } = await proveComplete(root);
    const dir = join(root, WORK, work.id);

    const rows: string[] = [];
    const acknowledged: string[] = [];
    let total = 0;

    for (const id of [...tasks.keys()].sort()) {
        const task = tasks.get(id)!;
        for (const criterion of task.acceptance) {
            total++;
            rows.push(`| ${id} | ${criterion.id} | ${cell(proofOf(task, criterion, hash))} |`);
            if (criterion.verified_by.some((v) => v.cmd === "manual")) {
                acknowledged.push(`- ${id} ${criterion.id} — ${proofOf(task, criterion, hash)}`);
            }
        }
    }

    const byCommand = total - acknowledged.length;
    const verification =
        acknowledged.length === 0
            ? [`All ${total} criteria are proven by a command.`]
            : [
                  `${byCommand} of ${total} criteria proven by a command. ` +
                      `${acknowledged.length} rest on a signed acknowledgement:`,
                  "",
                  ...acknowledged,
              ];

    const problem = sectionOf(await textOf(join(dir, "requirement.md")), "Problem");
    const delta = stripGuidance(await textOf(join(dir, "spec-delta.md")))
        .trim()
        .replace(/^## /gm, "### ");

    return [
        "## What",
        "",
        `**${work.title}** (\`${work.id}\`)`,
        "",
        problem || "_requirement.md has no Problem section._",
        "",
        "## Tasks",
        "",
        "| Task | Criterion | Proven by |",
        "|---|---|---|",
        ...rows,
        "",
        "## Verification",
        "",
        ...verification,
        "",
        "## Spec changes",
        "",
        delta,
        "",
    ].join("\n");
}

/** What proved one criterion, one entry per `verified_by`. */
function proofOf(task: Task, criterion: Acceptance, hash: string): string {
    return criterion.verified_by
        .map(({ cmd, selector }) => {
            if (cmd === "manual") {
                const ack = task.acks.findLast(
                    (a) => a.criterion_id === criterion.id && !isStale(a, hash),
                );
                return `acknowledged by ${ack?.by ?? "nobody"}`;
            }
            return selector === undefined ? `\`${cmd}\` (whole suite)` : `\`${cmd}\` \`${selector}\``;
        })
        .join("; ");
}

/** A selector can contain `|`, which would split the table row. */
function cell(value: string): string {
    return value.replaceAll("|", "\\|");
}

async function textOf(path: string): Promise<string> {
    const file = Bun.file(path);
    return (await file.exists()) ? await file.text() : "";
}

function stripGuidance(text: string): string {
    return text.replace(/<!--\s*guidance:[\s\S]*?-->/g, "");
}

/** The body of a `## <heading>` section, guidance stripped. */
function sectionOf(markdown: string, heading: string): string {
    const match = new RegExp(`^## ${heading}\\s*$`, "m").exec(markdown);
    if (!match) return "";
    const rest = markdown.slice(match.index + match[0].length);
    const end = rest.search(/^## /m);
    return stripGuidance(end === -1 ? rest : rest.slice(0, end)).trim();
}
