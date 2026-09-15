/** Seed content for `.claude/skills/`. */
export const SKILLS_README = `# Skills

Engineering skills bound explicitly by tasks via their \`skills:\` field, and
preloaded into the executing subagent.

Set \`disable-model-invocation: true\` on each one. Tasks bind skills explicitly,
so fuzzy description-matching is pure downside — with 20+ skills Claude may load
the wrong one or miss one entirely.

Start with five sharp skills, not thirty fuzzy ones:
\`planning\`, \`backend\`, \`frontend\`, \`infrastructure\`, \`testing\`.

Add a technology skill (\`spring\`, \`react\`, \`terraform\`) only when it carries
knowledge the discipline skill does not.
`;
