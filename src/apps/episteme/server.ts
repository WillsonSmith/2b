/**
 * Episteme HTTP + WebSocket server.
 *
 * WebSocket protocol (client → server):
 *   { type: "send",           text }               — chat message to agent
 *   { type: "interrupt" }                           — abort in-flight LLM call
 *   { type: "editor_context", file, content, cursor } — editor state update
 *   { type: "file_open",      path }               — read file from workspace
 *   { type: "file_save",      path, content }      — write file to workspace
 *   { type: "list_workspace" }                      — request workspace file list
 *
 * WebSocket protocol (server → client):
 *   { type: "speak",          text }
 *   { type: "state_change",   state }              — "idle" | "thinking"
 *   { type: "tool_call",      name, args }
 *   { type: "tool_result",    name }
 *   { type: "file_content",   path, content }      — response to file_open
 *   { type: "workspace_files", files }             — list of relative .md paths
 *   { type: "file_saved" }                         — save confirmed
 *   { type: "error",          message }
 *
 * REST:
 *   GET  /api/health
 *   GET  /api/config
 *   PATCH /api/config         { models }
 */
import type { ServerWebSocket } from "bun";
import { resolve, join, relative } from "node:path";
import type { EpistemAgentBundle } from "./agent.ts";
import type { EpistemeConfig } from "./config.ts";
import { saveConfig } from "./config.ts";
import index from "./index.html";

type ClientMsg =
  | { type: "send"; text: string }
  | { type: "interrupt" }
  | { type: "editor_context"; file: string; content: string; cursor: number }
  | { type: "file_open"; path: string }
  | { type: "file_save"; path: string; content: string }
  | { type: "list_workspace" };

type ServerMsg =
  | { type: "speak"; text: string }
  | { type: "state_change"; state: "idle" | "thinking" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string }
  | { type: "file_content"; path: string; content: string }
  | { type: "workspace_files"; files: string[] }
  | { type: "file_saved" }
  | { type: "error"; message: string };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Recursively collect all .md file paths within a directory. */
async function collectMarkdownFiles(dir: string, root: string): Promise<string[]> {
  const results: string[] = [];
  const glob = new Bun.Glob("**/*.md");
  for await (const match of glob.scan({ cwd: dir, dot: false })) {
    // Skip .episteme directory
    if (!match.startsWith(".episteme")) {
      results.push(match);
    }
  }
  return results.sort();
}

export async function startEpistemServer(
  bundle: EpistemAgentBundle,
  workspaceRoot: string,
  config: EpistemeConfig,
  port: number,
): Promise<void> {
  const { agent, editorContext } = bundle;
  const absRoot = resolve(workspaceRoot);

  await agent.start();

  const clients = new Set<ServerWebSocket<unknown>>();

  function broadcast(msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const ws of clients) ws.send(payload);
  }

  function send(ws: ServerWebSocket<unknown>, msg: ServerMsg): void {
    ws.send(JSON.stringify(msg));
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
        GET: () =>
          json({ status: "ok", app: "episteme", workspace: workspaceRoot }),
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
        send(ws, { type: "state_change", state: "idle" });
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

          case "list_workspace": {
            const files = await collectMarkdownFiles(absRoot, absRoot);
            send(ws, { type: "workspace_files", files });
            break;
          }

          case "file_open": {
            // Resolve relative path from workspace root; absolute paths pass through
            const absolute = msg.path.startsWith("/")
              ? msg.path
              : resolve(join(absRoot, msg.path));
            if (!absolute.startsWith(absRoot)) {
              send(ws, { type: "error", message: "Path escapes workspace boundary." });
              return;
            }
            try {
              const content = await Bun.file(absolute).text();
              // Send back the path as supplied by the client
              send(ws, { type: "file_content", path: msg.path, content });
            } catch {
              send(ws, { type: "error", message: `Cannot open: ${msg.path}` });
            }
            break;
          }

          case "file_save": {
            const absolute = msg.path.startsWith("/")
              ? msg.path
              : resolve(join(absRoot, msg.path));
            if (!absolute.startsWith(absRoot)) {
              send(ws, { type: "error", message: "Path escapes workspace boundary." });
              return;
            }
            try {
              await Bun.write(absolute, msg.content);
              send(ws, { type: "file_saved" });
            } catch {
              send(ws, { type: "error", message: `Cannot save: ${msg.path}` });
            }
            break;
          }
        }
      },
    },
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Not found", { status: 404 });
    },
    development: {
      hmr: true,
      console: true,
    },
  });

  console.log(`Episteme running at http://localhost:${port}`);
  console.log(`Workspace: ${workspaceRoot}`);
}
