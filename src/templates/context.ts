export const CONTEXT_TEMPLATE = `# Context — <work id>

<!-- guidance: output of the UNDERSTAND phase, produced by a subagent.
     Bounded on purpose. If this runs past a screen, it is exploration notes,
     not context. -->

## Where this lives
<!-- guidance: the files and modules that will change, and why those. -->

## How it works today
<!-- guidance: existing behaviour relevant to the requirement. Facts only. -->

## Constraints
<!-- guidance: things that limit the solution — existing contracts, migrations,
     performance budgets, conventions enforced elsewhere. -->

## Open questions
<!-- guidance: what you could not determine from the code. -->
`;
