/**
 * Web UI entry point — Bun HTTP + WebSocket server.
 *
 * Serves the bundled SPA (index.html) and upgrades any WebSocket connection to
 * a real-time agent session. Only one WebSocket client is tracked at a time
 * (`activeWs`); a new connection replaces the previous one's event listeners.
 *
 * WebSocket message protocol (client → server):
 *   { type: "send",              text }
 *   { type: "interrupt",         scope: "main"|"subagents"|"all" }
 *   { type: "clear" }
 *   { type: "permission_response", response: "yes"|"always"|"no" }
 *   { type: "model_change",      model }
 *   { type: "system_prompt_request" }
 *
 * WebSocket message protocol (server → client):
 *   { type: "snapshot",          ...session.getSnapshot() }
 *   { type: "message",           message }
 *   { type: "message_updated",   message }
 *   { type: "state_change",      state }
 *   { type: "active_tools_changed", tools }
 *   { type: "dynamic_agents_changed", agents }
 *   { type: "permission_request", ...request }   — via WebPermissionManager transport
 *   { type: "model_changed",     model }
 *   { type: "system_prompt",     systemPrompt, model }
 *   { type: "behavior_conflict", newId, newText, conflictId, conflictText, score }
 *   { type: "behaviors_loaded",  core, contextual }
 *
 * REST API:
 *   GET  /api/capabilities           → { panels: string[] }
 *   GET  /api/memories               → ?type=&limit=&search=
 *   PATCH /api/memories/:id          → { content: string }
 *   DELETE /api/memories/:id
 *   GET  /api/behaviors/conflicts    → ConflictRecord[]
 *   DELETE /api/behaviors/conflicts/:key
 *   POST /api/behaviors/synthesize   → { id_a, id_b }
 *   GET  /api/agents                 → DynamicAgentRecord[]
 *   GET  /api/trace/last             → RetrievalTrace | null
 *
 * The `lastPermissionToolName` module-level variable is a workaround: the
 * WebPermissionManager resolves approvals asynchronously, so the "always"
 * response handler needs to know which tool to cache — it reads this.
 *
 * Critical: `agent.start()` must be called before `Bun.serve()` so plugins
 * are ready before the first WebSocket message arrives.
 */
import type { ServerWebSocket } from "bun";
import type { CortexAgent } from "../../core/CortexAgent.ts";
import type { CortexMemoryPlugin } from "../../plugins/CortexMemoryPlugin.ts";
import type { BehaviorPlugin } from "../../plugins/BehaviorPlugin.ts";
import type { MemoryFilter } from "../../plugins/CortexMemoryDatabase.ts";
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
  memoryPlugin?: CortexMemoryPlugin;
  behaviorPlugin?: BehaviorPlugin;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function jsonError(message: string, status = 400): Response {
  return json({ error: message }, status);
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
  memoryPlugin,
  behaviorPlugin,
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
    const onBehaviorConflict = (
      newId: string, newText: string, conflictId: string, conflictText: string, score: number,
    ) => send({ type: "behavior_conflict", newId, newText, conflictId, conflictText, score });
    const onBehaviorsLoaded = (
      core: Array<{ id: string; text: string; weight: number }>,
      contextual: Array<{ id: string; text: string; score: number; weight: number }>,
    ) => send({ type: "behaviors_loaded", core, contextual });

    session.on("message", onMessage);
    session.on("message_updated", onMessageUpdated);
    session.on("state_change", onStateChange);
    session.on("active_tools_changed", onActiveToolsChanged);
    session.on("dynamic_agents_changed", onDynamicAgentsChanged);
    agent.on("behavior:conflict_detected", onBehaviorConflict);
    agent.on("behaviors_loaded", onBehaviorsLoaded);

    unbindSession = () => {
      session.off("message", onMessage);
      session.off("message_updated", onMessageUpdated);
      session.off("state_change", onStateChange);
      session.off("active_tools_changed", onActiveToolsChanged);
      session.off("dynamic_agents_changed", onDynamicAgentsChanged);
      agent.off("behavior:conflict_detected", onBehaviorConflict);
      agent.off("behaviors_loaded", onBehaviorsLoaded);
      unbindSession = null;
    };
  }

  // ── REST route handlers ───────────────────────────────────────────────────

  function handleCapabilities(): Response {
    const panels: string[] = [];
    if (memoryPlugin) panels.push("memory");
    if (behaviorPlugin) {
      panels.push("behaviors");
      panels.push("conflicts");
    }
    panels.push("agents"); // always available via session
    if (memoryPlugin) panels.push("trace");
    return json({ panels });
  }

  function handleGetMemories(req: Request): Response {
    if (!memoryPlugin) return jsonError("Memory plugin not available", 503);
    const url = new URL(req.url);
    const type = url.searchParams.get("type") ?? undefined;
    const limit = Math.min(200, parseInt(url.searchParams.get("limit") ?? "50", 10));
    const search = url.searchParams.get("search") ?? undefined;

    const filter: MemoryFilter = { limit };
    if (type && type !== "all") filter.types = [type];
    if (search) filter.contains = search;

    const rows = memoryPlugin.queryMemoriesRaw(filter);
    return json(rows);
  }

  async function handlePatchMemory(req: Request, id: string): Promise<Response> {
    if (!memoryPlugin) return jsonError("Memory plugin not available", 503);
    let body: { content?: string };
    try {
      body = await req.json() as { content?: string };
    } catch {
      return jsonError("Invalid JSON body");
    }
    if (!body.content?.trim()) return jsonError("content is required");
    const existing = await memoryPlugin.getMemoryById(id);
    if (!existing) return jsonError("Memory not found", 404);
    await memoryPlugin.editMemory(id, body.content.trim());
    return json({ ok: true });
  }

  async function handleDeleteMemory(id: string): Promise<Response> {
    if (!memoryPlugin) return jsonError("Memory plugin not available", 503);
    const existing = await memoryPlugin.getMemoryById(id);
    if (!existing) return jsonError("Memory not found", 404);
    await memoryPlugin.deleteMemoryById(id);
    return json({ ok: true });
  }

  function handleGetConflicts(): Response {
    if (!behaviorPlugin) return jsonError("Behavior plugin not available", 503);
    return json(behaviorPlugin.getConflicts());
  }

  function handleDismissConflict(req: Request): Response {
    if (!behaviorPlugin) return jsonError("Behavior plugin not available", 503);
    const key = decodeURIComponent(new URL(req.url).pathname.split("/").at(-1) ?? "");
    if (!key) return jsonError("Conflict key required");
    behaviorPlugin.dismissConflict(key);
    return json({ ok: true });
  }

  async function handleSynthesize(req: Request): Promise<Response> {
    if (!behaviorPlugin) return jsonError("Behavior plugin not available", 503);
    let body: { id_a?: string; id_b?: string };
    try {
      body = await req.json() as { id_a?: string; id_b?: string };
    } catch {
      return jsonError("Invalid JSON body");
    }
    if (!body.id_a || !body.id_b) return jsonError("id_a and id_b are required");
    const result = await behaviorPlugin.synthesize(body.id_a, body.id_b);
    return json({ result });
  }

  function handleGetAgents(): Response {
    return json(session.dynamicAgents);
  }

  function handleGetTrace(): Response {
    if (!memoryPlugin) return jsonError("Memory plugin not available", 503);
    return json(memoryPlugin.lastRetrievalTrace);
  }

  Bun.serve({
    port,
    routes: {
      "/": index,
      "/api/capabilities": { GET: handleCapabilities },
      "/api/memories": {
        GET: handleGetMemories,
      },
      "/api/memories/:id": {
        PATCH: (req: Request) => {
          const id = new URL(req.url).pathname.split("/").at(-1) ?? "";
          return handlePatchMemory(req, id);
        },
        DELETE: (req: Request) => {
          const id = new URL(req.url).pathname.split("/").at(-1) ?? "";
          return handleDeleteMemory(id);
        },
      },
      "/api/behaviors/conflicts": { GET: handleGetConflicts },
      "/api/behaviors/conflicts/:key": { DELETE: handleDismissConflict },
      "/api/behaviors/synthesize": { POST: handleSynthesize },
      "/api/agents": { GET: handleGetAgents },
      "/api/trace/last": { GET: handleGetTrace },
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
          case "interrupt": {
            const scope = msg.scope as "main" | "subagents" | "all" | undefined;
            session.interrupt(scope ?? "all");
            break;
          }
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
