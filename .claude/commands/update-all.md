# update-all

## Usage
/update-all

Requires /assessments/MASTER_REVIEW.md to exist (produced by /review-all).

## What this agent does

### Step 1 — Load execution order
Read /assessments/MASTER_REVIEW.md and extract the recommended execution order.
If no order is present, derive one: modules with no imports of other local
modules first, dependents last.

### Step 2 — Produce implementation plan
Write IMPLEMENTATION_PLAN.md at the project root:
- Ordered list of modules with a one-line summary of changes per module
- Cross-cutting concerns from MASTER_REVIEW.md that need attention after
  individual modules are done
- Any modules flagged High risk — note these for human review

Do NOT proceed to Step 3 until this file is written.

### Step 3 — Execute
For each module in order:
1. Dispatch a subagent to run /update-module on it
2. Wait for the subagent to report back before dispatching the next
   (sequential, not parallel — changes may affect dependents)
3. Record the result in IMPLEMENTATION_PLAN.md — mark complete or failed

### Step 4 — Cross-module consistency check
After all modules are updated:
1. Check that naming conventions are uniform across changed files
2. Check that error handling patterns are consistent
3. Check that no import is broken across module boundaries
4. Run the full project test suite if one exists

### Step 5 — Write CHANGES_SUMMARY.md
Produce CHANGES_SUMMARY.md at the project root:

# Changes Summary
**Date:** <date>
**Modules updated:** <count>
**Modules skipped / failed:** <list with reasons>

## Per-module changelog
<module>: <what changed, what was skipped, validation result>

## Cross-module consistency findings
<What was found and fixed in Step 4>

## Remaining concerns
<Anything from assessments that was not addressed and why>

## Rules
- Never skip IMPLEMENTATION_PLAN.md — it is the audit trail.
- If any module's /update-module run fails entirely, log it and continue.
- Do not modify source files directly in this agent — all edits go through
  /update-module subagents.
- High risk modules from MASTER_REVIEW.md should be flagged in
  IMPLEMENTATION_PLAN.md with a comment that a human should review the diff
  before merging.
