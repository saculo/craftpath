# C-00014 — Module check command gates: plan

## Goal

A configured module check runs after its module test and gates task completion
and review. Fresh JavaScript configuration discovers an available check command
while existing configuration remains untouched.

## Approach

First add the optional check to the shared module command runner and prove its
completion boundary, including no-check compatibility. Review then uses that
proven runner before it can write or commit review material. Finally, add
fresh-configuration JavaScript detection and preserve the write-once
configuration boundary. All tasks touch the configured root `app` module, so
they are serial waves; detection has no behavioural dependency on the first two
but cannot run concurrently with either under the module-ownership rule. Assets
are authoritative for installed scripts; each affected task regenerates the
installed copies with `bun bin/craftpath.ts init`.

## Tasks


### Wave 1

- [x] T-0001 — Verify task module check gates

### Wave 2

- [ ] T-0002 — Verify review module check gates

### Wave 3

- [ ] T-0003 — Verify JavaScript module check detection
