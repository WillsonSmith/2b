# Test Plan

> **Instructions for Claude Code:** Read this file, find the first item with status `[ ]`, write tests for it, verify they pass with `bun test`, then update its checkbox to `[x]` and add a `Tests:` line with the test file path. Repeat until all items are checked. If a session ends mid-way, the next session should read this file and continue from the first unchecked item.

## Progress
- Total: 14
- Complete: 14

## Files

### src/agents/util.ts
- [x] Status: complete
- Purpose: Removes `<think>...</think>` reasoning blocks from LLM responses (strict and flexible modes)
- Key things to test:
  - Strict mode requires both opening and closing tags; leaves content untouched if either is missing
  - Flexible mode strips content from string start up to first `</think>` (handles streamed/chunked responses)
  - Multiple block removal
  - Nested or malformed tags
  - Trailing whitespace trimming after removal
  - Empty string input and result
- Tests: src/agents/util.test.ts

---

### src/core/PermissionManager.ts
- [x] Status: complete
- Purpose: Permission system with session-based approval caching and interactive prompts for tool calls
- Key things to test:
  - `SessionCache`: has/add operations and per-key isolation
  - `AutoDenyPermissionManager`: always rejects with warning
  - `AutoApprovePermissionManager`: always approves
  - `ScriptedPermissionManager`: returns scripted responses, defaults to deny
  - Shared cache behavior across manager instances
  - Arg truncation at MAX_ARG_VALUE_LENGTH (200 chars)
  - User session-approval override for per_call tools
- Tests: src/core/PermissionManager.test.ts

---

### src/core/HeadlessAgent.ts
- [x] Status: complete
- Purpose: Stateless single-call agent for sub-agents; assembles system prompt, dispatches tools, runs one LLM round-trip per `ask()` call
- Key things to test:
  - Each `ask()` is independent (no shared conversation state between calls)
  - System prompt assembled from plugin fragments and dynamic context
  - Tool implementations are wrapped with permission checks before dispatch
  - Plugin lifecycle: `onInit` called, but NOT `onMessage`, `getMessages`, or `augmentResponse`
  - Tool call handler invokes `onToolCallStart` / `onToolCallEnd` events
  - Missing plugin context returns gracefully (no crash)
- Tests: src/core/HeadlessAgent.test.ts

---

### src/core/BaseAgent.ts
- [x] Status: complete
- Purpose: Central orchestrator managing agent lifecycle, input queues, plugin registration, system prompt assembly, tool dispatch, and the LLM conversation loop
- Key things to test:
  - Direct vs. ambient input queues are processed separately and in correct order
  - Plugin initialization errors are isolated (one bad plugin doesn't kill the agent)
  - System prompt is assembled by concatenating all plugin fragments
  - Tool collection wraps implementations with permission checks
  - Tick scheduling fires at the configured interval
  - Queue items are re-queued on processing error
  - Token streaming callback is invoked per fragment
  - Ambient inputs containing `[IGNORE]` are discarded
  - Plugin `onError` handlers are called and do not propagate exceptions
- Tests: src/core/BaseAgent.test.ts

---

### src/core/CortexAgent.ts
- [x] Status: complete
- Purpose: Thin wrapper around BaseAgent that auto-registers `CortexMemoryPlugin` and `ThoughtPlugin`, with cortex-specific naming defaults
- Key things to test:
  - `CortexMemoryPlugin` and `ThoughtPlugin` are always registered even with no extra plugins
  - Additional plugins passed to constructor are also registered
  - `cortexName` option is preferred; falls back to `name`; then to `"cortex"`
  - Events forwarded to the inner BaseAgent behave identically to direct BaseAgent calls
- Tests: src/core/CortexAgent.test.ts

---

### src/plugins/MemoryPlugin.ts
- [x] Status: complete
- Purpose: Short-term conversation history with LLM-based auto-summarization when message count exceeds MAX_MESSAGES (default 15)
- Key things to test:
  - Messages are stored and returned in insertion order
  - System messages are isolated and always prepended separately
  - Auto-summarization triggers exactly at MAX_MESSAGES threshold
  - After summarization, summary is prepended with attribution markers to the first retained message
  - History is sliced to `historyLimit` after summarization
  - Leading assistant messages are removed (first message in history must be from a user)
  - Edge cases: empty list, only assistant messages, single message
  - Summarization failure falls back gracefully without crashing
- Tests: src/plugins/MemoryPlugin.test.ts

---

### src/plugins/CortexMemoryDatabase.ts
- [x] Status: complete
- Purpose: SQLite-backed memory store with cosine similarity vector search, FTS5 full-text search, CRUD, and bidirectional memory linking
- Key things to test:
  - Schema initializes correctly (memories table, fts5 virtual table, links table)
  - Cosine similarity returns correct value; handles zero-norm vectors without NaN/crash
  - Memory CRUD: add returns an ID; get by ID; update changes content; delete removes row
  - Bidirectional linking: linking A→B also creates B→A; duplicate links are rejected
  - `getLinkedMemories` returns both directions
  - Date filtering with `toMs()`: handles ISO strings and numeric timestamps
  - WHERE clause builder produces correct SQL for type, tags, date range, content search
  - Recent memories lookup respects `limit` parameter
  - Embedding stored and retrieved as the same float array
- Tests: src/plugins/CortexMemoryDatabase.test.ts

---

### src/plugins/CortexMemoryPlugin.ts
- [x] Status: complete
- Purpose: Long-term semantic memory with four types (factual/thought/behavior/procedure), embedding search, auto-linking, and autonomous conflict resolution
- Key things to test:
  - `getContext()` returns relevant memories above similarity threshold (0.5 factual, 0.65 procedure)
  - `search_memory` filters by type, truncates content at 300 chars, formats results
  - `save_memory` rejects content exceeding MAX_CONTENT_LENGTH (10K chars)
  - `save_memory` auto-links to up to 3 similar memories after saving
  - `save_behavior` invalidates behavior cache and injects into system prompt
  - `save_procedure` formats combined goal+steps string before saving
  - `edit_memory` and `delete_memory` check existence before modifying; behavior cache invalidated on behavior delete
  - `query_memories` builds correct filter from types, tags, date ranges
  - `onMessage()` conflict resolution: detects high-similarity duplicates (≥ 0.85), deletes recent (< 2h) or supersedes older memories
- Tests: src/plugins/CortexMemoryPlugin.test.ts

---

### src/plugins/ThoughtPlugin.ts
- [x] Status: complete
- Purpose: Extracts and persists internal `<think>` reasoning as thought memories; periodically synthesizes behavioral insights via LLM
- Key things to test:
  - Thought content is extracted and saved with correct type and timestamp
  - Synthesis is skipped when combined thought text is under threshold
  - LLM response of `"SKIP"` results in no memory being saved
  - Synthesized insight is truncated at MAX_INSIGHT_LENGTH (200 chars)
  - Deduplication: insight not saved if a very similar behavior memory already exists
  - Synthesis errors are caught and do not propagate to the caller
  - `onInit` guard prevents registering the message listener more than once
- Tests: src/plugins/ThoughtPlugin.test.ts

---

### src/plugins/SubAgentPlugin.ts
- [x] Status: complete
- Purpose: Wraps a HeadlessAgent as a single callable tool on the orchestrator; enforces inactivity and absolute wall-clock timeouts
- Key things to test:
  - Task string is truncated at MAX_TASK_LENGTH (10K chars) before forwarding
  - Inactivity timer resets on each tool call from the sub-agent
  - Absolute timeout fires even if the sub-agent keeps calling tools
  - No timeout is set when neither `inactivityTimeout` nor `absoluteTimeout` is configured
  - Tool call events from the sub-agent are forwarded to the parent agent
  - Concurrent invocations each get their own independent timeout handles
  - Rejection message is returned (not thrown) when a timeout fires
- Tests: src/plugins/SubAgentPlugin.test.ts

---

### src/providers/llm/StructuredToolCaller.ts
- [x] Status: complete
- Purpose: Manual tool-call loop for models without native tool support; uses structured JSON output and iterates up to MAX_ITERATIONS (10)
- Key things to test:
  - `buildToolSystemPromptAddition()` formats all tool definitions into the prompt correctly
  - Tool map is built for O(1) lookup by name
  - JSON parse failure falls back to returning raw content as a message
  - Response type `"tool_call"` dispatches to the correct tool implementation
  - Response type `"message"` terminates the loop and returns content
  - Unknown response type is treated as a message (no crash)
  - Missing or unknown tool name produces a descriptive error, not a crash
  - Tool result is stringified when it is not already a string
  - `ToolCallLimitError` is thrown after exactly MAX_ITERATIONS tool calls
  - `onToolResult` callback is invoked after each tool execution
- Tests: src/providers/llm/StructuredToolCaller.test.ts

---

### src/providers/llm/LMStudioProvider.ts
- [x] Status: complete
- Purpose: LLM provider wrapping LMStudio SDK; handles native and structured tool calling, streaming tokens, and reasoning extraction
- Key things to test:
  - Tool strategy switches to `structured_output` when model lacks native tool support
  - System prompt is augmented with tool definitions in structured mode
  - Chat messages are marshaled with correct roles and schema
  - Streaming token callback receives each fragment with correct `reasoningType`
  - Reasoning content (inside `<think>` tags) is collected and returned separately
  - Trailing `</think>` artifacts are stripped from final content
  - Embedding model is used only when `embed()` is called; generates correct-length vectors
  - Connection error produces a meaningful error message, not an unhandled rejection
- Tests: src/providers/llm/LMStudioProvider.test.ts

---

### src/providers/audio/VoiceActivityDetector.ts
- [x] Status: complete
- Purpose: Real-time speech detection on raw s16le PCM audio using RMS energy thresholding and configurable silence timeouts
- Key things to test:
  - RMS energy calculation: correct formula (sqrt of mean squared samples), proper 16-bit normalization
  - Energy above threshold triggers `speech_started` event and `isRecording` transition
  - Energy below threshold for `silenceTimeout` ms triggers `speech_ended` and `utterance_complete`
  - Continued speech resets the silence timer (no premature utterance completion)
  - Audio buffer accumulates across chunks; `utterance_complete` payload contains all accumulated bytes
  - Max buffer size (default 1.92 MB) is enforced; oldest bytes are dropped when exceeded
  - Odd-length buffer: trailing byte is ignored without error
  - `reset()` cancels all in-flight timers and clears accumulated state
  - Custom `energyThreshold` and `silenceTimeout` constructor options are respected
- Tests: src/providers/audio/VoiceActivityDetector.test.ts

---

### src/providers/audio/AudioSystem.ts
- [x] Status: complete
- Purpose: Orchestrates microphone → VAD → transcription pipeline with concurrency guards and status change events
- Key things to test:
  - Mic audio chunks are forwarded to the VAD
  - VAD `utterance_complete` triggers transcription
  - Concurrent transcription guard: second utterance is dropped if first is still in progress
  - `BLANK_AUDIO_TOKEN` results are filtered and do not emit a transcript
  - Transcription result is trimmed; empty string after trim is discarded
  - `status` events fire in sequence: `listening` → `transcribing` → `listening`
  - Transcription errors are caught and status returns to `listening` (no crash)
  - `destroy()` unregisters all listeners and prevents further event emission
- Tests: src/providers/audio/AudioSystem.test.ts

---
