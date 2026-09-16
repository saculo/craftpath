/** Seed content for `.claude/skills/`. */
export const SKILLS_README = `# Skills

Engineering skills that tasks bind by name in their \`skills:\` field. The
executing subagent loads every skill its task names, and stops if one is
missing.

Installed by \`craftpath init\`:

- \`planning\` — decomposing work into tasks with criteria bound to real tests
- \`backend\`, \`frontend\`, \`infrastructure\` — implementing, test-first
- \`testing\` — end-to-end journeys, which level a test belongs at, suite health
- \`ux\`, \`architecture\` — design tasks that decide before anyone builds

These are this project's copies: edit them to fit it. \`craftpath init\` and
\`craftpath update\` never overwrite a skill that exists, and \`update\` adds any
skill a newer craftpath ships.

Add a technology skill (\`spring\`, \`react\`, \`terraform\`) only when it carries
knowledge the discipline skill does not.
`;
