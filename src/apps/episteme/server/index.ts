/**
 * Episteme HTTP + WebSocket server.
 *
 * WebSocket protocol: see ../protocol.ts (ClientMsg, ServerMsg).
 *
 * REST:
 *   GET   /api/health
 *   GET   /api/style-guide
 *   PATCH /api/style-guide    body: raw Markdown text
 *   GET   /api/config
 *   PATCH /api/config         { models }
 *   POST  /api/export         { filePath, format, includeFrontmatter }
 *   GET   /api/exports/:filename
 */
import type { ServerWebSocket } from "bun";
import { resolve, join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { mkdir } from "node:fs/promises";
import type { EpistemeAgentBundle } from "../agent.ts";
import type { EpistemeConfig } from "../config.ts";
import { saveConfig } from "../config.ts";
import { AutocompleteRunner } from "../features/autocomplete.ts";
import { LintRunner } from "../features/lint.ts";
import { checkPandoc, exportDocument, pandocAvailable } from "../features/export.ts";
import { assertNever, type ClientMsg, type ServerMsg } from "../protocol.ts";
import index from "../index.html";
import type { WsContext } from "./context.ts";
import { handleFile } from "./handlers/file.ts";
import { handleEditor } from "./handlers/editor.ts";
import { handleResearch } from "./handlers/research.ts";
import { handleMedia } from "./handlers/media.ts";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isWithinWorkspace(absPath: string, root: string): boolean {
  return absPath === root || absPath.startsWith(root + "/");
}

async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const glob = new Bun.Glob("**/*.md");
  for await (const match of glob.scan({ cwd: dir, dot: false })) {
    if (!match.startsWith(".episteme")) results.push(match);
  }
  return results.sort();
}

async function dispatch(
  msg: ClientMsg,
  ctx: WsContext,
  ws: ServerWebSocket<unknown>,
): Promise<void> {
  switch (msg.type) {
    case "send":
      if (msg.text.trim()) {
        ctx.workspaceDb.appendChatMessage("user", msg.text.trim());
        ctx.agent.addDirect(msg.text.trim());
      }
      return;

    case "interrupt":
      ctx.agent.interrupt();
      return;

    case "list_workspace":
    case "file_open":
    case "file_save":
    case "file_create":
    case "file_rename":
      return handleFile(msg, ctx, ws);

    case "editor_context":
    case "autocomplete_request":
    case "outline_request":
    case "tone_transform":
    case "summarize_request":
    case "metadata_request":
    case "toc_request":
    case "autolink_request":
    case "diagram_request":
    case "table_request":
    case "lint_request":
      return handleEditor(msg, ctx, ws);

    case "ingest_url":
    case "ingest_pdf":
    case "search_request":
    case "detect_gaps_request":
    case "contradictions_request":
    case "contradiction_scan_request":
    case "graph_request":
    case "check_citations_request":
    case "format_citation_request":
      return handleResearch(msg, ctx, ws);

    case "analyze_image":
    case "explain_code":
    case "voice_data":
      return handleMedia(msg, ctx, ws);

    default:
      assertNever(msg);
  }
}

export async function startEpistemServer(
  bundle: EpistemeAgentBundle,
  workspaceRoot: string,
  config: EpistemeConfig,
  port: number,
): Promise<void> {
  const {
    agent, editorContext, workspace, styleGuide, research,
    citation, diagram, contradiction, workspaceDb,
  } = bundle;
  const absRoot = resolve(workspaceRoot);

  await agent.start();
  await checkPandoc();
  if (pandocAvailable) {
    console.log("Pandoc: available");
  } else {
    console.log("Pandoc: not found (export disabled — install with: brew install pandoc)");
  }

  const autocomplete = new AutocompleteRunner(config);
  const linter = new LintRunner(config);

  const clients = new Set<ServerWebSocket<unknown>>();

  function broadcast(msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const ws of clients) ws.send(payload);
  }

  function send(ws: ServerWebSocket<unknown>, msg: ServerMsg): void {
    ws.send(JSON.stringify(msg));
  }

  // Debounce workspace file-list broadcasts so rapid consecutive tool calls
  // don't each trigger a full directory scan.
  let workspaceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleWorkspaceRefresh(): void {
    if (workspaceRefreshTimer) clearTimeout(workspaceRefreshTimer);
    workspaceRefreshTimer = setTimeout(() => {
      collectMarkdownFiles(absRoot).then((files) =>
        broadcast({ type: "workspace_files", files }),
      );
    }, 200);
  }

  function resolveWorkspacePath(inputPath: string): string | null {
    const absolute = inputPath.startsWith("/") ? inputPath : resolve(join(absRoot, inputPath));
    return isWithinWorkspace(absolute, absRoot) ? absolute : null;
  }

  const ctx: WsContext = {
    agent,
    editorContext,
    workspace,
    research,
    citation,
    diagram,
    styleGuide,
    contradiction,
    workspaceDb,
    config,
    absRoot,
    autocomplete,
    linter,
    broadcast,
    send,
    collectMarkdownFiles: () => collectMarkdownFiles(absRoot),
    resolveWorkspacePath,
    scheduleWorkspaceRefresh,
  };

  workspace.setIndexProgressListener((indexed, total) => {
    broadcast({ type: "index_progress", indexed, total });
  });
  // Initial index after the listener is wired so connected clients see progress.
  await workspace.index();

  agent.on("speak", (text) => {
    workspaceDb.appendChatMessage("assistant", text);
    broadcast({ type: "speak", text });
  });
  agent.on("state_change", (state) => broadcast({ type: "state_change", state }));
  agent.on("tool_call", (name, args) => broadcast({ type: "tool_call", name, args }));
  const FILE_MUTATING_TOOLS = new Set([
    "write_file", "append_file", "patch_file", "move_file", "delete_file", "create_file",
  ]);
  agent.on("tool_result", (name) => {
    broadcast({ type: "tool_result", name });
    if (FILE_MUTATING_TOOLS.has(name)) {
      scheduleWorkspaceRefresh();
    }
  });

  Bun.serve({
    port,
    routes: {
      "/": index,
      "/api/health": {
        GET: () =>
          json({ status: "ok", app: "episteme", workspace: workspaceRoot, pandocAvailable }),
      },
      "/api/style-guide": {
        GET: () => json({ content: styleGuide.currentContent }),
        PATCH: async (req: Request) => {
          try {
            const content = await req.text();
            await styleGuide.save(content);
            return json({ success: true });
          } catch {
            return json({ error: "Failed to save style guide" }, 500);
          }
        },
      },
      "/api/models": {
        GET: async () => {
          try {
            const ollamaHost = process.env["OLLAMA_HOST"] ?? "http://127.0.0.1:11434";
            const res = await fetch(`${ollamaHost}/api/tags`);
            if (!res.ok) return json({ models: [] });
            const data = (await res.json()) as { models?: Array<{ name: string }> };
            const names = (data.models ?? []).map((m) => m.name).sort();
            return json({ models: names });
          } catch {
            return json({ models: [] });
          }
        },
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
            if (body.features !== undefined) {
              config.features = { ...config.features, ...body.features };
              await saveConfig(workspaceRoot, config);
            }
            return json(config);
          } catch {
            return json({ error: "Invalid JSON body" }, 400);
          }
        },
      },
      "/api/chat-history": {
        GET: () => json(workspaceDb.listChatMessages(200)),
      },
      "/api/export": {
        POST: async (req: Request) => {
          if (!pandocAvailable) {
            return json({ error: "Pandoc not installed. Run: brew install pandoc" }, 503);
          }
          try {
            const body = (await req.json()) as {
              filePath: string;
              format: "pdf" | "html";
              includeFrontmatter: boolean;
            };
            const { filePath, format, includeFrontmatter } = body;
            const absolute = resolveWorkspacePath(filePath);
            if (!absolute) {
              return json({ error: "Path escapes workspace boundary." }, 400);
            }
            const content = await Bun.file(absolute).text();
            const filename = filePath.split("/").at(-1) ?? "export.md";
            const result = await exportDocument(content, filename, { format, includeFrontmatter });
            setTimeout(() => Bun.$`rm -f ${result.path}`.quiet().catch(() => {}), 60_000);
            return json({ url: `/api/exports/${result.filename}` });
          } catch (err) {
            return json({ error: err instanceof Error ? err.message : "Export failed" }, 500);
          }
        },
      },
      "/api/exports/:filename": {
        GET: async (req: Request) => {
          const url = new URL(req.url);
          const filename = url.pathname.split("/").at(-1) ?? "";
          if (!filename || filename.includes("..") || filename.includes("/")) {
            return new Response("Not found", { status: 404 });
          }
          const filePath = join(tmpdir(), "episteme-exports", filename);
          try {
            const file = Bun.file(filePath);
            const ext = filename.split(".").at(-1) ?? "";
            const contentType =
              ext === "pdf" ? "application/pdf" : "text/html; charset=utf-8";
            return new Response(file, {
              headers: {
                "Content-Type": contentType,
                "Content-Disposition": `attachment; filename="${filename.replace(/["\\]/g, "")}"`,
              },
            });
          } catch {
            return new Response("Not found", { status: 404 });
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
        await dispatch(msg, ctx, ws);
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

const LAST_WORKSPACE_FILE = join(homedir(), ".config", "episteme", "last-workspace");

/**
 * Minimal stub server for when no workspace is provided at startup.
 * Serves the UI so the user can pick a folder, then exits(0) so Electron
 * can restart the full server with the selected workspace.
 */
export async function startEpistemStubServer(port: number): Promise<void> {
  Bun.serve({
    port,
    routes: {
      "/": index,
      "/api/health": {
        GET: () => json({ status: "ok", app: "episteme", workspace: null, pandocAvailable: false }),
      },
      "/api/workspace": {
        POST: async (req: Request) => {
          try {
            const { path: workspacePath } = (await req.json()) as { path: string };
            if (!workspacePath) return json({ error: "path is required" }, 400);
            const configDir = join(homedir(), ".config", "episteme");
            await mkdir(configDir, { recursive: true });
            await Bun.write(LAST_WORKSPACE_FILE, workspacePath);
            setTimeout(() => process.exit(0), 50);
            return json({ success: true });
          } catch {
            return json({ error: "Failed to set workspace" }, 500);
          }
        },
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

  console.log(`Episteme running at http://localhost:${port} (no workspace — waiting for folder selection)`);
}
