# C-00003 — Steps decide instead of asking: review

- **Reviewed at:** 2101543fb7a04a0f2c010da3759e3242ae6d28db

## Points

- [x] R1 [major] assets/skills/never-block-on-the-human/SKILL.md:3 -- the `description:` value is an unquoted YAML scalar containing `: ` ("something undecided: a question about how"), so the front matter is not valid YAML (Bun's `YAML.parse` rejects it; every other skill under `assets/skills/` parses). A harness that parses skill front matter as YAML can fail to load the principle or lose its description, which is the S1/S2 promise; the A1/A3 tests read `name:`/`description:` with a line regex, so they pass on a file no YAML parser accepts. (solved in 2101543)
