/** Seed content for the harness's skills directory. */
export const SKILLS_README = `# Skills

Engineering skills that tasks bind by name in their \`skills:\` field. The
executing task loads every skill it names, and stops if one is
missing.

Installed by \`craftpath init\`:

- \`planning\` — decomposing work into tasks with criteria bound to real tests
- \`backend\`, \`frontend\`, \`infrastructure\` — implementing, test-first
- \`testing\` — end-to-end journeys, which level a test belongs at, suite health
- \`ux\`, \`architecture\` — design tasks that decide before anyone builds

These are this project's copies: edit them to fit it. \`craftpath update\`
replaces a skill you did not edit with the newer version and adds any skill a
newer craftpath ships. A skill you edited is kept; if the release changes it
too, \`update\` asks, or without a terminal writes the new version beside it as
\`SKILL.md.new\`.

Add a technology skill (\`spring\`, \`react\`, \`terraform\`) only when it carries
knowledge the discipline skill does not.
`;
