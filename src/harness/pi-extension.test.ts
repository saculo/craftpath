/**
 * The pi extension craftpath installs.
 *
 * pi has no external hook protocol: the only way to intercept a tool call is
 * an extension, TypeScript loaded in-process. So craftpath ships one, and it
 * is tested AS SHIPPED -- the source constant is written to disk and imported,
 * so these exercise the exact bytes a project receives.
 */
import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir as osTmpdir } from "node:os";
import { join } from "node:path";
import { PI_EXTENSION } from "./pi-extension";

async function tmpdir(): Promise<string> {
    return await mkdtemp(join(osTmpdir(), "craftpath-pi-ext-"));
}

interface Registered {
    name: string;
    parameters: unknown;
    execute: unknown;
}

class FakePi {
    handlers = new Map<string, (e: unknown, c: unknown) => unknown>();
    tools: Registered[] = [];
    on(event: string, handler: (e: unknown, c: unknown) => unknown) {
        this.handlers.set(event, handler);
    }
    registerTool(tool: Registered) {
        this.tools.push(tool);
    }
}

/** The extension, written out and loaded the way pi loads it. */
async function loadExtension(): Promise<{
    default: (pi: FakePi) => void;
    guardFor: (tool: string, input: Record<string, unknown>) => string | null;
}> {
    const path = join(await tmpdir(), "craftpath.ts");
    await Bun.write(path, PI_EXTENSION);
    return (await import(path)) as never;
}

describe("the extension registers what pi is missing", () => {
    test("guards, the completion check, and a subagent tool", async () => {
        const mod = await loadExtension();
        const pi = new FakePi();
        mod.default(pi);

        expect([...pi.handlers.keys()].sort()).toEqual(["agent_before_settle", "tool_call"]);
        expect(pi.tools.map((t) => t.name)).toEqual(["craftpath_task"]);
    });

    test("a bash call is judged by the bash guard, a write by the write guard", async () => {
        const { guardFor } = await loadExtension();
        expect(guardFor("bash", { command: "ls" })).toBe("guard-bash");
        expect(guardFor("write", { path: "a.ts", content: "" })).toBe("guard-write");
        expect(guardFor("edit", { path: "a.ts", edits: [] })).toBe("guard-write");
    });

    test("a tool that touches neither a path nor a command is not spawned for", async () => {
        // The guards fire on every tool call, so a spawn per `read` or `grep`
        // is pure latency on the hot path for a verdict that is always allow.
        const { guardFor } = await loadExtension();
        expect(guardFor("grep", { pattern: "x" })).toBeNull();
        expect(guardFor("read", { path: "a.ts" })).toBeNull();
        expect(guardFor("ls", {})).toBeNull();
    });

    test("an unknown tool carrying a path is still guarded", async () => {
        // A tool craftpath has never heard of can still write a file, and the
        // guard is cheap relative to letting a state write through.
        const { guardFor } = await loadExtension();
        expect(guardFor("apply_patch", { file_path: "a.ts" })).toBe("guard-write");
    });
});

describe("the extension is self-contained", () => {
    test("it imports nothing a project would have to install", () => {
        // It is written into a repo that has no node_modules for it. Anything
        // beyond a node: builtin is an import pi cannot resolve, and an
        // extension that throws on load leaves the guards silently absent.
        const imports = [...PI_EXTENSION.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]!);
        expect(imports.length).toBeGreaterThan(0);
        for (const specifier of imports) {
            expect(specifier).toStartWith("node:");
        }
    });

    test("it parses as TypeScript", () => {
        expect(() =>
            new Bun.Transpiler({ loader: "ts" }).transformSync(PI_EXTENSION),
        ).not.toThrow();
    });

    test("it blocks on the exit code craftpath's guards actually use", () => {
        // BLOCK is 2, and the comparison has to be exact. A shim testing
        // `status !== 0` would read a crashed guard as a refusal -- blocking
        // work for a reason nobody can act on -- and, on the other side, would
        // never distinguish the two.
        expect(PI_EXTENSION).toContain("const BLOCK = 2;");
        // Both spawn sites that ask for a VERDICT -- the guards and the
        // completion check. The subagent's own exit code is a different
        // question (did that run succeed) and is deliberately not counted.
        expect([...PI_EXTENSION.matchAll(/status !== BLOCK/g)]).toHaveLength(2);
    });

    test("its continuation is latched, which pi's own docs require", () => {
        // "an unconditional `continue: true` is evaluated again after the next
        // response and can create an endless loop" -- docs/extensions.md.
        expect(PI_EXTENSION).toMatch(/continue: true/);
        expect(PI_EXTENSION.toLowerCase()).toContain("latch");
    });
});
