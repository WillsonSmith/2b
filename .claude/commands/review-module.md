# review-module

## Usage
/review-module <path/to/module>

## What this skill does
1. Reads the target module file in full
2. Reads CLAUDE.md for project conventions
3. Analyzes the module across five categories:
   - Bug fixes (logic errors, unhandled edge cases, incorrect assumptions)
   - Refactoring / code quality (clarity, structure, dead code, complexity)
   - Security (input validation, secrets, injection risks, unsafe operations)
   - Performance (unnecessary computation, inefficient data structures, N+1 patterns)
   - Consistency / style alignment (naming, error handling patterns, formatting)
4. Writes an assessment file to /assessments/<module-name>.md using the
   template below
5. Reports a one-line summary to the main session when done

## Assessment file template

# Assessment: <module-name>
**File:** <relative path>
**Reviewed:** <date>
**Risk level:** Low | Medium | High

## Bug Fixes
- [ ] <issue>: <description and suggested fix>

## Refactoring / Code Quality
- [ ] <issue>: <description and suggested fix>

## Security
- [ ] <issue>: <description and suggested fix>

## Performance
- [ ] <issue>: <description and suggested fix>

## Consistency / Style Alignment
- [ ] <issue>: <description and suggested fix>

## Notes
<Anything that doesn't fit the above categories, cross-module concerns, or
dependencies that reviewers of other modules should know about.>

## Rules
- Be specific. Every item must name the exact line, function, or pattern.
- Do not suggest changes outside the module's current scope.
- If a category has no issues, write "No issues found." — never omit a section.
- Risk level is High if any security or data-loss bug is found, Medium if
  refactoring is significant, Low otherwise.
