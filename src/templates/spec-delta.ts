export const SPEC_DELTA_TEMPLATE = `<!-- guidance: how this work item changes the living specs in
     .craftpath/specs/. Nothing applies this for you: write the change into the
     spec files yourself, in this same PR. \`craftpath archive\` refuses until
     they agree — an ADDED or MODIFIED id must appear in .craftpath/specs/, and
     a REMOVED id must not. Reference requirements by their stable IDs. -->

## ADDED
- <PREFIX>-Rn — <name>

## MODIFIED
- <PREFIX>-Rn — <what changed>

## REMOVED
- (none)
`;
