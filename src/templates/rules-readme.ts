/** Seed content for a harness's rules directory, so it is not just empty. */
export const RULES_README = `# Rules

Path-scoped conventions. A rule with \`paths\` frontmatter loads only when Claude
touches a matching file, so it costs no context elsewhere.

Rules are a safety net for things that must hold even when a task forgot to
attach the relevant skill. Keep them short and pointing at the skill — never
duplicate its content.

\`\`\`markdown
---
paths: infra/**
---

- Never run \`terraform apply\` directly; the CLI gates it.
- Every resource carries the standard tag set.
\`\`\`

This is where a lesson goes once it has bitten twice. Prefer encoding it even
further left — a lint rule or a test enforces itself forever at zero context
cost, while a rule file is still only a request.
`;
