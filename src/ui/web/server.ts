import type { ServerWebSocket } from "bun";
import type { CortexAgent } from "../../core/CortexAgent.ts";
import { ChatSession } from "../ChatSession.ts";
import type { WebPermissionManager } from "./WebPermissionManager.ts";
import index from "./index.html";

interface StartWebUIOptions {
  agent: CortexAgent;
  model: string;
  systemPrompt: string;
  permissionManager: WebPermissionManager;
  onModelChange: (newModel: string) => void;
  port?: number;
}

// Tracks the last toolName from a permission_request so "always" can cache it.
let lastPermissionToolName: string | null = null;

export async function startWebUI({
  agent,
  model,
  systemPrompt,
  permissionManager,
  onModelChange,
  port = 3000,
}: StartWebUIOptions): Promise<void> {
  await agent.start();

  const session = new ChatSession(agent);
  let currentModel = model;
  let activeWs: ServerWebSocket<unknown> | null = null;

  // Forward permission requests to the connected client
  permissionManager.setTransport((msg) => {
    activeWs?.send(JSON.stringify(msg));
  });

  // Track the last permission request's toolName so "always" can cache it
  const originalRequestApproval = permissionManager.requestApproval.bind(permissionManager);
  permissionManager.requestApproval = async (request) => {
    lastPermissionToolName = request.toolName;
    return originalRequestApproval(request);
  };

  // Cleanup function for the current WebSocket's session listeners
  let unbindSession: (() => void) | null = null;

  function bindSessionToWs(ws: ServerWebSocket<unknown>): void {
    // Remove previous connection's listeners before adding new ones
    unbindSession?.();

    const send = (msg: unknown) => ws.send(JSON.stringify(msg));

    // Forward permission requests to this client
    permissionManager.setTransport(send);
    activeWs = ws;

    // Send current snapshot
    send({ type: "snapshot", ...session.getSnapshot() });

    const onMessage = (message: unknown) => send({ type: "message", message });
    const onMessageUpdated = (message: unknown) => send({ type: "message_updated", message });
    const onStateChange = (state: unknown) => send({ type: "state_change", state });
    const onActiveToolsChanged = (tools: unknown) => send({ type: "active_tools_changed", tools });
    const onDynamicAgentsChanged = (agents: unknown) => send({ type: "dynamic_agents_changed", agents });

    session.on("message", onMessage);
    session.on("message_updated", onMessageUpdated);
    session.on("state_change", onStateChange);
    session.on("active_tools_changed", onActiveToolsChanged);
    session.on("dynamic_agents_changed", onDynamicAgentsChanged);

    unbindSession = () => {
      session.off("message", onMessage);
      session.off("message_updated", onMessageUpdated);
      session.off("state_change", onStateChange);
      session.off("active_tools_changed", onActiveToolsChanged);
      session.off("dynamic_agents_changed", onDynamicAgentsChanged);
      unbindSession = null;
    };
  }

  Bun.serve({
    port,
    routes: {
      "/": index,
    },
    websocket: {
      open(ws) {
        bindSessionToWs(ws);
      },

      message(ws, raw) {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as Record<string, unknown>;
        } catch {
          return;
        }

        switch (msg.type) {
          case "send": {
            const text = msg.text;
            if (typeof text === "string" && text.trim().length > 0) {
              session.send(text.trim());
            }
            break;
          }
          case "interrupt":
            session.interrupt();
            break;
          case "clear":
            session.clear();
            break;
          case "permission_response": {
            const response = msg.response as "yes" | "always" | "no";
            const approved = response === "yes" || response === "always";
            const alwaysApprove = response === "always";
            if (alwaysApprove && lastPermissionToolName) {
              permissionManager.addSessionApproval(lastPermissionToolName);
              lastPermissionToolName = null;
            }
            permissionManager.resolvePermission(approved, alwaysApprove);
            break;
          }
          case "model_change": {
            const newModel = msg.model;
            if (typeof newModel === "string" && newModel.trim().length > 0) {
              currentModel = newModel.trim();
              onModelChange(currentModel);
              ws.send(JSON.stringify({ type: "model_changed", model: currentModel }));
            }
            break;
          }
          case "system_prompt_request":
            ws.send(JSON.stringify({ type: "system_prompt", systemPrompt, model: currentModel }));
            break;
        }
      },

      close() {
        unbindSession?.();
        activeWs = null;
      },
    },

    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`2b web UI running at http://localhost:${port}`);
}
