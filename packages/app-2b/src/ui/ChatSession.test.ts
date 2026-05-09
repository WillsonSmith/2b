import { describe, test, expect, mock, beforeEach } from "bun:test";
import { EventEmitter } from "node:events";
import { ChatSession } from "./ChatSession.ts";
import type { AgentLike } from "./ChatSession.ts";
import type { ChatMessage } from "./types.ts";

// Minimal mock agent that lets tests drive events manually
class MockAgent extends EventEmitter implements AgentLike {
  addDirect = mock(() => {});
  interrupt = mock(() => {});
  interruptSubAgents = mock(() => {});
  interruptAll = mock(() => {});
  tokenCallback: ((token: string, isReasoning: boolean) => void) | null = null;

  setTokenCallback(fn: (token: string, isReasoning: boolean) => void) {
    this.tokenCallback = fn;
  }

  // Helpers for tests
  sendToken(token: string, isReasoning = false) {
    this.tokenCallback?.(token, isReasoning);
  }
  speak(response: string) {
    this.emit("speak", response);
  }
  think(text: string) {
    this.emit("thought", text);
  }
  stateChange(state: "idle" | "thinking") {
    this.emit("state_change", state);
  }
  toolCall(name: string, args: Record<string, unknown>) {
    this.emit("tool_call", name, args);
  }
  error(err: Error) {
    this.emit("error", err);
  }
}

let agent: MockAgent;
let session: ChatSession;

beforeEach(() => {
  agent = new MockAgent();
  session = new ChatSession(agent);
});

describe("send()", () => {
  test("adds a user message immediately", () => {
    session.send("hello");
    expect(session.messages[0]!.role).toBe("user");
    expect(session.messages[0]!.content).toBe("hello");
    expect(session.messages[0]!.status).toBe("complete");
  });

  test("adds a pending assistant placeholder immediately", () => {
    session.send("hello");
    expect(session.messages[1]!.role).toBe("assistant");
    expect(session.messages[1]!.status).toBe("pending");
    expect(session.messages[1]!.content).toBe("");
  });

  test("forwards text to agent.addDirect", () => {
    session.send("hello");
    expect(agent.addDirect).toHaveBeenCalledWith("hello");
  });

  test("emits 'message' for both user and assistant placeholder", () => {
    const emitted: ChatMessage[] = [];
    session.on("message", (m) => emitted.push(m));
    session.send("hi");
    expect(emitted).toHaveLength(2);
    expect(emitted[0]!.role).toBe("user");
    expect(emitted[1]!.role).toBe("assistant");
  });
});

describe("token streaming", () => {
  test("accumulates tokens into assistant content", () => {
    session.send("hi");
    agent.sendToken("Hel");
    agent.sendToken("lo");
    expect(session.messages[1]!.content).toBe("Hello");
    expect(session.messages[1]!.status).toBe("streaming");
  });

  test("ignores reasoning tokens in content", () => {
    session.send("hi");
    agent.sendToken("<think>", true);
    agent.sendToken("reasoning", true);
    expect(session.messages[1]!.content).toBe("");
  });

  test("emits 'message_updated' for each token", () => {
    const updates: ChatMessage[] = [];
    session.on("message_updated", (m) => updates.push(m));
    session.send("hi");
    agent.sendToken("A");
    agent.sendToken("B");
    expect(updates).toHaveLength(2);
  });
});

describe("speak event", () => {
  test("sets final content and marks message complete", () => {
    session.send("hi");
    agent.sendToken("partial");
    agent.speak("full response");
    expect(session.messages[1]!.content).toBe("full response");
    expect(session.messages[1]!.status).toBe("complete");
  });

  test("clears pending assistant id after speak", () => {
    session.send("hi");
    agent.speak("done");
    // A second speak should have nothing to update (no pending)
    const updates: ChatMessage[] = [];
    session.on("message_updated", (m) => updates.push(m));
    agent.speak("orphan");
    expect(updates).toHaveLength(0);
  });
});

describe("thought event", () => {
  test("attaches reasoning to pending assistant message", () => {
    session.send("hi");
    agent.think("I am reasoning");
    expect(session.messages[1]!.thought).toBe("I am reasoning");
  });

  test("ignores empty thought text", () => {
    session.send("hi");
    agent.think("");
    expect(session.messages[1]!.thought).toBeUndefined();
  });
});

describe("tool_call event", () => {
  test("appends tool calls to pending message", () => {
    session.send("hi");
    agent.toolCall("web_search", { query: "bun.sh" });
    agent.toolCall("echo", { text: "hi" });
    expect(session.messages[1]!.toolCalls).toHaveLength(2);
    expect(session.messages[1]!.toolCalls[0]!.name).toBe("web_search");
    expect(session.messages[1]!.toolCalls[1]!.name).toBe("echo");
  });
});

describe("state_change event", () => {
  test("updates session.state", () => {
    agent.stateChange("thinking");
    expect(session.state).toBe("thinking");
    agent.stateChange("idle");
    expect(session.state).toBe("idle");
  });

  test("re-emits state_change", () => {
    const states: string[] = [];
    session.on("state_change", (s) => states.push(s));
    agent.stateChange("thinking");
    agent.stateChange("idle");
    expect(states).toEqual(["thinking", "idle"]);
  });
});

describe("error event", () => {
  test("marks pending message as error", () => {
    session.send("hi");
    agent.error(new Error("boom"));
    expect(session.messages[1]!.status).toBe("error");
  });

  test("re-emits error", () => {
    const errors: Error[] = [];
    session.on("error", (e) => errors.push(e));
    session.send("hi");
    agent.error(new Error("boom"));
    expect(errors).toHaveLength(1);
    expect(errors[0]!.message).toBe("boom");
  });
});

describe("interrupt()", () => {
  test("calls agent.interrupt", () => {
    session.send("hi");
    session.interrupt();
    expect(agent.interruptAll).toHaveBeenCalled();
  });

  test("finalises the pending message as complete", () => {
    session.send("hi");
    agent.sendToken("partial");
    session.interrupt();
    expect(session.messages[1]!.status).toBe("complete");
    expect(session.messages[1]!.content).toBe("partial");
  });
});

describe("clear()", () => {
  test("empties the message list", () => {
    session.send("hi");
    agent.speak("response");
    session.clear();
    expect(session.messages).toHaveLength(0);
  });
});

describe("message immutability", () => {
  test("emitted messages are snapshots, not live references", () => {
    const emitted: ChatMessage[] = [];
    session.on("message_updated", (m) => emitted.push(m));
    session.send("hi");
    agent.sendToken("A");
    agent.sendToken("B");
    // First snapshot captured "A", second captured "AB"
    expect(emitted[0]!.content).toBe("A");
    expect(emitted[1]!.content).toBe("AB");
  });
});
