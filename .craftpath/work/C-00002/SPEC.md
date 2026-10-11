# C-00002 — Pi step models

## Problem

craftpath already lets Claude Code users choose a model and effort per step, but pi users cannot: every pi step and task subagent currently runs on the session's model. This prevents a user from using one model for implementation work, such as `openai-codex/gpt-5.6-terra`, and another for review, such as `anthropic/claude-opus-5-5`, while staying inside pi's native subagent system.

## Scenarios

### S1 — Configured pi step subagent uses its model and effort

- **Given** `.craftpath/config.toml` contains `[steps.review.pi]` with `model = "anthropic/claude-opus-5-5"` and `effort = "high"`
- **When** `craftpath init --harness pi` installs the pi review step and the user runs `/skill:craftpath-review C-00002`
- **Then** the installed review skill tells pi to start its native `Agent` subagent with model `anthropic/claude-opus-5-5` and the pi thinking level translated from `effort = "high"`
- **Then** the step does not rely on the session's model for that review subagent
- **Then** this is proven by integration test `a configured pi step runs its subagent with model and thinking level`

### S2 — Anthropic pi settings stay native to pi

- **Given** `.craftpath/config.toml` contains `[steps.review.pi]` with `model = "anthropic/claude-opus-5-5"`
- **When** `craftpath init --harness pi` installs the pi review step
- **Then** the installed review skill starts review through pi's native `Agent` tool
- **Then** it does not mention or invoke `claude -p`, `claude`, or any other shell CLI to run the Anthropic model
- **Then** this is proven by integration test `an Anthropic pi model is invoked through the Agent tool only`

### S3 — Work pi setting applies to task subagents

- **Given** `.craftpath/config.toml` contains `[steps.work.pi]` with `model = "openai-codex/gpt-5.6-terra"` and `effort = "medium"`
- **When** `craftpath init --harness pi` installs the pi work step and the user runs `/skill:craftpath-work C-00002 all`
- **Then** the work step itself still runs in the current pi session as today
- **Then** each task subagent instruction in the installed work skill starts a native pi `Agent` task subagent with model `openai-codex/gpt-5.6-terra` and the pi thinking level translated from `effort = "medium"`
- **Then** this is proven by integration test `pi work starts task subagents with work model and thinking level`

### S4 — Unconfigured pi steps are unchanged

- **Given** `.craftpath/config.toml` has no `[steps.<step>.pi]` table for a pi step
- **When** `craftpath init --harness pi` installs that step
- **Then** the installed skill is the same as today for model and effort: no model or thinking-level override is added
- **Then** this is proven by integration test `a pi step without settings installs as before`

### S5 — Fresh config documents pi examples without applying them

- **Given** a project has no `.craftpath/config.toml`
- **When** `craftpath init` writes a fresh config
- **Then** the config contains commented-out examples for `[steps.work.pi]` with `model = "openai-codex/gpt-5.6-terra"` and for `[steps.review.pi]` with `model = "anthropic/claude-opus-5-5"`
- **Then** the examples include the same `effort` key used by Claude Code step settings
- **Then** TOML parsing of the fresh config does not create active `steps.work.pi` or `steps.review.pi` settings from those examples
- **Then** this is proven by integration test `a fresh config shows commented pi model examples`

## Out of scope

- Running Claude through Claude Code or `claude -p` from pi.
- Supporting other external model CLIs.
- Changing Claude Code step-model behavior, except where shared wording in the fresh config must remain coherent.
- Replacing pi's native `Agent`/`pi-subagents-lite` subagent mechanism.

## Open questions

None
