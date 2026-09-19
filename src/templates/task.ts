export const TASK_TEMPLATE = `---
id: <Tnnn>
title: <imperative, under 120 chars>
depends_on: []
skills: []
# design:                 # only when this task produces a design document
#   kind: <ux|architecture>
#   reason: <why this needs deciding before the dependent task can be built>
# produces:               # required for a design task; the files it writes
#   - <repo-relative path>
acceptance:
  - id: A1
    text: <observable outcome, mapped to a requirement scenario>
    verified_by:
      - cmd: <config.toml command key>
---

## Context
<!-- guidance: 3 sentences max. What the implementer needs that is not already
     in the code. -->

## Notes
<!-- guidance: appended during execution. Friction, surprises, dead ends. -->
`;
