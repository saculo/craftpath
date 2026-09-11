---
# Frontmatter is validated by the TaskProse schema (src/schema.ts), which is strict:
# unknown fields are rejected. There is no status, evidence or `met` field —
# those belong to the CLI, not this file.
id: {{task_id}}
title: {{title}}
depends_on: []
skills: []
acceptance:
  - id: A1
    text: {{observable, testable statement}}
    verified_by:
      - cmd: {{command key from config.toml, or "manual"}}
        selector: {{specific test for THIS criterion; omit for manual}}
---

## Context

<!-- guidance: 3 sentences max. What the implementer needs that isn't in the code: relevant files, constraints, the requirement scenario this serves. -->

## Notes

<!-- guidance: Free-form, written during execution. Decisions made, surprises, anything the next session needs to resume. Delete this comment when you first write here. -->
