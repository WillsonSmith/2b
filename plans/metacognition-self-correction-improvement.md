# MetacognitionPlugin Self-Correction System: Improvement Plan

## Executive Summary

The `MetacognitionPlugin` (`src/plugins/MetacognitionPlugin.ts`) implements a four-stage self-correction lifecycle: detection, saving, evaluation, and cleanup. The system has two critical bugs that together create a permanent deadlock state: ineffective corrections are never pruned from the database, and the DB dedup check in `saveCorrectiveRule` uses those orphaned records to block any future correction for the same trigger. Once a single correction fails, the agent can never retry it. Three additional design-level issues further degrade long-term reliability.

This plan addresses all problem categories in five sequenced phases, ordered from highest to lowest severity. Phases 1 and 2 are blocking correctness fixes. Phases 3–5 are quality and robustness improvements.

---

## Correction Lifecycle (as-is)

1. **Detection** (`maybeAutoCorrect`, L592) — called after every assistant response; scans a 5-turn window for 3+ occurrences of saturation/redundancy/hedged_no_search patterns
2. **Saving** (`saveCorrectiveRule`, L642) — creates a `behavior` memory in the DB with tags `["metacognition-correction", trigger]`; adds a `CorrectionRecord` to in-memory `correctionHistory`
3. **Evaluation** (`checkCorrectionEffectiveness`, L710) — called at the start of every `maybeAutoCorrect`; checks `pending` corrections for recurrence or resolution
4. **Cleanup** (`maybePruneCorrection`, L751) — deletes the behavior memory from DB — but is only ever called for effective+stale corrections

---

## Bugs and Issues

| ID | Severity | Location | Description |
|----|----------|----------|-------------|
| Bug 1 | **Critical** | L714-715, L751 | Ineffective corrections are never pruned from DB; `maybePruneCorrection` is never called for them |
| Bug 2 | **Critical** | L654-661 | DB dedup check permanently blocks new corrections for any trigger that previously failed |
| Bug 3 | Minor | L751-758 | Pruned corrections remain in `correctionHistory` with dangling `behavior_memory_id` references |
| Issue 4 | Design | L737-748, L724-726 | No retry path after CRITICAL strengthening; escalation is a dead end |
| Issue 5 | Design | L710-734 | No cross-session correction tracking; `correctionHistory` is lost on restart |
| Issue 6 | Design | L694-701, L611-618 | Redundancy detection is args-blind; distinct queries using the same tool are false positives |
| Issue 7 | Design | L712, L729-731 | `STALE_MS` 30-day threshold is unreachable — `correctionHistory` resets on restart before 30 days passes |
| Issue 8 | Minor | L737-748 | `strengthenCorrectiveRule` has no ceiling; CRITICAL prefix would stack on repeated calls |

---

## Phase 1: Fix the Two Critical Bugs (Bugs 1, 2, 4)

**Goal:** Ineffective corrections must eventually be pruned. Pruning must unlock retry. The escalation path must have a defined terminus.

### 1a. Extend `CorrectionRecord` interface (L51-59)

Add two fields to track the post-strengthen observation window:

```typescript
interface CorrectionRecord {
  id: string;
  trigger: "saturation" | "redundancy" | "hedged_no_search";
  rule_saved: string;
  behavior_memory_id: string;
  applied_at: Date;
  turns_observed: number;
  effectiveness: "pending" | "effective" | "ineffective" | "effective_after_strengthen" | "failed";
  strengthened_at?: Date;       // NEW — set when strengthenCorrectiveRule runs
  post_strengthen_count: number; // NEW — default 0
}
```

`"effective_after_strengthen"` = the CRITICAL rule worked. `"failed"` = terminal state, triggers full cleanup.

### 1b. Add a second evaluation pass in `checkCorrectionEffectiveness` (after L715)

After the existing pending-only loop, add a loop for `"ineffective"` corrections:

```
for each correction where effectiveness === "ineffective":
    if strengthened_at is undefined: skip

    turnsSinceStrengthen = turnHistory.filter(t => t.ended_at > correction.strengthened_at)
    if turnsSinceStrengthen.length === 0: skip

    if NOT patternRecurredIn(trigger, turnsSinceStrengthen) AND turns >= EFFECTIVE_TURNS:
        // CRITICAL rule worked
        correction.effectiveness = "effective_after_strengthen"
        await maybePruneCorrection(correction)

    else if patternRecurredIn(trigger, turnsSinceStrengthen) AND post_strengthen_count >= 1:
        // Truly stuck — full cleanup to unlock retry
        correction.effectiveness = "failed"
        await memoryPlugin.db.deleteMemory(correction.behavior_memory_id)
        correctionHistory = correctionHistory.filter(c => c.id !== correction.id)
```

The `post_strengthen_count >= 1` guard gives one full observation window after CRITICAL strengthening before declaring failure.

### 1c. Update `strengthenCorrectiveRule` (L737-748)

Set the new fields when strengthening runs:

```typescript
correction.strengthened_at = new Date();
correction.post_strengthen_count += 1;
```

### 1d. Fix the DB dedup check in `saveCorrectiveRule` (L654-661)

Replace the unconditional early return with an active-correction-aware check:

```typescript
const existing = memoryPlugin.db.queryMemories({
    types: ["behavior"],
    tags: ["metacognition-correction"],
    contains: trigger,
    limit: 1,
});
if (existing.length > 0) {
    // Only block if the existing record corresponds to an active (non-failed) correction
    const isActive = correctionHistory.some(
        c => c.behavior_memory_id === existing[0].id && c.effectiveness !== "failed"
    );
    if (isActive) return;
    // Otherwise fall through — stale/orphaned DB record, allow save
}
```

Once a `"failed"` correction is removed from `correctionHistory` (step 1b), this check no longer blocks retry.

**Risks:**
- The `post_strengthen_count >= 1` guard means a correction that recurs immediately after CRITICAL strengthening will wait for `post_strengthen_count` to reach 1 before cleanup. This is intentional but means one extra turn of a failing CRITICAL rule. Acceptable.
- After cleanup, `saveCorrectiveRule` can retry indefinitely. Add a future `failedAt` timestamp + minimum backoff (5 turns) if tight retry loops become a problem in practice.

---

## Phase 2: Cleanup and Stale Threshold (Bug 3, Issue 7)

**Goal:** `correctionHistory` stays clean after pruning. Effective corrections are pruned in practice, not theoretically.

### 2a. Remove pruned records from `correctionHistory` in `maybePruneCorrection` (L751-758)

```typescript
private async maybePruneCorrection(correction: CorrectionRecord): Promise<void> {
    try {
        await this.memoryPlugin.executeTool!("delete_memory", {
            id: correction.behavior_memory_id,
        });
        // NEW: also remove from in-memory history
        this.correctionHistory = this.correctionHistory.filter(c => c.id !== correction.id);
    } catch {
        // non-critical
    }
}
```

Note: the `"failed"` path in Phase 1 already does inline cleanup. `maybePruneCorrection` handles the `"effective"` and `"effective_after_strengthen"` paths.

### 2b. Replace `STALE_MS` with turn-count-based staleness (L712, L729-731)

Remove `STALE_MS`. Add a constant:

```typescript
const STALE_TURNS = EFFECTIVE_TURNS * 3; // 30 turns
```

In `checkCorrectionEffectiveness`, replace the time-based stale check for effective corrections:

```typescript
// Before (unreachable):
const ageMs = Date.now() - correction.applied_at.getTime();
if (ageMs > STALE_MS) await this.maybePruneCorrection(correction);

// After (session-local, achievable):
const turnsSinceEffective = this.turnHistory.filter(
    t => (t.ended_at ?? t.started_at) > correction.applied_at
).length;
if (turnsSinceEffective >= STALE_TURNS) await this.maybePruneCorrection(correction);
```

**Risks:**
- `STALE_TURNS = 30` is conservative. If sessions are short, effective corrections may outlive the session and accumulate across restarts. Phase 4 addresses this definitively.
- Confirm via grep that `STALE_MS` is only used in `checkCorrectionEffectiveness` before removing.

---

## Phase 3: Args-Aware Redundancy Detection (Issue 6)

**Goal:** Distinct queries using the same tool are not flagged as redundancy. Only same-tool, same-args calls trigger correction.

### 3a. Update `patternRecurredIn` for `"redundancy"` (L694-701)

```typescript
if (trigger === "redundancy") {
    const seen = new Set<string>();
    for (const tc of t.tool_calls) {
        const key = `${tc.tool}:${tc.args_summary.slice(0, 50)}`;
        if (seen.has(key)) return true;
        seen.add(key);
    }
    return false;
}
```

### 3b. Apply the same args-aware key in `maybeAutoCorrect` `redundancyCount` computation (L611-618)

The `window.filter(...)` lambda that counts redundant turns must use the identical `tool:args_summary.slice(0,50)` key so detection and threshold counting stay in sync.

### 3c. Optional: add `trigger_detail?: string` to `CorrectionRecord`

Capture the specific `tool:args_summary` key that caused the trigger. No behavioral effect, but improves `show_corrections` and `efficiency_report` diagnostics.

**Risks:**
- The 50-character prefix is a heuristic. A long query with meaningful differences after character 50 would be missed. Hashing the full `args_summary` is more robust but adds complexity — 50 chars covers the common cases.
- This change reduces the frequency of redundancy corrections being triggered (fewer false positives). This is the intended outcome and should not be treated as a regression.

---

## Phase 4: Cross-Session Correction Tracking (Issue 5)

**Goal:** On restart, the agent resumes awareness of existing corrections. Expired ineffective corrections from prior sessions are cleaned up rather than silently bypassed.

### 4a. Reconstruct `correctionHistory` stubs in `onInit` (L97-130)

After the existing `onInit` body:

```typescript
const CROSS_SESSION_STALE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const existingCorrections = this.memoryPlugin.db.queryMemories({
    types: ["behavior"],
    tags: ["metacognition-correction"],
    limit: CORRECTION_HISTORY_LIMIT,
});

for (const mem of existingCorrections) {
    const trigger = mem.tags.find(t => t !== "metacognition-correction" && !t.startsWith("metacognition-correction:"));
    if (!trigger) continue;

    const isIneffective = mem.tags.includes("metacognition-correction:ineffective");
    const age = Date.now() - new Date(mem.timestamp).getTime();

    // Prune stale ineffective corrections on startup
    if (isIneffective && age > CROSS_SESSION_STALE_MS) {
        await this.memoryPlugin.db.deleteMemory(mem.id);
        continue;
    }

    this.correctionHistory.push({
        id: randomUUID(),
        trigger: trigger as CorrectionRecord["trigger"],
        rule_saved: mem.text,
        behavior_memory_id: mem.id,
        applied_at: new Date(mem.timestamp),
        turns_observed: 0,
        effectiveness: isIneffective ? "ineffective" : "pending",
        post_strengthen_count: isIneffective ? 1 : 0,
    });
}
```

### 4b. Persist ineffective status as a DB tag in `strengthenCorrectiveRule` (L737-748)

Replace the `edit_memory` approach with delete-and-recreate to also attach the status tag:

```typescript
// Delete old record
await this.memoryPlugin.db.deleteMemory(correction.behavior_memory_id);
// Re-add with CRITICAL prefix and ineffective tag
const newId = await this.memoryPlugin.db.addMemory(
    strengthened,
    "behavior",
    ["metacognition-correction", correction.trigger, "metacognition-correction:ineffective"]
);
correction.behavior_memory_id = newId; // update the reference
correction.rule_saved = strengthened;
```

**Risks:**
- Delete-and-recreate incurs an embedding call, same cost as the existing `edit_memory`. No regression.
- If `addMemory` fails after `deleteMemory` succeeds, the correction record holds a stale `behavior_memory_id`. The `behavior_memory_id` update must be guarded — if `addMemory` throws, mark the correction as `"failed"` and remove it rather than leaving it with a dangling ID.
- Reconstructed stubs have `turns_observed = 0`. Cross-session turn counting is intentionally not attempted — the agent can only observe turns from the current session.

---

## Phase 5: CRITICAL Prefix Ceiling (Issue 8)

**Goal:** `strengthenCorrectiveRule` is idempotent. CRITICAL prefix cannot stack.

### 5a. Guard in `strengthenCorrectiveRule` (L737-748)

```typescript
if (correction.rule_saved.startsWith("CRITICAL")) {
    // Already at ceiling — do not re-prefix
    return;
}
```

### 5b. Only call `strengthenCorrectiveRule` on the first failure

In `checkCorrectionEffectiveness`, when transitioning to `"ineffective"`:

```typescript
if (correction.post_strengthen_count === 0) {
    await this.strengthenCorrectiveRule(correction);
} else {
    // Already strengthened and still failing — Phase 1's second loop handles terminal cleanup
}
```

The guard in 5a becomes a safety net rather than primary logic.

**Risks:**
- The `startsWith("CRITICAL")` check is string-matching. If rule text legitimately starts with "CRITICAL" for other reasons, this would suppress strengthening. Unlikely given the trigger types, but note for future rule text changes.

---

## What Not to Change

These components are working correctly and should not be modified:

- The three trigger types: `saturation`, `redundancy`, `hedged_no_search`
- `PATTERN_WINDOW = 5` and `PATTERN_THRESHOLD = 3` constants (L48-49)
- `CORRECTION_HISTORY_LIMIT = 50` cap (L47)
- `EFFECTIVE_TURNS = 10` inside `checkCorrectionEffectiveness` (L711)
- The `blockedTools` set and `onBeforeToolCall` gate (L73, L295-310)
- The `getContext()` DIRECTIVE/HARD STOP injection (L143-183)

---

## Implementation Sequence

Phases are ordered by dependency:

1. **Phase 1** first — introduces `strengthened_at`, `post_strengthen_count`, `"failed"` state, the second evaluation loop, and the corrected DB dedup check. Everything else depends on this.
2. **Phase 2** — plugs into `maybePruneCorrection` and removes the unreachable stale constant. Safe to do alongside Phase 1.
3. **Phase 3** — independent of Phases 1–2, but merge after Phase 1 is stable to keep diffs reviewable.
4. **Phase 4** — depends on Phase 1's new fields and `"failed"` state for correct `onInit` reconstruction. Implement only after Phase 1 is fully tested.
5. **Phase 5** — safety net, can be applied alongside Phase 1 with minimal risk.

---

## Key Files

| File | Relevance |
|------|-----------|
| `src/plugins/MetacognitionPlugin.ts` | Primary — all five phases change this file |
| `src/plugins/CortexMemoryDatabase.ts` | Phase 4's delete-and-recreate in `strengthenCorrectiveRule` must conform to its `addMemory`/`deleteMemory` API |
| `src/plugins/CortexMemoryPlugin.ts` | Exposes `executeTool("edit_memory")` / `executeTool("delete_memory")` used by correction methods; Phase 4 replaces the `edit_memory` call |
| `src/core/Plugin.ts` | Phase 4's `onInit` additions must match the `AgentPlugin` interface signature |
