/**
 * Web UI entry point — Bun HTTP + WebSocket server.
 *
 * Serves the bundled SPA (index.html) and upgrades any WebSocket connection to
 * a real-time agent session. All connected clients are tracked in a Set and
 * receive broadcasts simultaneously; connecting from a second device does not
 * disrupt existing connections.
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
import { ChatSessionStore } from "./ChatSessionStore.ts";
import type { ChatMessage } from "../types.ts";
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
  sessionStore?: ChatSessionStore;
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
  sessionStore,
}: StartWebUIOptions): Promise<void> {
  await agent.start();

  const session = new ChatSession(agent);
  let currentModel = model;
  const clients = new Set<ServerWebSocket<unknown>>();

  const broadcast = (msg: unknown) => {
    const str = JSON.stringify(msg);
    for (const client of clients) client.send(str);
  };

  // Track the last permission request's toolName so "always" can cache it
  const originalRequestApproval = permissionManager.requestApproval.bind(permissionManager);
  permissionManager.requestApproval = async (request) => {
    lastPermissionToolName = request.toolName;
    return originalRequestApproval(request);
  };

  // Bind session listeners once — broadcast to all connected clients
  session.on("message", (message) => broadcast({ type: "message", message }));
  session.on("message_updated", (message) => broadcast({ type: "message_updated", message }));
  session.on("state_change", (state) => broadcast({ type: "state_change", state }));
  session.on("active_tools_changed", (tools) => broadcast({ type: "active_tools_changed", tools }));
  session.on("dynamic_agents_changed", (agents) => broadcast({ type: "dynamic_agents_changed", agents }));
  agent.on("behavior:conflict_detected", (newId, newText, conflictId, conflictText, score) =>
    broadcast({ type: "behavior_conflict", newId, newText, conflictId, conflictText, score }),
  );
  agent.on("behaviors_loaded", (core, contextual) =>
    broadcast({ type: "behaviors_loaded", core, contextual }),
  );

  permissionManager.setTransport(broadcast);

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

  // ── Session route handlers ────────────────────────────────────────────────

  function handleListSessions(): Response {
    if (!sessionStore) return jsonError("Session store not available", 503);
    return json(sessionStore.listSessions());
  }

  async function handleCreateSession(req: Request): Promise<Response> {
    if (!sessionStore) return jsonError("Session store not available", 503);
    let body: { id?: string };
    try {
      body = await req.json() as { id?: string };
    } catch {
      return jsonError("Invalid JSON body");
    }
    if (!body.id?.trim()) return jsonError("id is required");
    const existing = sessionStore.getSession(body.id.trim());
    if (existing) return json(existing);
    return json(sessionStore.createSession(body.id.trim()), 201);
  }

  function handleGetSessionMessages(req: Request): Response {
    if (!sessionStore) return jsonError("Session store not available", 503);
    const id = new URL(req.url).pathname.split("/")[3] ?? "";
    const session = sessionStore.getSession(id);
    if (!session) return jsonError("Session not found", 404);
    return json(session.messages);
  }

  async function handlePatchSessionTitle(req: Request): Promise<Response> {
    if (!sessionStore) return jsonError("Session store not available", 503);
    const id = new URL(req.url).pathname.split("/")[3] ?? "";
    if (!sessionStore.getSession(id)) return jsonError("Session not found", 404);
    let body: { title?: string };
    try {
      body = await req.json() as { title?: string };
    } catch {
      return jsonError("Invalid JSON body");
    }
    if (!body.title?.trim()) return jsonError("title is required");
    sessionStore.updateTitle(id, body.title.trim());
    return json({ ok: true });
  }

  async function handlePatchSessionMessages(req: Request): Promise<Response> {
    if (!sessionStore) return jsonError("Session store not available", 503);
    const id = new URL(req.url).pathname.split("/")[3] ?? "";
    if (!sessionStore.getSession(id)) return jsonError("Session not found", 404);
    let body: { messages?: ChatMessage[]; touch?: boolean };
    try {
      body = await req.json() as { messages?: ChatMessage[]; touch?: boolean };
    } catch {
      return jsonError("Invalid JSON body");
    }
    if (!Array.isArray(body.messages)) return jsonError("messages array is required");
    sessionStore.saveMessages(id, body.messages, body.touch !== false);
    return json({ ok: true });
  }

  function handleDeleteSession(req: Request): Response {
    if (!sessionStore) return jsonError("Session store not available", 503);
    const id = new URL(req.url).pathname.split("/").at(-1) ?? "";
    if (!sessionStore.getSession(id)) return jsonError("Session not found", 404);
    sessionStore.deleteSession(id);
    return json({ ok: true });
  }

  Bun.serve({
    port,
    routes: {
      "/": index,
      "/chat/:id": index,
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
      "/api/sessions": {
        GET: handleListSessions,
        POST: handleCreateSession,
      },
      "/api/sessions/:id/messages": {
        GET: handleGetSessionMessages,
        PATCH: handlePatchSessionMessages,
      },
      "/api/sessions/:id/title": {
        PATCH: handlePatchSessionTitle,
      },
      "/api/sessions/:id": {
        DELETE: handleDeleteSession,
      },
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ type: "snapshot", ...session.getSnapshot() }));
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

      close(ws) {
        clients.delete(ws);
      },
    },

    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Not found", { status: 404 });
    },
  });

  console.log(`2b web UI running at http://localhost:${port}`);
}
