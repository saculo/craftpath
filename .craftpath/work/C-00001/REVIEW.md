# C-00001 — Model and effort per step: review

- **Reviewed at:** 0f47b33e9beefa848f50c601a59e32b5b3460523

## Points

- [x] R1 [minor] README.md:121 -- `model` is documented as one setting for every step, but for `/craftpath-work` it is passed to the `Agent` tool, whose `model` accepts only aliases (`sonnet`, `opus`, `haiku`, ...), while front matter on the other steps also accepts a full model id (T-0001's notes: "an alias or a full model id"); a user who writes a full id for work gets a work step whose subagent call is rejected or silently runs on the session model, and neither the README nor the commented example in src/init.ts:165 says so (solved in 0f47b33)
