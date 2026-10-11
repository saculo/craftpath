# C-00002 — Pi step models: knowledge

## Candidates

- [ ] K1 [ADR] Pi configured subagents use pi’s native Agent tool
  - **Context:** Pi step settings must select a different model for delegated steps and work task subagents without leaving pi’s native subagent system; invoking provider CLIs would add an external dependency and bypass pi’s model handling.
  - **Decision:** Render configured model and translated thinking-level settings in the native pi `Agent` subagent instruction. Do not invoke `claude`, `claude -p`, or another provider CLI from pi skills.
  - **Consequences:** Pi settings apply only where an `Agent` subagent is started; the pi work step itself continues on the session model, and provider CLI fallbacks are unsupported.
  - **Source:** SPEC S1–S3; T-0001 Notes

- [ ] K2 [CLAUDE.md] When testing that generated assets remain unchanged, compare the output with a pre-change fixture or baseline rather than a second render from the current implementation.
  - **Source:** REVIEW R1
