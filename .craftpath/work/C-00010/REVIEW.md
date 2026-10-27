# C-00010 — Engineering principles replace discipline skills: review

- **Reviewed at:** 0fd8aa8d273acb14f29500b708a463e5f03bfd74

## Points

- [x] R1 [minor] src/init.ts:136 -- now that `backend`, `frontend` and `infrastructure` are retired names, a user's own skill in one of those folders that craftpath never installed (no manifest entry, so `files[skill]` is undefined) is reported as `kept      .claude/skills/frontend/SKILL.md (edited)` on every `init` run: it claims the user edited a craftpath file that was never craftpath's, and the line never goes away. With `testing` alone this was unlikely; `frontend`/`backend` are common names for a user's own skill. (solved in 7269ac4)
- [x] R2 [minor] assets/skills/fix-root-causes/SKILL.md:3 -- all five new principles open their description with "A principle, not an engineering discipline", contrasting them with the discipline skills this same work item removes; once `backend`/`frontend`/`infrastructure` are gone the contrast points at a category nothing installed belongs to, and the five are called "engineering principles" everywhere else (CLAUDE.md, test-first, the tests), which the phrase reads as denying. (solved in 0fd8aa8)
