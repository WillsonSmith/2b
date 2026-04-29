/**
 * Episteme HTTP + WebSocket server.
 *
 * Serves the editor SPA (index.html) and provides a real-time WebSocket channel
 * between the browser editor and the CortexAgent.
 *
 * WebSocket protocol (client → server):
 *   { type: "send",           text }               — chat message to agent
 *   { type: "interrupt" }                           — abort in-flight LLM call
 *   { type: "editor_context", file, content, cursor } — editor state update
 *   { type: "file_open",      path }               — read file from workspace
 *   { type: "file_save",      path, content }      — write file to workspace
 *
 * WebSocket protocol (server → client):
 *   { type: "speak",         text }                — agent response
 *   { type: "state_change",  state }               — "idle" | "thinking"
 *   { type: "tool_call",     name, args }
 *   { type: "tool_result",   name }
 *   { type: "file_content",  path, content }       — response to file_open
 *   { type: "error",         message }
 *
 * REST:
 *   GET /api/health
 *   GET /api/config
 *   PATCH /api/config          { models: EpistemModelConfig }
 */
import type { ServerWebSocket } from "bun";
import type { EpistemAgentBundle } from "./agent.ts";
import type { EpistemeConfig } from "./config.ts";
import { saveConfig } from "./config.ts";
import index from "./index.html";

type ClientMsg =
  | { type: "send"; text: string }
  | { type: "interrupt" }
  | { type: "editor_context"; file: string; content: string; cursor: number }
  | { type: "file_open"; path: string }
  | { type: "file_save"; path: string; content: string };

type ServerMsg =
  | { type: "speak"; text: string }
  | { type: "state_change"; state: "idle" | "thinking" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string }
  | { type: "file_content"; path: string; content: string }
  | { type: "error"; message: string };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function startEpistemServer(
  bundle: EpistemAgentBundle,
  workspaceRoot: string,
  config: EpistemeConfig,
  port: number,
): Promise<void> {
  const { agent, editorContext } = bundle;

  await agent.start();

  const clients = new Set<ServerWebSocket<unknown>>();

  function broadcast(msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const ws of clients) ws.send(payload);
  }

  agent.on("speak", (text) => broadcast({ type: "speak", text }));
  agent.on("state_change", (state) => broadcast({ type: "state_change", state }));
  agent.on("tool_call", (name, args) => broadcast({ type: "tool_call", name, args }));
  agent.on("tool_result", (name) => broadcast({ type: "tool_result", name }));

  Bun.serve({
    port,
    routes: {
      "/": index,
      "/api/health": {
        GET: () => json({ status: "ok", app: "episteme", workspace: workspaceRoot }),
      },
      "/api/config": {
        GET: () => json(config),
        PATCH: async (req: Request) => {
          try {
            const body = (await req.json()) as Partial<EpistemeConfig>;
            if (body.models) {
              Object.assign(config.models, body.models);
              await saveConfig(workspaceRoot, config);
            }
            return json(config);
          } catch {
            return json({ error: "Invalid JSON body" }, 400);
          }
        },
      },
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        ws.send(JSON.stringify({ type: "state_change", state: "idle" }));
      },
      close(ws) {
        clients.delete(ws);
      },
      async message(ws, raw) {
        let msg: ClientMsg;
        try {
          msg = JSON.parse(typeof raw === "string" ? raw : raw.toString()) as ClientMsg;
        } catch {
          return;
        }

        switch (msg.type) {
          case "send":
            if (msg.text.trim()) agent.addDirect(msg.text.trim());
            break;

          case "interrupt":
            agent.interrupt();
            break;

          case "editor_context":
            editorContext.setEditorState(msg.file, msg.content, msg.cursor);
            break;

          case "file_open": {
            try {
              const content = await Bun.file(msg.path).text();
              ws.send(JSON.stringify({ type: "file_content", path: msg.path, content } satisfies ServerMsg));
            } catch {
              ws.send(JSON.stringify({ type: "error", message: `Cannot open: ${msg.path}` } satisfies ServerMsg));
            }
            break;
          }

          case "file_save": {
            try {
              await Bun.write(msg.path, msg.content);
            } catch {
              ws.send(JSON.stringify({ type: "error", message: `Cannot save: ${msg.path}` } satisfies ServerMsg));
            }
            break;
          }
        }
      },
    },
    development: {
      hmr: true,
      console: true,
    },
  });

  console.log(`Episteme running at http://localhost:${port}`);
  console.log(`Workspace: ${workspaceRoot}`);
}
