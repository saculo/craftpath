export const REQUIREMENT_TEMPLATE = `# <title>

## Problem
<!-- guidance: 2-4 sentences. What is wrong or missing today, and for whom.
     Describe the problem, not the solution. -->

## Scenarios
<!-- guidance: the core of this document. Each must be something a test could
     assert. If you cannot phrase it as Given/When/Then, it is not a
     requirement yet. -->

Scenario: <name>
  Given <precondition>
  When <action>
  Then <observable outcome>

## Out of scope
<!-- guidance: bullet list, max 5. Things a reader might reasonably assume are
     included but are not. -->

## Assumptions
<!-- guidance: ambiguities you resolved yourself rather than asking about.
     Empty is fine; silently guessing is not. -->
`;
