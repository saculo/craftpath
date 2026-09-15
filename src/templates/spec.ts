export const SPEC_TEMPLATE = `# <capability>

<!-- guidance: present tense, as a fact about the system as it exists — never as
     a change. That is what lets this file survive.

     Do NOT write a spec for anything derivable from code or tests. No API
     tables, no ERDs, no endpoint lists. Specs carry only behaviour that is
     expensive to rediscover: cross-cutting rules, invariants, deliberate
     exclusions. -->

## Purpose
<!-- guidance: 2-3 lines. -->

## <PREFIX>-R1 — <name>

<statement of behaviour, present tense>

Scenario: <name>
  Given <precondition>
  When <action>
  Then <observable outcome>

## Invariants
<!-- guidance: things that must hold across all requirements here. -->

## Out of scope
`;
