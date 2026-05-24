import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import {
  persistedSignal,
  signal,
  useConstant,
  type Signal,
} from "./signals.ts";
import type { SidecarMessage } from "../components/AISidecar.tsx";
import type { EpistemePlanStepType } from "../planning/types.ts";
import type { AgentState, UseWebSocketReturn } from "../hooks/useWebSocket.ts";
import type { UsePlanningReturn } from "../hooks/usePlanning.ts";

interface ProviderStatus {
  reachable: boolean;
  endpoint: string;
  reason?: string;
}

interface ActivePlan {
  id: string;
  goal: string;
}

export interface AIContextValue {
  // ── State signals ──────────────────────────────────────────────────────
  messages: Signal<SidecarMessage[]>;
  agentState: Signal<AgentState>;
  providerStatus: Signal<ProviderStatus | null>;
  providerBannerDismissed: Signal<boolean>;
  sidecarCollapsed: Signal<boolean>;
  sidecarPendingInput: Signal<string>;
  activePlan: Signal<ActivePlan | null>;

  // ── Actions ────────────────────────────────────────────────────────────
  sendToAgent: (text: string) => void;
  interrupt: () => void;
  regenerate: (assistantIndex: number) => void;
  deleteMessage: (index: number) => void;
  removeMention: (index: number, path: string) => void;
  explainCode: (code: string, language: string) => void;
  resolveMentions: (text: string) => Promise<string>;

  planRequest: (goal: string, approvalMode: "all" | "per_step") => void;
  planRequestFromDocument: (
    path: string,
    goal: string,
    approvalMode: "all" | "per_step",
  ) => void;
  planFollowUp: (
    goal: string,
    priorPlanId: string,
    approvalMode: "all" | "per_step",
  ) => void;
  sendToPlan: (text: string) => void;
  /** Replace the message list with hydrated history (e.g. from /api/chat-history). */
  loadHistory: (rows: HistoryRow[]) => void;
}

const Ctx = createContext<AIContextValue | null>(null);

export function useAI(): AIContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAI must be used inside <AIProvider>");
  return v;
}

interface AIProviderProps {
  ws: UseWebSocketReturn;
  planning: UsePlanningReturn;
  /** Seeds the plan panel's goal field and opens it. */
  onSendToPlan: (text: string) => void;
  /** Opens the conflicts panel from a contradiction notification. */
  onContradictionNotify: () => void;
  /** Triggered after a successful ingest so the file tree can refresh. */
  onIngestComplete: () => void;
  children: ReactNode;
}

export function AIProvider({
  ws,
  planning,
  onSendToPlan,
  onContradictionNotify,
  onIngestComplete,
  children,
}: AIProviderProps) {
  // Refs let WS-subscription handlers read the latest ws/planning/callbacks
  // without forcing the subscriptions to tear down on every parent render.
  // Parent App re-renders on every editor keystroke, so this matters.
  const wsRef = useRef(ws);
  wsRef.current = ws;
  const planningRef = useRef(planning);
  planningRef.current = planning;
  const callbacksRef = useRef({ onSendToPlan, onContradictionNotify, onIngestComplete });
  callbacksRef.current = { onSendToPlan, onContradictionNotify, onIngestComplete };

  const value = useConstant<AIContextValue>(() => {
    const messages = signal<SidecarMessage[]>([]);
    const agentState = signal<AgentState>("disconnected");
    const providerStatus = signal<ProviderStatus | null>(null);
    const providerBannerDismissed = signal(false);
    const sidecarCollapsed = persistedSignal(
      "episteme:sidecar-collapsed",
      false,
      { serialize: (v) => (v ? "1" : "0"), deserialize: (raw) => raw === "1" },
    );
    const sidecarPendingInput = signal("");
    const activePlan = signal<ActivePlan | null>(null);

    return {
      messages,
      agentState,
      providerStatus,
      providerBannerDismissed,
      sidecarCollapsed,
      sidecarPendingInput,
      activePlan,

      // Filled in below — the closures need access to `ws`, `planning`, and
      // the callback props, which change identity on each App render. We
      // overwrite these fields in an effect so the *signals* stay stable
      // (callers read them via useAI() once) while the underlying behavior
      // tracks the latest props.
      sendToAgent: () => {},
      interrupt: () => {},
      regenerate: () => {},
      deleteMessage: () => {},
      removeMention: () => {},
      explainCode: () => {},
      resolveMentions: async (t) => t,
      planRequest: () => {},
      planRequestFromDocument: () => {},
      planFollowUp: () => {},
      sendToPlan: () => {},
      loadHistory: (rows: HistoryRow[]) => {
        messages.value = rows.map(historyRowToMessage);
      },
    };
  });

  // ── Mirror external state (React) into signals ──────────────────────────
  useEffect(() => {
    value.agentState.value = ws.agentState;
  }, [ws.agentState, value.agentState]);

  useEffect(() => {
    const p = planning.plan;
    value.activePlan.value = p ? { id: p.id, goal: p.goal } : null;
  }, [planning.plan?.id, planning.plan?.goal, value.activePlan]);

  // ── Bind actions (run once; closures read latest props via refs) ────────
  useEffect(() => {
    value.sendToAgent = (text: string) => {
      const ws = wsRef.current;
      if (ws.agentState === "disconnected") return;
      ws.sendToAgent(text);
      value.messages.value = [...value.messages.value, { role: "user", text }];
    };

    value.interrupt = () => wsRef.current.interrupt();

    value.regenerate = (assistantIndex: number) => {
      const all = value.messages.value;
      const before = all.slice(0, assistantIndex);
      let lastUserAt = -1;
      for (let i = before.length - 1; i >= 0; i--) {
        if (before[i]!.role === "user") { lastUserAt = i; break; }
      }
      if (lastUserAt === -1) return;
      const userMsg = before[lastUserAt];
      if (!userMsg || userMsg.role !== "user") return;
      value.messages.value = before.slice(0, lastUserAt);
      value.sendToAgent(userMsg.text);
    };

    value.deleteMessage = (index: number) => {
      const prev = value.messages.value;
      const msg = prev[index];
      if (msg && (msg.role === "user" || msg.role === "assistant") && msg.id !== undefined) {
        fetch(`/api/chat-history/${msg.id}`, { method: "DELETE" }).catch(() => {});
      }
      value.messages.value = prev.filter((_, i) => i !== index);
    };

    value.removeMention = (index: number, path: string) => {
      const prev = value.messages.value;
      const msg = prev[index];
      if (!msg || msg.role !== "user") return;
      const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const newText = msg.text.replace(new RegExp(`\\s*@${escaped}`, "g"), "").trim();
      if (msg.id !== undefined) {
        fetch(`/api/chat-history/${msg.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: newText }),
        }).catch(() => {});
      }
      if (!newText) {
        value.messages.value = prev.filter((_, i) => i !== index);
        return;
      }
      const next = [...prev];
      next[index] = { ...msg, text: newText };
      value.messages.value = next;
    };

    value.explainCode = (code: string, language: string) => {
      const ws = wsRef.current;
      if (!ws.wsRef.current || ws.agentState === "disconnected") return;
      ws.wsRef.current.send(JSON.stringify({ type: "explain_code", code, language }));
      value.messages.value = [
        ...value.messages.value,
        { role: "user", text: `Explain ${language} code block` },
      ];
      value.sidecarCollapsed.value = false;
    };

    value.resolveMentions = async (text: string) => {
      const mentionPattern = /@([\w\-./ ]+\.md)/g;
      const mentions = [...text.matchAll(mentionPattern)].map((m) => m[1]!.trim());
      if (mentions.length === 0) return text;
      const fetched = await Promise.all(
        mentions.map((path) =>
          fetch(`/api/file-content?path=${encodeURIComponent(path)}`)
            .then((r) => r.json() as Promise<{ content?: string }>)
            .then((d) => (d.content != null ? { path, content: d.content } : null))
            .catch(() => null),
        ),
      );
      const blocks = fetched
        .filter((f): f is { path: string; content: string } => f !== null)
        .map((f) => `[File: ${f.path}]\n\`\`\`\n${f.content}\n\`\`\``)
        .join("\n\n");
      return blocks ? `${blocks}\n\n---\n${text}` : text;
    };

    value.planRequest = async (goal, approvalMode) => {
      const resolved = await value.resolveMentions(goal);
      planningRef.current.requestPlan(resolved, approvalMode);
      value.sidecarCollapsed.value = false;
    };

    value.planRequestFromDocument = async (path, goal, approvalMode) => {
      const resolved = await value.resolveMentions(goal);
      planningRef.current.requestPlanFromDocument(path, resolved, approvalMode);
      value.sidecarCollapsed.value = false;
    };

    value.planFollowUp = async (goal, priorPlanId, approvalMode) => {
      const resolved = await value.resolveMentions(goal);
      planningRef.current.resetPlan();
      planningRef.current.requestPlan(resolved, approvalMode, priorPlanId);
      value.sidecarCollapsed.value = false;
    };

    value.sendToPlan = (text: string) => {
      callbacksRef.current.onSendToPlan(text);
    };
  }, [value]);

  // ── WS subscriptions that own the message stream + provider status ─────
  // Subscribe once. Handlers read latest props via the refs above; otherwise
  // every parent re-render (e.g. editor keystroke) would tear down and rebuild
  // all subscriptions.
  useEffect(() => {
    const ws = wsRef.current;
    const announcedPlugins = new Set<string>();

    const unsubSpeak = ws.subscribe("speak", (msg) => {
      value.messages.value = [
        ...value.messages.value,
        { role: "assistant", text: msg.text },
      ];
    });

    const unsubToolCall = ws.subscribe("tool_call", (msg) => {
      value.messages.value = [
        ...value.messages.value,
        { role: "tool", name: msg.name, status: "calling" },
      ];
    });

    const unsubToolResult = ws.subscribe("tool_result", (msg) => {
      const prev = value.messages.value;
      for (let i = prev.length - 1; i >= 0; i--) {
        const m = prev[i];
        if (m && m.role === "tool" && m.name === msg.name && m.status === "calling") {
          const next = [...prev];
          next[i] = {
            role: "tool",
            name: msg.name,
            status: msg.error ? "error" : "done",
            error: msg.error,
          };
          value.messages.value = next;
          return;
        }
      }
    });

    const unsubExplain = ws.subscribe("explain_code_result", (msg) => {
      value.messages.value = [
        ...value.messages.value,
        { role: "assistant", text: `**Code explanation:**\n\n${msg.explanation}` },
      ];
      value.sidecarCollapsed.value = false;
    });

    const unsubCheck = ws.subscribe("check_citations_result", (msg) => {
      const { valid, broken } = msg.result;
      value.messages.value = [
        ...value.messages.value,
        {
          role: "assistant",
          text: `Citations: ${valid.length} valid, ${broken.length} broken.${broken.length > 0 ? "\n\nBroken:\n" + broken.join("\n") : ""}`,
        },
      ];
    });

    const unsubFormat = ws.subscribe("format_citation_result", (msg) => {
      value.messages.value = [
        ...value.messages.value,
        { role: "assistant", text: `\`\`\`bibtex\n${msg.bibtex}\n\`\`\`` },
      ];
    });

    const unsubIngest = ws.subscribe("ingest_result", (msg) => {
      value.messages.value = [
        ...value.messages.value,
        {
          role: "assistant",
          text: msg.success
            ? `Ingestion started: ${msg.message}`
            : `Ingest failed: ${msg.message}`,
        },
      ];
      callbacksRef.current.onIngestComplete();
    });

    // Coalesces consecutive identical errors so the chat doesn't fill up
    // when Ollama is down. The reset side-effects (editor/research/conflicts
    // flags) stay in App.tsx for now.
    const unsubError = ws.subscribe("error", (msg) => {
      const text = `[Error] ${msg.message}`;
      const prev = value.messages.value;
      const last = prev[prev.length - 1];
      if (last && last.role === "assistant" && last.text === text) return;
      value.messages.value = [...prev, { role: "assistant", text }];
    });

    const unsubProvider = ws.subscribe("provider_status", (msg) => {
      value.providerStatus.value = {
        reachable: msg.reachable,
        endpoint: msg.endpoint,
        reason: msg.reason,
      };
      if (msg.reachable) value.providerBannerDismissed.value = false;
    });

    const unsubContradictionNotif = ws.subscribe("contradiction_notification", (msg) => {
      const label = msg.count === 1 ? "1 contradiction" : `${msg.count} contradictions`;
      value.messages.value = [
        ...value.messages.value,
        {
          role: "notification",
          text: `Background scan found ${label}.`,
          actionLabel: "View",
          onAction: () => {
            callbacksRef.current.onContradictionNotify();
            value.sidecarCollapsed.value = false;
          },
        },
      ];
      value.sidecarCollapsed.value = false;
    });

    const unsubStepStarted = ws.subscribe("plan_step_started", (msg) => {
      const plan = planningRef.current.plan;
      const step = plan?.steps.find((s) => s.id === msg.stepId);
      if (!step) return;
      value.messages.value = [
        ...value.messages.value,
        {
          role: "plan_step",
          planId: msg.planId,
          stepId: msg.stepId,
          stepTitle: step.title,
          stepType: step.type,
          state: "running",
        },
      ];
    });

    const unsubStepCompleted = ws.subscribe("plan_step_completed", (msg) => {
      value.messages.value = value.messages.value.map((m) =>
        m.role === "plan_step" && m.stepId === msg.stepId
          ? { ...m, state: "complete", summary: msg.summary }
          : m,
      );
    });

    const unsubStepFailed = ws.subscribe("plan_step_failed", (msg) => {
      value.messages.value = value.messages.value.map((m) =>
        m.role === "plan_step" && m.stepId === msg.stepId
          ? { ...m, state: "failed", error: msg.error }
          : m,
      );
    });

    const unsubAgentMode = ws.subscribe("agent_mode_changed", (msg) => {
      const newlyActive = msg.activePlugins.filter((name) => !announcedPlugins.has(name));
      if (newlyActive.length === 0) return;
      for (const name of newlyActive) announcedPlugins.add(name);
      value.messages.value = [
        ...value.messages.value,
        ...newlyActive.map((name) => ({
          role: "system_event" as const,
          plugin: name,
          text: `${pluginLabel(name)} tools now available`,
        })),
      ];
    });

    return () => {
      unsubSpeak();
      unsubToolCall();
      unsubToolResult();
      unsubExplain();
      unsubCheck();
      unsubFormat();
      unsubIngest();
      unsubError();
      unsubProvider();
      unsubContradictionNotif();
      unsubStepStarted();
      unsubStepCompleted();
      unsubStepFailed();
      unsubAgentMode();
    };
  }, [value]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export type HistoryRow =
  | { id: number; role: "user" | "assistant"; text: string }
  | { id: number; role: "tool"; name: string; status: "done" | "error"; error?: string }
  | {
      id: number;
      role: "plan_step";
      planId: string;
      stepId: string;
      stepTitle: string;
      stepType: string;
      state: "complete" | "failed";
      summary?: string;
      error?: string;
    };

export function historyRowToMessage(r: HistoryRow): SidecarMessage {
  if (r.role === "tool") {
    return { role: "tool", name: r.name, status: r.status, error: r.error };
  }
  if (r.role === "plan_step") {
    return {
      role: "plan_step",
      planId: r.planId,
      stepId: r.stepId,
      stepTitle: r.stepTitle,
      stepType: r.stepType as EpistemePlanStepType,
      state: r.state,
      summary: r.summary,
      error: r.error,
    };
  }
  return { role: r.role, text: r.text, id: r.id };
}

const PLUGIN_LABELS: Record<string, string> = {
  Diagram: "Diagram",
  Citation: "Citation",
  Contradiction: "Contradiction scanning",
  StyleGuide: "Style guide",
};
function pluginLabel(name: string): string {
  return PLUGIN_LABELS[name] ?? name;
}
