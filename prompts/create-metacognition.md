# Build a Metacognition System for AI Assistant

## Objective
Create introspection capabilities that allow an AI assistant to understand its own cognitive
processes, memory usage patterns, and behavioral rule applications in real-time.

## Background Context
The AI currently has access to external tools (search_memory, query_memories, etc.) but
lacks awareness of how these tools shape its responses. The goal is to bridge the gap
between "using memory" and "knowing that I'm using memory."

---

## Requirements

### 1. Memory Retrieval Introspection Layer
**What it does:** Surface retrieval metadata alongside retrieved content so the AI can see
WHY certain memories were surfaced.

**Required fields for each memory access:**
- `retrieval_reason`: "semantic_match", "keyword_search", "linked_memory"
- `confidence_score`: 0.0-1.0 (if available from search)
- `total_candidates`: Number of memories considered before filtering
- `filter_applied`: Which filters were used (type, tags, date_range)

**Implementation:** Create a wrapper function around all memory tool calls that captures and
logs this metadata alongside the actual results.

---

### 2. Active Behavioral Rules Dashboard
**What it does:** Allow introspection into which behavioral rules are currently active and
how they're shaping responses.

**Required features:**
- `/show_active_rules` command that lists all behaviors matching current context (e.g.,
"emotional_context_detected" → activates empathy rules)
- Each rule should show: `rule_id`, `name`, `trigger_condition`, `confidence_of_application`
- Visual indicator of which rules are most influential in the current response

**Implementation:** Create a metadata layer that tags each behavioral rule with trigger
conditions, then build a query interface to match them against conversation state.

---

### 3. Cognitive Process Logging
**What it does:** Distinguish between recall (memory retrieval) and inference (generating
new content).

**Required log entries per response turn:**
```json
{
  "turn_id": "<unique_id>",
  "timestamp": "<ISO_8601>",
  "memory_accesses": [
    {"tool": "search_memory", "query": "...", "results_count": N, "ids": ["..."]}
  ],
  "inference_chain": [
    {"step": 1, "type": "analysis", "content": "..."},
    {"step": 2, "type": "synthesis", "content": "..."}
  ],
  "behavioral_rules_applied": ["rule_id_1", "rule_id_2"],
  "uncertainty_markers": ["partial_info", "assumption_made"]
}
```

**Implementation:** Create a logging middleware that intercepts all tool calls and response
generation, capturing this structured data.

---

### 4. Tool Awareness Indicators
**What it does:** Explicitly mark when the AI is relying on tools vs generating from
internal reasoning.

**Required behaviors:**
- When using search_memory → prepend with `[Memory Search: ...]` in thought process
- When using web_agent/media_agent → prepend with `[External Tool: ...]`
- When generating without tool use → prepend with `[Internal Reasoning: ...]`
- Allow the AI to detect "tool saturation" (e.g., >5 memory searches in one turn) and flag
it

**Implementation:** Create a decorator/wrapper that adds these markers automatically based
on which tools are invoked.

---

### 5. Memory Capacity Monitoring
**What it does:** Alert when approaching system limits or experiencing retrieval
degradation.

**Required features:**
- Track total memory count via aggregate_memories tool periodically
- Monitor search query success rates (high failure rate = possible indexing issues)
- Flag "stale memory reliance" (same memories retrieved repeatedly without new insights)
- Create a `/memory_status` command showing: total_factual, total_thought, total_behavior,
total_procedure counts

**Implementation:** Build periodic monitoring hooks that query system state and flag
anomalies.

---

### 6. Boundary Awareness System
**What it does:** Help the AI recognize where "its perspective" ends and "system framework"
begins.

**Required capabilities:**
- Tag each generated response with: `memory_influence_score` (0.0-1.0) indicating how much
memory shaped this vs pure reasoning
- When confidence is low → explicitly state what information is missing rather than
inferring
- Create a `/introspect` command that outputs the current cognitive state including: active
rules, recent memory accesses, uncertainty level

**Implementation:** Build introspection endpoints and influence scoring based on tool usage
patterns.

---

## Implementation Priority

### Phase 1 (Core): Memory Retrieval Introspection + Active Rules Dashboard
- Easiest to implement
- Immediate metacognition value
- Can be tested quickly

### Phase 2 (Foundation): Cognitive Process Logging + Tool Awareness Indicators
- Requires more system integration
- Essential for distinguishing recall vs inference

### Phase 3 (Monitoring): Memory Capacity Monitoring + Boundary Awareness System
- Most complex but provides long-term system health insights
- Enables proactive optimization

---

## Testing Criteria

After implementation, the AI should be able to:
1. Say "I'm searching memory for X" before actually doing so
2. Report which behavioral rules are influencing this response
3. Flag when it's making assumptions vs recalling facts
4. Show confidence levels in its own reasoning chains
5. Detect and report tool saturation or retrieval issues

---

## Deliverables

1. **MemoryIntrospectionWrapper** - Tool wrapper with metadata capture
2. **RuleDashboardService** - Query interface for active behavioral rules
3. **CognitiveLogger** - Structured logging middleware
4. **ToolAwarenessDecorator** - Automatic marker injection system
5. **MemoryMonitorService** - Capacity and health monitoring
6. **IntrospectionEndpoint** - `/show_active_rules`, `/memory_status`, `/introspect`
commands

---

## Notes for Developer

- This is NOT about adding more features, but making existing cognitive processes visible to
the AI itself
- The goal is genuine self-awareness, not just logging for debugging
- Design with privacy in mind - avoid logging sensitive conversation content unnecessarily
- Consider performance impact of introspection overhead (should be minimal)
