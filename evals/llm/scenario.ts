/**
 * A real-model scenario: a fixture project, a prompt, the harnesses to run it
 * on, its caps, and the graders that decide it. One `scenario.yaml` per
 * directory under `evals/llm/scenarios/`.
 */
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

const Gate = z.enum(["auto", "manual"]);

export const Scenario = z
    .object({
        id: z.string().regex(/^[A-Z]\d*-[a-z0-9-]+$/, "like L1-small-feature"),
        fixture: z.string().min(1),
        harnesses: z.array(z.enum(["claude-code", "pi"])).min(1),
        trials: z.int().min(1),
        budget: z
            .object({
                turns: z.int().min(1),
                usd: z.number().positive(),
                minutes: z.number().positive(),
            })
            .strict(),
        gates: z
            .object({ requirement: Gate, plan: Gate, result: Gate })
            .partial()
            .strict()
            .optional(),
        modules: z
            .record(
                z.string(),
                z.object({
                    path: z.string(),
                    test: z.string().optional(),
                    build: z.string().optional(),
                }),
            )
            .optional(),
        prompt: z.string().min(1),
        graders: z.array(z.string().min(1)).min(1),
    })
    .strict();

export type Scenario = z.infer<typeof Scenario>;

export async function loadScenarios(dir: string): Promise<Scenario[]> {
    const scenarios: Scenario[] = [];
    if (!(await isDir(dir))) return scenarios;
    for await (const file of new Bun.Glob("*/scenario.yaml").scan({ cwd: dir })) {
        const parsed = Scenario.safeParse(Bun.YAML.parse(await Bun.file(join(dir, file)).text()));
        if (!parsed.success) {
            throw new Error(
                `${file}: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
            );
        }
        scenarios.push(parsed.data);
    }
    return scenarios.sort((a, b) => a.id.localeCompare(b.id));
}

/** A fixture's files, relative to the fixture directory. */
export async function fixtureFiles(dir: string, name: string): Promise<Record<string, string>> {
    const root = join(dir, name);
    const files: Record<string, string> = {};
    for await (const rel of new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true })) {
        files[rel] = await Bun.file(join(root, rel)).text();
    }
    if (Object.keys(files).length === 0)
        throw new Error(`fixture ${name} has no files under ${root}`);
    return files;
}

async function isDir(path: string): Promise<boolean> {
    return stat(path).then(
        (s) => s.isDirectory(),
        () => false,
    );
}
