# C-00006 — Test-first as a principle skill: review

- **Reviewed at:** 1fec0232c0e39dbd1e87401f2ab135b93c8d7e2a

## Points

- [x] R1 [minor] .claude/skills/craftpath-spec/SKILL.md:39 -- T-0005 refreshed the installed spec step (both harnesses) to the version that requires an `## Assumptions` section, but reverted `.craftpath/templates/SPEC.md` and `.craftpath/scripts/checks.py` to their old versions, which have no such section and do not check for it; this repo's next `/craftpath-spec` is told to fill a section its template lacks and its check ignores. The installed copies are left half-refreshed, by a change no scenario asks for. (solved in 1fec023)
