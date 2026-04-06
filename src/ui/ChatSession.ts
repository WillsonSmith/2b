import { EventEmitter } from "node:events";
import type { ActiveTool, AgentState, ChatMessage, ToolCallRecord } from "./types.ts";

/**
 * Minimal interface satisfied by both BaseAgent and CortexAgent.
 * ChatSession is decoupled from concrete agent implementations.
 */
export interface AgentLike {
  addDirect(text: string): void;
  interrupt(): void;
  setTokenCallback(fn: (token: string, isReasoning: boolean) => void): void;
  on(event: "speak", listener: (response: string) => void): this;
  on(event: "thought", listener: (text: string) => void): this;
  on(event: "state_change", listener: (state: AgentState) => void): this;
  on(event: "tool_call", listener: (name: string, args: Record<string, unknown>) => void): this;
  on(event: "tool_result", listener: (name: string) => void): this;
  on(event: "subagent_tool_call", listener: (agentToolName: string, toolName: string, args: Record<string, unknown>) => void): this;
  on(event: "error", listener: (err: Error) => void): this;
}

/**
 * Framework-agnostic chat session adapter.
 *
 * Wraps an agent and normalises its events into a list of ChatMessages
 * and a simple event stream. UIs (terminal, web) subscribe to this
 * instead of the agent directly.
 *
 * Usage:
 *   const session = new ChatSession(agent);
 *   session.on("message", (msg) => render(msg));
 *   session.on("message_updated", (msg) => update(msg));
 *   session.on("state_change", (state) => setSpinner(state === "thinking"));
 *   session.send("Hello!");
 */
export class ChatSession extends EventEmitter {
  private _messages: ChatMessage[] = [];
  private _state: AgentState = "idle";
  private _pendingAssistantId: string | null = null;
  private _activeTools: ActiveTool[] = [];

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

  /** Current agent state. */
  get state(): AgentState {
    return this._state;
  }

  /** Snapshot of tools currently executing. */
  get activeTools(): readonly ActiveTool[] {
    return this._activeTools;
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
   * The pending assistant message is finalised with whatever content arrived.
   */
  interrupt(): void {
    this.agent.interrupt();
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

    // When a sub-agent starts one of its own tools, annotate its parent entry.
    this.agent.on("subagent_tool_call", (agentToolName, toolName) => {
      const idx = this._activeTools.findIndex((t) => t.name === agentToolName);
      if (idx !== -1) {
        const updated = [...this._activeTools];
        updated[idx] = { ...updated[idx]!, currentSubTool: toolName };
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
