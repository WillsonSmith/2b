/**
 * PermissionDialog — modal that surfaces the agent's tool-approval prompts.
 *
 * Subscribes to `permission_request` server messages. When one arrives it
 * displays the agent name, tool name, pretty-printed args, and (for
 * file-mutating tools) a unified line-by-line diff between current and
 * proposed file content. The user picks Allow once / Allow this session /
 * Deny; the choice is sent back as `permission_response` and the dialog
 * dismisses. A request that hasn't been responded to within the same 30 s
 * the server uses auto-resolves to "deny" client-side as well, so the UI
 * never gets stuck on a stale prompt.
 */
import { useCallback, useEffect, useState } from "react";
import type { MutableRefObject } from "react";
import type { Subscribe } from "../../../hooks/useWebSocket.ts";
import { PermissionPrompt } from "./PermissionPrompt.tsx";
import { CLIENT_TIMEOUT_MS } from "./types.ts";
import type { Decision, PendingPrompt } from "./types.ts";

interface PermissionDialogProps {
  wsRef: MutableRefObject<WebSocket | null>;
  subscribe: Subscribe;
}

export function PermissionDialog({ wsRef, subscribe }: PermissionDialogProps) {
  // FIFO queue: if several prompts pile up (rare — the agent usually awaits
  // each one) the user can decide them one at a time.
  const [queue, setQueue] = useState<PendingPrompt[]>([]);
  const current = queue[0] ?? null;

  useEffect(() => {
    return subscribe("permission_request", (msg) => {
      setQueue((prev) => [
        ...prev,
        {
          id: msg.id,
          agentName: msg.agentName,
          toolName: msg.toolName,
          args: msg.args,
          fileDiff: msg.fileDiff,
        },
      ]);
    });
  }, [subscribe]);

  const respond = useCallback(
    (id: string, decision: Decision) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "permission_response", id, decision }));
      }
      setQueue((prev) => prev.filter((p) => p.id !== id));
    },
    [wsRef],
  );

  // Client-side auto-deny — stops the modal lingering forever if the server
  // timed out first or the socket dropped after we got the request.
  useEffect(() => {
    if (!current) return;
    const id = current.id;
    const t = setTimeout(() => respond(id, "deny"), CLIENT_TIMEOUT_MS);
    return () => clearTimeout(t);
  }, [current, respond]);

  useEffect(() => {
    if (!current) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        respond(current.id, "deny");
      } else if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        respond(current.id, "allow_once");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, respond]);

  if (!current) return null;

  return (
    <PermissionPrompt
      prompt={current}
      onDecide={(decision) => respond(current.id, decision)}
    />
  );
}
