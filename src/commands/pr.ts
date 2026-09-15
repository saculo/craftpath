import { GENERATED, renderCommand } from "./generated";

export const PR_COMMAND = renderCommand(`---
description: Work through PR review comments with an explicit disposition each
argument-hint: [pr number]
---
${GENERATED}

Resolve review comments on: $ARGUMENTS (default: the PR for the current branch)

Fetch threads with \`gh pr view --comments\`.

**Every thread gets a response. None are silently dropped.** Classify each:

| Disposition | Action |
|---|---|
| \`accept-and-fix\` | \`craftpath task add <id> --title "<t>" --reason "review: <comment>"\`, implement, verify, commit with the trailer |
| \`accept-but-defer\` | \`craftpath work new\` for a follow-up; reply with the link |
| \`reject-with-rationale\` | Reply with the reasoning. Disagreeing is allowed |
| \`needs-clarification\` | Ask; leave the thread open |

Show all classifications **before acting on any of them**, so the user can
correct a disposition while it is still cheap. A rejected comment that should
have been accepted is much cheaper to catch now than after the reply is posted.

Fixes follow the normal path -- \`task start\`, \`task verify\`, \`task done\`. A
review fix is not exempt from evidence, and a one-line change can still break a
test.

If a fix would change the approved plan's shape rather than add to it, run
\`craftpath amend <id> --reason "<why>"\` first. Adding or amending a task reopens
the plan and result gates; approve them again before archiving.

If the same comment has appeared for a third time across PRs, flag it. That is a
convention that belongs in \`.claude/rules/\` or a lint rule, not in a reviewer's
head.
`);
