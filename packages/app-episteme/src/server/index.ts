/**
 * Episteme HTTP + WebSocket server.
 *
 * WebSocket protocol: see ../protocol.ts (ClientMsg, ServerMsg).
 *
 * REST:
 *   GET   /api/health
 *   GET   /api/metrics        rolling-window agent tick metrics (last 50 ticks),
 *                              registered tool inventory, and never-called list
 *   GET   /api/style-guide
 *   PATCH /api/style-guide    body: raw Markdown text
 *   GET   /api/config
 *   PATCH /api/config         { models }
 */
import type { ServerWebSocket } from "bun";
import { resolve, join } from "node:path";
import { homedir } from "node:os";
import { mkdir, readdir } from "node:fs/promises";
import { watch } from "node:fs";
import type { EpistemeAgentBundle } from "../agent.ts";
import type { EpistemeConfig } from "../config.ts";
import { saveConfig, featureModel } from "../config.ts";
import { createProvider } from "@2b/framework/providers/llm/createProvider.ts";
import { TickMetricsAggregator } from "@2b/framework/core/TickMetricsAggregator.ts";
import { PlanningController } from "../planning/PlanningController.ts";
import { AutocompleteRunner } from "../features/autocomplete.ts";
import { assertNever, type ClientMsg, type ServerMsg } from "../protocol.ts";
import index from "../index.html";
import type { WsContext } from "./context.ts";
import { handleFile } from "./handlers/file.ts";
import { handleEditor } from "./handlers/editor.ts";
import { handleAIFill } from "./handlers/aiFill.ts";
import { handleResearch } from "./handlers/research.ts";
import { handleMedia } from "./handlers/media.ts";
import { handlePlan } from "./handlers/plan.ts";

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

async function collectSubdirectories(root: string, rel = ""): Promise<string[]> {
  const results: string[] = [];
  try {
    const entries = await readdir(join(root, rel || "."), { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      results.push(relPath);
      results.push(...await collectSubdirectories(root, relPath));
    }
  } catch {}
  return results.sort();
}

/**
 * Auto-activate a mode-gated plugin when its companion UI feature is used.
 * Called from `dispatch` before delegating to the matching handler.
 */
function autoActivateForMessage(msg: ClientMsg, ctx: WsContext): void {
  switch (msg.type) {
    case "diagram_request":
      ctx.activatePlugin("Diagram");
      return;
    case "check_citations_request":
    case "format_citation_request":
      ctx.activatePlugin("Citation");
      return;
    case "contradictions_request":
    case "contradiction_scan_request":
      ctx.activatePlugin("Contradiction");
      return;
  }
}

/**
 * Heuristic activation: scan free-form text (user input or AI response) for
 * keywords that signal the user/agent intends to use a mode-gated capability,
 * and activate the matching plugin so its tools are available next tick.
 *
 * Substring match is intentional — false positives just add a small amount of
 * extra tool surface; false negatives are the real cost (user types
 * "scan for contradictions" and the tool isn't there).
 */
const KEYWORD_TRIGGERS: ReadonlyArray<{ plugin: string; keywords: readonly string[] }> = [
  { plugin: "Diagram", keywords: ["diagram", "chart", "flowchart"] },
  { plugin: "Citation", keywords: ["citation", "cite ", "bibtex", "reference list"] },
  { plugin: "Contradiction", keywords: ["contradict", "conflict", "inconsist"] },
  { plugin: "StyleGuide", keywords: ["style guide", "tone of voice"] },
];

function autoActivateForText(text: string, ctx: WsContext): void {
  if (!text) return;
  const lower = text.toLowerCase();
  for (const { plugin, keywords } of KEYWORD_TRIGGERS) {
    if (keywords.some((kw) => lower.includes(kw))) {
      ctx.activatePlugin(plugin);
    }
  }
}

/**
 * Message types that don't require a running agent. Everything else is
 * silently dropped while AI is disabled (the frontend hides UI for those
 * features, but defend the server too in case a stale client sends one).
 */
const NON_AI_MESSAGE_TYPES = new Set<ClientMsg["type"]>([
  "list_workspace",
  "file_open",
  "file_save",
  "file_create",
  "folder_create",
  "folder_rename",
  "file_rename",
  "file_delete",
  "open_in_finder",
  "backlinks_request",
  "get_filetree_expanded",
  "set_filetree_expanded",
  "editor_context",
]);

async function dispatch(
  msg: ClientMsg,
  ctx: WsContext,
  ws: ServerWebSocket<unknown>,
  aiEnabled: () => boolean,
): Promise<void> {
  if (!aiEnabled() && !NON_AI_MESSAGE_TYPES.has(msg.type)) return;
  autoActivateForMessage(msg, ctx);
  switch (msg.type) {
    case "send": {
      const original = msg.text.trim();
      if (!original) return;
      // Agent is executing a plan step — queue message for after completion
      if (ctx.planning.isLocked) return;
      autoActivateForText(original, ctx);
      ctx.workspaceDb.appendChatMessage("user", original);
      const mentionPattern = /@([\w\-./ ]+\.md)/g;
      const mentions = [...original.matchAll(mentionPattern)].map((m) => m[1]!.trim());
      let fullText = original;
      if (mentions.length > 0) {
        const blocks = (
          await Promise.all(
            mentions.map(async (rel) => {
              const abs = ctx.resolveWorkspacePath(rel);
              if (!abs) return null;
              try {
                const content = await Bun.file(abs).text();
                return `[File: ${rel}]\n\`\`\`\n${content}\n\`\`\``;
              } catch {
                return null;
              }
            }),
          )
        )
          .filter((b): b is string => b !== null)
          .join("\n\n");
        if (blocks) fullText = `${blocks}\n\n---\n${original}`;
      }
      ctx.agent.addDirect(fullText);
      return;
    }

    case "interrupt":
      ctx.agent.interrupt();
      return;

    case "list_workspace":
    case "file_open":
    case "file_save":
    case "file_create":
    case "folder_create":
    case "folder_rename":
    case "file_rename":
    case "file_delete":
    case "open_in_finder":
    case "backlinks_request":
    case "get_filetree_expanded":
    case "set_filetree_expanded":
      return handleFile(msg, ctx, ws);

    case "editor_context":
    case "autocomplete_request":
    case "metadata_request":
    case "toc_request":
    case "diagram_request":
      return handleEditor(msg, ctx, ws);

    case "ai_fill_request":
      return handleAIFill(msg, ctx, ws);

    case "ingest_url":
    case "ingest_pdf":
    case "search_request":
    case "detect_gaps_request":
    case "contradictions_request":
    case "contradiction_scan_request":
    case "graph_request":
    case "reindex_request":
    case "check_citations_request":
    case "format_citation_request":
      return handleResearch(msg, ctx, ws);

    case "analyze_image":
    case "explain_code":
    case "voice_data":
      return handleMedia(msg, ctx, ws);

    case "plan_request":
    case "plan_from_document":
    case "plan_approve":
    case "plan_approve_step":
    case "plan_retry_step":
    case "plan_skip_step":
    case "plan_amend_steps":
    case "plan_edit_step_summary":
    case "plan_edit_step_instruction":
    case "plan_add_step":
    case "plan_reorder_step":
    case "plan_pause":
    case "plan_resume":
    case "plan_resume_auto":
    case "plan_cancel":
      return handlePlan(msg, ctx, ws);

    case "permission_response":
      ctx.permissionManager.resolveDecision(msg.id, msg.decision);
      return;

    default:
      assertNever(msg);
  }
}

export interface StartServerOptions {
  /** No config.json existed on disk — the workspace needs onboarding. */
  isFirstLaunch: boolean;
  /** Whether the agent should be started at boot. False when onboarding is
   *  pending or the user has opted into editor-only mode. */
  aiEnabled: boolean;
}

export async function startEpistemServer(
  bundle: EpistemeAgentBundle,
  workspaceRoot: string,
  config: EpistemeConfig,
  port: number,
  options: StartServerOptions,
): Promise<void> {
  const {
    agent, editorContext, workspace, styleGuide, research,
    citation, diagram, aiFill, contradiction, planning: planningPlugin, workspaceDb,
    permissionManager,
  } = bundle;
  const absRoot = resolve(workspaceRoot);

  // Mutable: flipped to true after agent.start() succeeds. The onboarding
  // endpoint can transition it from false → true at runtime.
  let agentStarted = false;
  let onboardingRequired = options.isFirstLaunch;

  const autocomplete = new AutocompleteRunner(config);

  const clients = new Set<ServerWebSocket<unknown>>();

  function broadcast(msg: ServerMsg): void {
    const payload = JSON.stringify(msg);
    for (const ws of clients) ws.send(payload);
  }

  function send(ws: ServerWebSocket<unknown>, msg: ServerMsg): void {
    ws.send(JSON.stringify(msg));
  }

  // Now that broadcast is defined, redirect permission prompts to the UI.
  permissionManager.setSend((msg) => broadcast(msg as ServerMsg));

  const planning = new PlanningController(
    createProvider(featureModel(config, "default")),
    agent,
    planningPlugin,
    workspaceDb,
    broadcast,
  );

  // Tracks absolute paths that were just written by Episteme itself so the
  // file watcher can skip events caused by our own saves.
  const recentSelfWrites = new Map<string, number>();

  // Debounce workspace file-list broadcasts so rapid consecutive tool calls
  // don't each trigger a full directory scan.
  let workspaceRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  function scheduleWorkspaceRefresh(): void {
    if (workspaceRefreshTimer) clearTimeout(workspaceRefreshTimer);
    workspaceRefreshTimer = setTimeout(() => {
      Promise.all([collectMarkdownFiles(absRoot), collectSubdirectories(absRoot)]).then(([files, folders]) =>
        broadcast({ type: "workspace_files", files, folders }),
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
    aiFill,
    styleGuide,
    contradiction,
    planning,
    workspaceDb,
    config,
    absRoot,
    autocomplete,
    broadcast,
    send,
    collectMarkdownFiles: () => collectMarkdownFiles(absRoot),
    collectSubdirectories: () => collectSubdirectories(absRoot),
    resolveWorkspacePath,
    scheduleWorkspaceRefresh,
    suppressExternalChange: (absolutePath: string) => {
      recentSelfWrites.set(absolutePath, Date.now());
    },
    activatePlugin: (name: string) => { bundle.activatePlugin(name); },
    permissionManager,
  };

  // Broadcast active-plugin changes so the chat sidecar can show inline events.
  bundle.onActiveChange = (active) => {
    broadcast({
      type: "agent_mode_changed",
      activePlugins: active,
      availablePlugins: [...bundle.availablePlugins],
    });
  };

  workspace.setIndexProgressListener((indexed, total) => {
    broadcast({ type: "index_progress", indexed, total });
  });

  contradiction.onBackgroundFindings = (count) => {
    broadcast({ type: "contradiction_notification", count });
  };

  watch(absRoot, { recursive: true }, async (_, filename) => {
    if (typeof filename !== "string" || !filename.endsWith(".md")) return;
    const absPath = join(absRoot, filename);
    const suppressedAt = recentSelfWrites.get(absPath);
    if (suppressedAt !== undefined && Date.now() - suppressedAt < 2000) return;
    try {
      const content = await Bun.file(absPath).text();
      broadcast({ type: "file_externally_changed", path: filename, content });
    } catch {
      // file deleted or temporarily unreadable — ignore
    }
  });

  // Tick metrics: rolling window of the last 50 ticks, exposed at /api/metrics.
  const tickMetrics = new TickMetricsAggregator(50);
  agent.on("tick_metrics", (m) => tickMetrics.record(m));

  // ── LLM provider health monitor ────────────────────────────────────────────
  // Periodically probes the LLM backend (Ollama) and broadcasts state changes
  // so the UI can render a banner / sidecar badge. Also probes immediately
  // whenever the agent emits an error, so the UI updates without waiting for
  // the next interval.
  const providerEndpoint = process.env["OLLAMA_URL"] ?? "http://127.0.0.1:11434";
  const healthProbe = createProvider(featureModel(config, "default"));
  let lastProviderReachable: boolean | null = null;
  async function probeProvider(reason?: string): Promise<boolean> {
    const reachable = await healthProbe.isReachable(1500);
    if (reachable !== lastProviderReachable) {
      lastProviderReachable = reachable;
      broadcast({
        type: "provider_status",
        reachable,
        endpoint: providerEndpoint,
        reason: reachable ? undefined : reason ?? "Backend is not responding",
      });
    }
    return reachable;
  }
  // Initial probe + 10s heartbeat.
  probeProvider();
  setInterval(() => probeProvider(), 10_000);

  agent.on("error", (err: Error) => {
    broadcast({ type: "error", message: err.message });
    // Connection-class errors → re-probe immediately so the UI flips to offline.
    probeProvider(err.message);
  });
  agent.on("empty_response", (details) => {
    broadcast({
      type: "empty_response",
      attempt: details.attempt,
      hadThinking: details.hadThinking,
      failed: details.failed,
    });
  });
  agent.on("speak", (text) => {
    workspaceDb.appendChatMessage("assistant", text);
    broadcast({ type: "speak", text });
    autoActivateForText(text, ctx);
  });
  agent.on("state_change", (state) => broadcast({ type: "state_change", state }));
  agent.on("tool_call", (name, args) => broadcast({ type: "tool_call", name, args }));
  const FILE_MUTATING_TOOLS = new Set([
    "write_file", "append_file", "patch_file", "move_file", "delete_file", "create_file",
  ]);
  agent.on("tool_result", (name: string, error?: string) => {
    broadcast({ type: "tool_result", name, error });
    workspaceDb.appendChatEvent({
      role: "tool",
      name,
      status: error ? "error" : "done",
      error,
    });
    if (!error && FILE_MUTATING_TOOLS.has(name)) {
      scheduleWorkspaceRefresh();
    }
  });

  async function startAgent(): Promise<void> {
    if (agentStarted) return;
    await agent.start();
    bundle.shortTermMemory.seed(
      bundle.workspaceDb
        .listChatMessages(200)
        .flatMap((r) =>
          r.role === "user" || r.role === "assistant"
            ? [{ role: r.role, content: r.text }]
            : [],
        ),
    );
    await workspace.index();
    agentStarted = true;
  }

  if (options.aiEnabled) {
    await startAgent();
  }

  const server = Bun.serve({
    port,
    routes: {
      "/": index,
      "/api/health": {
        GET: () =>
          json({
            status: "ok",
            app: "episteme",
            workspace: workspaceRoot,
            onboarding: { required: onboardingRequired },
            aiEnabled: agentStarted,
          }),
      },
      "/api/metrics": {
        GET: () => {
          const snap = tickMetrics.snapshot();
          const registeredTools = agent.getAvailableTools().map((t) => t.name).sort();
          const calledNames = new Set(snap.toolsCalled.map((r) => r.name));
          const neverCalled = registeredTools.filter((n) => !calledNames.has(n));
          return json({
            ...snap,
            registeredToolCount: registeredTools.length,
            registeredTools,
            neverCalled,
            plugins: agent.getRegisteredPlugins(),
          });
        },
      },
      "/api/agent-mode": {
        GET: () => json({
          activePlugins: [...bundle.activePlugins],
          availablePlugins: [...bundle.availablePlugins],
        }),
        POST: async (req: Request) => {
          try {
            const body = await req.json() as {
              activate?: string;
              deactivate?: string;
            };
            if (typeof body.activate === "string") {
              if (!bundle.availablePlugins.includes(body.activate)) {
                return json({ error: `Unknown plugin "${body.activate}".` }, 400);
              }
              bundle.activatePlugin(body.activate);
            } else if (typeof body.deactivate === "string") {
              if (!bundle.availablePlugins.includes(body.deactivate)) {
                return json({ error: `Unknown plugin "${body.deactivate}".` }, 400);
              }
              bundle.deactivatePlugin(body.deactivate);
            } else {
              return json({ error: "Body must contain { activate } or { deactivate }." }, 400);
            }
            return json({
              activePlugins: [...bundle.activePlugins],
              availablePlugins: [...bundle.availablePlugins],
            });
          } catch {
            return json({ error: "Invalid JSON body" }, 400);
          }
        },
      },
      "/api/style-guide": {
        GET: () => json({ content: styleGuide.currentContent }),
        PATCH: async (req: Request) => {
          try {
            const content = await req.text();
            await styleGuide.save(content);
            bundle.activatePlugin("StyleGuide");
            return json({ success: true });
          } catch {
            return json({ error: "Failed to save style guide" }, 500);
          }
        },
      },
      "/api/models": {
        GET: async (req: Request) => {
          try {
            const ollamaHost = process.env["OLLAMA_URL"] ?? "http://127.0.0.1:11434";
            const res = await fetch(`${ollamaHost}/api/tags`);
            if (!res.ok) return json({ models: [] });
            const data = (await res.json()) as { models?: Array<{ name: string }> };
            const names = (data.models ?? []).map((m) => m.name).sort();

            const url = new URL(req.url);
            const capability = url.searchParams.get("capability");
            if (!capability) return json({ models: names });

            // Filter by capability via /api/show fanout. Ollama doesn't expose
            // a server-side capability filter, so we N+1 it ourselves. Cheap
            // in practice — typical users have < 50 local models, and /api/show
            // is fast (metadata-only, no model load).
            const checks = await Promise.all(
              names.map(async (name): Promise<string | null> => {
                try {
                  const showRes = await fetch(`${ollamaHost}/api/show`, {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ model: name }),
                  });
                  if (!showRes.ok) return null;
                  const showData = (await showRes.json()) as { capabilities?: string[] };
                  return showData.capabilities?.includes(capability) ? name : null;
                } catch {
                  return null;
                }
              }),
            );
            return json({ models: checks.filter((n): n is string => n !== null) });
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
            let dirty = false;
            if (body.models) {
              Object.assign(config.models, body.models);
              dirty = true;
            }
            if (body.features !== undefined) {
              config.features = { ...config.features, ...body.features };
              dirty = true;
            }
            if (body.ollamaBaseUrl !== undefined) {
              const trimmed = body.ollamaBaseUrl.trim();
              config.ollamaBaseUrl = trimmed || undefined;
              process.env.OLLAMA_URL = trimmed || "http://127.0.0.1:11434";
              dirty = true;
            }
            if (body.permissions !== undefined) {
              config.permissions = { ...body.permissions };
              permissionManager.setModes(config.permissions);
              dirty = true;
            }
            let restartRequired = false;
            if (body.aiEnabled !== undefined) {
              // Hot-toggle is unsafe: turning AI off mid-session would orphan a
              // running CortexAgent; turning it on needs index init that's
              // safest from a clean boot. Persist and let the UI prompt for
              // restart.
              if (config.aiEnabled !== body.aiEnabled) {
                config.aiEnabled = body.aiEnabled;
                restartRequired = true;
                dirty = true;
              }
            }
            if (dirty) await saveConfig(workspaceRoot, config);
            return json({ ...config, restartRequired });
          } catch {
            return json({ error: "Invalid JSON body" }, 400);
          }
        },
      },
      "/api/onboarding/complete": {
        POST: async (req: Request) => {
          if (!onboardingRequired) {
            return json({ error: "Onboarding already complete." }, 409);
          }
          try {
            const body = (await req.json()) as {
              aiEnabled: boolean;
              models?: { default?: string; embedding?: string };
              ollamaBaseUrl?: string;
            };
            if (body.aiEnabled) {
              if (!body.models?.default) {
                return json({ error: "models.default is required when enabling AI." }, 400);
              }
              config.models.default = body.models.default;
              if (body.models.embedding) config.models.embedding = body.models.embedding;
              if (body.ollamaBaseUrl) {
                const trimmed = body.ollamaBaseUrl.trim();
                config.ollamaBaseUrl = trimmed || undefined;
                process.env.OLLAMA_URL = trimmed || "http://127.0.0.1:11434";
              }
              config.aiEnabled = true;
            } else {
              config.aiEnabled = false;
            }
            await saveConfig(workspaceRoot, config);
            onboardingRequired = false;
            if (config.aiEnabled) {
              await startAgent();
              broadcast({ type: "state_change", state: "idle" });
            }
            return json({ ...config, aiEnabled: agentStarted });
          } catch {
            return json({ error: "Invalid JSON body" }, 400);
          }
        },
      },
      "/api/tools": {
        GET: () => {
          // Tools annotated permission !== "none" — these are the ones the
          // settings UI surfaces in its Permissions section.
          const tools = agent.getAvailableTools()
            .filter((t) => t.permission && t.permission !== "none")
            .map((t) => ({
              name: t.name,
              description: t.description,
              permission: t.permission,
            }))
            .sort((a, b) => a.name.localeCompare(b.name));
          return json({ tools });
        },
      },
      "/api/chat-history": {
        GET: () => json(workspaceDb.listChatMessages(200)),
      },
      "/api/chat-history/:id": {
        DELETE: (req: Request) => {
          const idParam = (req as Request & { params: Record<string, string> }).params.id;
          const id = parseInt(idParam ?? "", 10);
          if (isNaN(id)) return json({ error: "Invalid id" }, 400);
          workspaceDb.deleteChatMessage(id);
          return json({ ok: true });
        },
        PATCH: async (req: Request) => {
          const idParam = (req as Request & { params: Record<string, string> }).params.id;
          const id = parseInt(idParam ?? "", 10);
          if (isNaN(id)) return json({ error: "Invalid id" }, 400);
          const body = (await req.json()) as { text?: string };
          if (typeof body.text !== "string") return json({ error: "text required" }, 400);
          const trimmed = body.text.trim();
          if (!trimmed) {
            workspaceDb.deleteChatMessage(id);
          } else {
            workspaceDb.updateChatMessage(id, trimmed);
          }
          return json({ ok: true });
        },
      },
      "/api/file-content": {
        GET: async (req: Request) => {
          const url = new URL(req.url);
          const path = url.searchParams.get("path") ?? "";
          if (!path) return json({ error: "path required" }, 400);
          const absolute = resolveWorkspacePath(path);
          if (!absolute) return json({ error: "Path escapes workspace boundary." }, 400);
          try {
            const content = await Bun.file(absolute).text();
            return json({ content });
          } catch {
            return json({ error: "File not found" }, 404);
          }
        },
      },
      "/api/search-text": {
        GET: async (req: Request) => {
          const url = new URL(req.url);
          const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
          if (q.length < 2) return json({ results: [] });
          const files = await collectMarkdownFiles(absRoot);
          const results: Array<{ path: string; matches: Array<{ line: number; text: string }> }> = [];
          for (const relPath of files) {
            const absolute = resolve(join(absRoot, relPath));
            try {
              const content = await Bun.file(absolute).text();
              const lines = content.split("\n");
              const matches: Array<{ line: number; text: string }> = [];
              for (let i = 0; i < lines.length; i++) {
                const line = lines[i] ?? "";
                if (line.toLowerCase().includes(q)) {
                  matches.push({ line: i + 1, text: line.trim().slice(0, 200) });
                  if (matches.length >= 3) break;
                }
              }
              if (matches.length > 0) {
                results.push({ path: relPath, matches });
                if (results.length >= 30) break;
              }
            } catch {
              // skip unreadable files
            }
          }
          return json({ results });
        },
      },
    },
    websocket: {
      open(ws) {
        clients.add(ws);
        if (!agentStarted) return;
        const activePlan = planningPlugin.getActivePlan();
        if (activePlan) {
          send(ws, { type: "plan_created", plan: activePlan });
          send(ws, { type: "state_change", state: activePlan.state as import("../protocol.ts").AgentRunState });
        } else {
          send(ws, { type: "state_change", state: "idle" });
        }
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
        await dispatch(msg, ctx, ws, () => agentStarted);
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

  console.log(`Episteme running at http://localhost:${server.port}`);
  console.log(`Workspace: ${workspaceRoot}`);
}

const LAST_WORKSPACE_FILE = join(homedir(), ".config", "episteme", "last-workspace");

/**
 * Minimal stub server for when no workspace is provided at startup.
 * Serves the UI so the user can pick a folder, then exits(0) so Electron
 * can restart the full server with the selected workspace.
 */
export async function startEpistemStubServer(port: number): Promise<void> {
  const server = Bun.serve({
    port,
    routes: {
      "/": index,
      "/api/health": {
        GET: () => json({ status: "ok", app: "episteme", workspace: null }),
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
    websocket: {
      open() {},
      message() {},
      close() {},
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

  console.log(`Episteme running at http://localhost:${server.port} (no workspace — waiting for folder selection)`);
}
