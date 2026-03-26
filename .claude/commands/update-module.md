# update-module

## Usage
/update-module <path/to/module>

Expects a corresponding assessment to exist at
/assessments/<module-name>.md before being called.

## What this skill does

### Step 1 — Read
1. Read /assessments/<module-name>.md in full
2. Read the current source file in full
3. Check CLAUDE.md for any project-specific rules that affect this module

### Step 2 — Apply
Work through each unchecked item [ ] in the assessment in this order:
1. Bug fixes (highest priority)
2. Security
3. Performance
4. Refactoring / code quality
5. Consistency / style alignment

For each item:
- Apply the smallest safe change that resolves the issue
- If a change is ambiguous or risky, apply the conservative interpretation
  and mark it in the commit body
- Mark the checkbox [x] in the assessment file as you complete each item

### Step 3 — Validate
Run in order, stopping if any step fails:
1. Linter (use project's configured linter from CLAUDE.md)
2. Type checker (if applicable)
3. Test suite scoped to this module (if tests exist)

If validation fails:
- Attempt to fix the failure
- If the fix is not obvious, revert the specific change that caused it,
  mark it as skipped in the assessment, and continue with remaining items

### Step 4 — Commit
Commit with:
  Message: `refactor(<module-name>): apply assessment updates`
  Body: list of categories addressed and any items skipped with reasons

### Step 5 — Report
Return a one-line summary to the calling session:
  "<module-name>: <N> items applied, <M> skipped — <validation status>"

## Rules
- Never modify files outside the target module and its assessment file.
- Never add a new dependency without flagging it as a skip in the assessment
  and noting it in the commit body.
- Do not refactor beyond what the assessment specifies.
