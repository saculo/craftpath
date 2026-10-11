# C-00002 — Pi step models: plan

## Goal

Pi users can configure model and effort per craftpath step using `[steps.<step>.pi]`, with delegated steps and work task subagents running on native pi subagents with the configured model and translated thinking level. Fresh configs document the requested work/review pi examples without activating them.

## Approach

Keep this as one task because all scenarios are one coherent behavior in the existing init/rendering path for module `app`: the harness renderer must apply pi step settings, work must pass its settings to task subagents, and the fresh config example must document the shape. Splitting would either duplicate the same integration-test setup or leave the documentation out of sync with behavior.

## Tasks

### Wave 1

- [ ] T-0001 — Apply pi step settings
