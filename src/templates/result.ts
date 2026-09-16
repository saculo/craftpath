export const RESULT_TEMPLATE = `# Result — <work id>

<!-- guidance: written at the RESULT phase, before G3. This is what a reviewer
     reads instead of the diff. -->

## What changed
<!-- guidance: the observable behaviour that is different now. Not a file list
     — git already has that. -->

## Criteria and their evidence
<!-- guidance: each acceptance criterion, and what proved it. \`craftpath
     validate --complete\` checks this is true; this section says it in prose
     so a human can disagree. -->

## What was not done
<!-- guidance: anything deferred, and why. An amendment that widened or
     narrowed the plan belongs here, with its changelog entry. -->

## Follow-ups
<!-- guidance: work this revealed but did not do. Each one is a candidate
     requirement, not a promise. -->
`;
