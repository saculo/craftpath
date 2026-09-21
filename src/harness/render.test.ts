/**
 * Rendering craftpath's prose for one harness.
 *
 * Commands and skills are one source. The handful of sentences that cannot be
 * harness-neutral -- where a skill lives, how a command is typed, how an
 * isolated task context is obtained -- are tokens resolved at install time,
 * rather than a forked copy per harness that drifts within two releases.
 */
import { describe, expect, test } from "bun:test";
import { CLAUDE_CODE } from "./claude-code";
import { PI } from "./pi";
import { render } from "./render";
import { COMMANDS } from "../commands/index";
import { SKILLS } from "../skills/index";
import { RULES } from "../rules/index";

describe("tokens resolve per harness", () => {
    test("where skills live", () => {
        expect(render("see {{SKILLS_DIR}}/backend", CLAUDE_CODE)).toBe(
            "see .claude/skills/backend",
        );
        expect(render("see {{SKILLS_DIR}}/backend", PI)).toBe("see .pi/skills/backend");
    });

    test("where the test-first rule lives, which is not a rule file everywhere", () => {
        expect(render("{{RULE:tdd.md}}", CLAUDE_CODE)).toBe(".claude/rules/tdd.md");
        expect(render("{{RULE:tdd.md}}", PI)).toBe(".pi/skills/tdd/SKILL.md");
    });

    test("how a command is typed", () => {
        expect(render("run {{CMD:pr}}", CLAUDE_CODE)).toBe("run /craftpath:pr");
        expect(render("run {{CMD:pr}}", PI)).toBe("run /craftpath-pr");
    });

    test("how an isolated task context is obtained", () => {
        // The one place the two harnesses genuinely differ in what the model
        // must DO, rather than in a path.
        expect(render("{{SUBAGENT}}", CLAUDE_CODE).toLowerCase()).toContain("subagent");
        expect(render("{{SUBAGENT}}", PI)).toContain("craftpath_task");
    });

    test("how a skill is loaded on demand", () => {
        // Claude Code can be told to load one; pi has no invocation, only a
        // path and an instruction to read it -- so "load the planning skill"
        // there is a sentence with no mechanism behind it.
        expect(render("{{LOAD_SKILL:planning}}", CLAUDE_CODE)).toBe("load the `planning` skill");
        expect(render("{{LOAD_SKILL:planning}}", PI)).toBe(
            "read `.pi/skills/planning/SKILL.md` in full",
        );
    });

    test("an unknown token is a build error, not a literal in shipped prose", () => {
        expect(() => render("{{NOPE}}", PI)).toThrow(/NOPE/);
        expect(() => render("{{CMD:nosuch}}", PI)).toThrow(/nosuch/);
    });
});

describe("nothing ships with a hard-coded harness path", () => {
    const sources = { ...COMMANDS, ...SKILLS, ...RULES };

    for (const [name, body] of Object.entries(sources)) {
        test(`${name} names no harness directory directly`, () => {
            // A literal `.claude/` in a file installed into `.pi/` is an
            // instruction to read a path that is not there -- and the model
            // follows it, because the document is the authority.
            expect(body).not.toMatch(/\.claude\//);
            expect(body).not.toMatch(/\.pi\//);
        });

        test(`${name} renders with every token resolved, for both harnesses`, () => {
            for (const harness of [CLAUDE_CODE, PI]) {
                expect(render(body, harness)).not.toMatch(/\{\{/);
            }
        });
    }
});

describe("what a project actually receives", () => {
    test("nothing tells pi to use a capability pi does not have", () => {
        // The failure this catches is not a broken build -- it is a document
        // that reads perfectly and instructs the model to do something
        // impossible, which it then improvises around. `subagent` is Claude
        // Code's word; on pi the only isolated context is `craftpath_task`.
        for (const [name, body] of Object.entries({ ...COMMANDS, ...SKILLS, ...RULES })) {
            expect(`${name}: ${render(body, PI)}`.toLowerCase()).not.toContain("subagent");
        }
    });

    test("the Claude Code work command tells the model to use a subagent", () => {
        expect(render(COMMANDS["work.md"]!, CLAUDE_CODE)).toContain("subagent");
    });

    test("the pi work command tells it to call the tool pi was given instead", () => {
        const rendered = render(COMMANDS["work.md"]!, PI);
        expect(rendered).toContain("craftpath_task");
        // And never the Claude Code spelling: pi has no such tool, so an
        // instruction to "start a subagent" there is an instruction to improvise.
        expect(rendered).not.toContain("fresh subagent");
    });
});
