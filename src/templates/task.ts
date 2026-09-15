export const TASK_TEMPLATE = `---
id: <Tnnn>
title: <imperative, under 120 chars>
depends_on: []
skills: []
acceptance:
  - id: A1
    text: <observable outcome, mapped to a requirement scenario>
    verified_by:
      - cmd: <config.toml command key>
        selector: <specific test — a green suite proves nothing about A1>
---

## Context
<!-- guidance: 3 sentences max. What the implementer needs that is not already
     in the code. -->

## Notes
<!-- guidance: appended during execution. Friction, surprises, dead ends. -->
`;
