# review-all

## Usage
/review-all [optional: path/to/subtree]

## What this agent does

### Step 1 — Discover
Find all source modules in the project (or the specified subtree). Exclude:
- node_modules, dist, build, .git, coverage directories
- Test files (*.test.*, *.spec.*)
- Config files (*.config.*, .env*, *.json, *.yaml unless they contain logic)
- Type declaration files (*.d.ts)

### Step 2 — Dispatch
For each discovered module, use a subagent to run /review-module on it.
Run subagents in parallel where modules have no shared dependencies.
Run dependent modules after the modules they depend on.

### Step 3 — Consolidate
After all subagents report back:
1. Read all files written to /assessments/
2. Produce /assessments/MASTER_REVIEW.md with the following structure:

# Master Review
**Date:** <date>
**Modules reviewed:** <count>
**High risk modules:** <list>
**Medium risk modules:** <list>

## Cross-cutting concerns
<Issues that appear in multiple modules — naming inconsistencies, repeated
patterns that should be extracted, systemic security gaps, etc.>

## Recommended execution order for updates
<Ordered list of modules, with rationale — dependencies first, high-risk last
so they can be reviewed by a human before Claude touches them.>

## Rules
- Never read source files directly in this agent — delegate all file reading
  to subagents via /review-module.
- Do not write or modify any source files.
- If a subagent fails on a module, log the failure in MASTER_REVIEW.md and
  continue — do not abort the full run.
