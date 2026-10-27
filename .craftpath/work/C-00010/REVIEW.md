# C-00010 — Engineering principles replace discipline skills: review

- **Reviewed at:** f5c3327f011d567dd4fdc8a6dacee4a5c1e125ec

## Points

- [x] R1 [minor] src/init.ts:136 -- now that `backend`, `frontend` and `infrastructure` are retired names, a user's own skill in one of those folders that craftpath never installed (no manifest entry, so `files[skill]` is undefined) is reported as `kept      .claude/skills/frontend/SKILL.md (edited)` on every `init` run: it claims the user edited a craftpath file that was never craftpath's, and the line never goes away. With `testing` alone this was unlikely; `frontend`/`backend` are common names for a user's own skill. (solved in 7269ac4)
- [x] R2 [minor] assets/skills/fix-root-causes/SKILL.md:3 -- all five new principles open their description with "A principle, not an engineering discipline", contrasting them with the discipline skills this same work item removes; once `backend`/`frontend`/`infrastructure` are gone the contrast points at a category nothing installed belongs to, and the five are called "engineering principles" everywhere else (CLAUDE.md, test-first, the tests), which the phrase reads as denying. (solved in 0fd8aa8)
- [x] R3 [minor] assets/skills/test-first/SKILL.md:3 -- the description still opens "A principle, not an engineering discipline", the same contrast R2 removed from the five principles: with `backend`, `frontend` and `infrastructure` retired it points at a category nothing installed belongs to, and this work item's own `test-first` body now lists it beside the engineering principles (`never-block-on-the-human`'s "A rule of conduct, not an engineering discipline" carries the same stale contrast, outside the plan's Touches). (solved in f5c3327)
