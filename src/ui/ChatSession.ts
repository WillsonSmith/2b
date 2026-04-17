/**
 * ChatSession — framework-agnostic bridge between an agent and a UI.
 *
 * Subscribes to the agent's event stream and normalises it into a flat list of
 * ChatMessages, a per-turn active-tool list, and a dynamic-agent registry.
 * UIs (TerminalChat, web server) subscribe to ChatSession events instead of
 * wiring the agent directly — this keeps UI code decoupled from agent internals.
 *
 * Events emitted:
 *   "message"               — new ChatMessage appended
 *   "message_updated"       — existing message patched (streaming, tool calls, etc.)
 *   "state_change"          — "idle" | "thinking"
 *   "active_tools_changed"  — current list of in-flight tools
 *   "dynamic_agents_changed"— current list of spawned sub-agents and their states
 *
 * Critical: both terminal and web UIs depend on this. Changes to event names or
 * ChatMessage shape are breaking changes across both UIs.
 */
import { EventEmitter } from "node:events";
import type { AgentEventMap } from "../core/types.ts";
import type {
  ActiveTool,
  AgentState,
  ChatMessage,
  ChatSessionSnapshot,
  DynamicAgentRecord,
  ToolCallRecord,
} from "./types.ts";

/**
 * Minimal interface satisfied by both BaseAgent and CortexAgent.
 * Derived from AgentEventMap so event signatures can't drift.
 */
export type AgentLike = {
  addDirect(text: string): void;
  interrupt(): void;
  interruptSubAgents(): void;
  interruptAll(): void;
  setTokenCallback(fn: (token: string, isReasoning: boolean) => void): void;
} & {
  on<K extends keyof AgentEventMap>(event: K, listener: (...args: AgentEventMap[K]) => void): AgentLike;
  off<K extends keyof AgentEventMap>(event: K, listener: (...args: AgentEventMap[K]) => void): AgentLike;
  once<K extends keyof AgentEventMap>(event: K, listener: (...args: AgentEventMap[K]) => void): AgentLike;
};

/**
 * Framework-agnostic chat session adapter.
 *
 * Wraps an agent and normalises its events into a list of ChatMessages,
 * a dynamic agent registry, and a simple event stream. UIs (terminal, web)
 * subscribe to this instead of the agent directly.
 *
 * Usage:
 *   const session = new ChatSession(agent);
 *   session.on("message", (msg) => render(msg));
 *   session.on("message_updated", (msg) => update(msg));
 *   session.on("state_change", (state) => setSpinner(state === "thinking"));
 *   session.on("dynamic_agents_changed", (agents) => renderAgentPanel(agents));
 *   session.send("Hello!");
 */
export class ChatSession extends EventEmitter {
  private _messages: ChatMessage[] = [];
  private _state: AgentState = "idle";
  private _pendingAssistantId: string | null = null;
  private _activeTools: ActiveTool[] = [];
  private _dynamicAgents = new Map<string, DynamicAgentRecord>();

  constructor(private readonly agent: AgentLike) {
    super();
    // Prevent unhandled 'error' events from crashing the process when no
    // listener has been registered (e.g. UI subscribes lazily).
    this.on("error", () => {});
    this.bindAgentEvents();
  }

  /** Read-only snapshot of all messages in the conversation. */
  get messages(): readonly ChatMessage[] {
    return this._messages;
  }

  /** Current orchestrator state. */
  get state(): AgentState {
    return this._state;
  }

  /** Snapshot of tools currently executing. */
  get activeTools(): readonly ActiveTool[] {
    return this._activeTools;
  }

  /** Snapshot of all dynamically spawned agents and their current states. */
  get dynamicAgents(): readonly DynamicAgentRecord[] {
    return Array.from(this._dynamicAgents.values());
  }

  /**
   * Full serialization-safe snapshot of current session state.
   * Safe to send over WebSocket or SSE — all Dates are ISO strings.
   */
  getSnapshot(): ChatSessionSnapshot {
    return {
      messages: this._messages.map((m) => ({
        ...m,
        timestamp: m.timestamp.toISOString(),
      })),
      state: this._state,
      activeTools: [...this._activeTools],
      dynamicAgents: Array.from(this._dynamicAgents.values()),
    };
  }

  /**
   * Send a user message to the agent.
   * Immediately appends a user message and a pending assistant placeholder
   * to the message list, then forwards the text to the agent.
   */
  send(text: string): void {
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: text,
      toolCalls: [],
      status: "complete",
      timestamp: new Date(),
    };
    this.addMessage(userMessage);

    const assistantMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      toolCalls: [],
      status: "pending",
      timestamp: new Date(),
    };
    this.addMessage(assistantMessage);
    this._pendingAssistantId = assistantMessage.id;

    this.agent.addDirect(text);
  }

  /**
   * Interrupt the agent mid-response.
   * scope: "all" (default) — stops subagents and main agent
   *        "subagents"     — stops only in-flight subagent asks; main agent continues
   *        "main"          — stops only the main agent's LLM call
   */
  interrupt(scope: "main" | "subagents" | "all" = "all"): void {
    if (scope === "subagents") {
      this.agent.interruptSubAgents();
      return;
    }

    if (scope === "main") {
      this.agent.interrupt();
    } else {
      this.agent.interruptAll();
    }

    if (this._pendingAssistantId) {
      this.patchPending({ status: "complete" });
      this._pendingAssistantId = null;
    }
    this._activeTools = [];
    this.emit("active_tools_changed", []);
  }

  /** Add an inline system notification (slash command feedback, errors, etc.). */
  addSystemMessage(content: string): void {
    this.addMessage({
      id: crypto.randomUUID(),
      role: "system",
      content,
      toolCalls: [],
      status: "complete",
      timestamp: new Date(),
    });
  }

  /** Remove all messages from the session (does not reset agent memory). */
  clear(): void {
    this._messages = [];
    this._pendingAssistantId = null;
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private bindAgentEvents(): void {
    // Stream tokens into the pending assistant message content.
    // Reasoning tokens are excluded here; they arrive via the "thought" event.
    this.agent.setTokenCallback((token, isReasoning) => {
      if (isReasoning || !this._pendingAssistantId) return;
      const msg = this.getPending();
      if (msg) this.patchPending({ content: msg.content + token, status: "streaming" });
    });

    // Attach reasoning text to the pending message.
    this.agent.on("thought", (text) => {
      if (text) this.patchPending({ thought: text });
    });

    // Record each tool invocation on the pending message and track as active.
    this.agent.on("tool_call", (name, args) => {
      const msg = this.getPending();
      if (!msg) return;
      const record: ToolCallRecord = { name, args };
      this.patchPending({ toolCalls: [...msg.toolCalls, record] });
      this._activeTools = [...this._activeTools, { name }];
      this.emit("active_tools_changed", [...this._activeTools]);
    });

    // Stream sub-agent tokens into the pending assistant message (non-reasoning only).
    this.agent.on("subagent_token", (_agentName, token, isReasoning) => {
      if (isReasoning || !this._pendingAssistantId) return;
      const msg = this.getPending();
      if (msg) this.patchPending({ content: msg.content + token, status: "streaming" });
    });

    // When a sub-agent starts one of its own tools, annotate its parent entry
    // with the agent name and the child tool it's running.
    this.agent.on("subagent_tool_call", (agentName, agentToolName, toolName) => {
      const idx = this._activeTools.findIndex((t) => t.name === agentToolName);
      if (idx !== -1) {
        const updated = [...this._activeTools];
        updated[idx] = { ...updated[idx]!, agentName, currentSubTool: toolName };
        this._activeTools = updated;
        this.emit("active_tools_changed", [...this._activeTools]);
      }
    });

    // Remove the tool from the active list when it completes.
    this.agent.on("tool_result", (name) => {
      const idx = this._activeTools.findIndex((t) => t.name === name);
      if (idx !== -1) {
        const updated = [...this._activeTools];
        updated.splice(idx, 1);
        this._activeTools = updated;
        this.emit("active_tools_changed", [...this._activeTools]);
      }
    });

    // "speak" fires after all tool rounds complete with the authoritative final text.
    this.agent.on("speak", (response) => {
      this.patchPending({ content: response, status: "complete" });
      this._pendingAssistantId = null;
      this._activeTools = [];
      this.emit("active_tools_changed", []);
    });

    this.agent.on("state_change", (state) => {
      this._state = state;
      if (state === "idle") {
        this._activeTools = [];
        this.emit("active_tools_changed", []);
      }
      this.emit("state_change", state);
    });

    this.agent.on("error", (err) => {
      this.patchPending({ status: "error" });
      this._pendingAssistantId = null;
      this.emit("error", err);
    });

    // ── Dynamic agent lifecycle ───────────────────────────────────────────────

    this.agent.on("agent_spawned", (agentName, agentType, capabilities) => {
      const record: DynamicAgentRecord = {
        name: agentName,
        type: agentType,
        capabilities,
        state: "idle",
        createdAt: new Date().toISOString(),
      };
      this._dynamicAgents.set(agentName, record);
      this.emit("dynamic_agents_changed", this.dynamicAgents);
    });

    this.agent.on("agent_state_change", (agentName, state) => {
      const record = this._dynamicAgents.get(agentName);
      if (record) {
        this._dynamicAgents.set(agentName, { ...record, state });
        this.emit("dynamic_agents_changed", this.dynamicAgents);
      }
    });

    this.agent.on("agent_error", (agentName) => {
      const record = this._dynamicAgents.get(agentName);
      if (record) {
        this._dynamicAgents.set(agentName, { ...record, state: "error" });
        this.emit("dynamic_agents_changed", this.dynamicAgents);
      }
    });
  }

  private addMessage(msg: ChatMessage): void {
    this._messages.push(msg);
    this.emit("message", { ...msg });
  }

  private getPending(): ChatMessage | undefined {
    if (!this._pendingAssistantId) return undefined;
    return this._messages.find((m) => m.id === this._pendingAssistantId);
  }

  private patchPending(patch: Partial<ChatMessage>): void {
    const msg = this.getPending();
    if (!msg) return;
    Object.assign(msg, patch);
    this.emit("message_updated", { ...msg });
  }
}
