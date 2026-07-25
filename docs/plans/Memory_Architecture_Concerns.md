# Memory System Architecture Concerns

> **Provenance:** written 2026-03-30, recovered from an uncommitted `git stash`
> on 2026-07-25 and committed unchanged apart from this header. The analysis
> below was re-verified against `main` at the time of recovery — see
> "Verification status" at the end for what still holds and what has since
> changed. Code references have been updated from the pre-monorepo `src/…`
> layout to `packages/…`.

## Executive Summary

The agent operates across three parallel memory systems that are not integrated, causing loss of meta-cognitive information
during conversation summarization.

---

## 1. Thought Memories Are Not Auto-Retrieved

**Problem:** Only factual and procedure memories are automatically retrieved via `CortexMemoryPlugin.getContext()`. Internal
reasoning stored as "thought" type memories is never shown to the agent unless explicitly searched.

**Evidence in code (`packages/framework/src/plugins/CortexMemoryPlugin.ts`):**
```typescript
const [factualResults, procedureResults] = [
  this.db.searchWithEmbedding(embedding, 3, 0.5, ["factual"]),
  this.db.searchWithEmbedding(embedding, 1, 0.65, ["procedure"]),
];
// "thought" and "behavior" types are NOT retrieved!
```

**Impact:** The agent cannot see its own reasoning chains from previous turns during new turns unless manually calling
`get_recent_thoughts()` or `search_memory`. This creates a disconnect between actual thinking process and what's available for
decision-making.

---

## 2. Metacognition Tracks But Doesn't Drive Decisions

**Problem:** The metacognitive layer monitors cognitive patterns (hedging, saturation, redundancy) but only reports them after
they occur. It doesn't actively influence retrieval or tool-use decisions.

**Evidence in code (`packages/framework/src/plugins/MetacognitionPlugin.ts`):**
- `efficiency_report()` analyzes tool-use patterns and flags inefficiencies
- Uncertainty markers (`I'm not sure`, hedging detection) are tracked
- But no feedback loop exists to say "you've been hedging a lot, search memory for facts" or "redundant calls detected, retrieve
cached information instead"

**Impact:** The agent continues inefficient patterns without automatic correction. Detection happens post-hoc rather than
preventing the pattern proactively.

---

## 3. Conversation History Summarization Collapses Meta-Cognition

**Problem:** When MemoryPlugin exceeds 15 messages, it summarizes old context into 2-3 sentences that lose all meta-cognitive
information about why decisions were made.

**Evidence in code (`packages/framework/src/plugins/MemoryPlugin.ts`):**
```typescript
const summaryPrompt = `Summarize the key points of this conversation so far in 2-3 sentences...`
// This collapses actual thinking into surface-level content
```

**What gets lost:**
- Which behavioral rules were active at each step
- Why certain tool decisions were made (the reasoning behind them)
- The evolution of reasoning across turns
- Tool-use patterns and their rationale

---

## 4. Three Parallel Systems That Don't Integrate

| System | Purpose | What Gets Preserved | What's Lost |
|--------|---------|---------------------|-------------|
| MemoryPlugin | Conversation history | Linear transcript (what happened) | Why decisions were made, tool-use rationale |
| CortexMemoryPlugin | Long-term memory | Factual/procedure memories only | Internal reasoning, behavioral rule context |
| ThoughtPlugin | Internal reasoning | Stored as "thought" type | Never auto-retrieved, must be manually accessed |

**Impact:** The agent's actual thinking happens across all three layers, but they're not integrated. A "I searched memory"
tool-use decision is lost in summarization because it's only visible in the `<think>` block, not in either MemoryPlugin or
CortexMemoryPlugin storage.

---

## 5. Fragmented System Prompt Injection Without Coordination

**Problem:** Each plugin injects its own context without coordination, creating a fragmented system prompt where information
sources don't complement each other.

**System prompt structure (observed):**
```
{config.systemPrompt}

You have received a direct message. You MUST provide a response.

Plugin Context:
CortexMemory: Relevant memories:\n[3ce07cf8] Conversation flow...

[Metacognition]\nTurn: 484915d9\nMemory accesses this turn: 0...

## Internal Thoughts\nYour <think>
```

*(The original document ends here, mid-section — section 5 was never finished.)*

---

## Verification status (checked against `main`, 2026-07-25)

Still accurate:

- **§1 holds.** `CortexMemoryPlugin.getContext()` retrieves only `factual` and
  `procedure` (`CortexMemoryPlugin.ts:306-307`). `thought` memories are still
  never auto-retrieved.
- **§2 holds.** `efficiency_report` is still report-only
  (`MetacognitionPlugin.ts:317`), with no feedback loop into retrieval.
- **§3 holds.** `MemoryPlugin` still defaults to `maxMessages = 15`
  (`MemoryPlugin.ts:50`) and summarizes with the same prompt shape.
- **§4 holds.** `ThoughtPlugin` still exposes `get_recent_thoughts` and is
  auto-registered by `CortexAgent`; retrieval remains manual.

One correction:

- **§1's aside that "behavior types are NOT retrieved" is now outdated.**
  `behavior` memories *are* retrieved, via a separate path
  (`CortexMemoryPlugin.ts:108`). The point about `thought` memories is
  unaffected.
