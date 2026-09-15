export const FINDING_TEMPLATE = `# Finding — <symptom in one line>

<!-- guidance: output of /craftpath:investigate. Produces a requirement; never
     touches application code. -->

## Symptom
<!-- guidance: what was observed, with the report or trace that prompted it. -->

## Reproduction
<!-- guidance: a failing test or exact command. If it could not be reproduced,
     say so and record what was tried — that is a real result. -->

## Evidence
<!-- guidance: logs, traces, git history. Facts only; interpretation below. -->

## Hypotheses
<!-- guidance: each with what would confirm or rule it out. -->

## Root cause
<!-- guidance: the mechanism, not the symptom. If the evidence does not support
     a single cause, say which hypotheses remain open. -->

## Proposed requirement
<!-- guidance: a scenario that fails today and passes once fixed. -->
`;
