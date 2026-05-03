/**
 * Episteme HTTP + WebSocket server.
 *
 * WebSocket protocol (client → server):
 *   { type: "send",                text }               — chat message to agent
 *   { type: "interrupt" }                               — abort in-flight LLM call
 *   { type: "editor_context",      file, content, cursor } — editor state update
 *   { type: "file_open",           path }               — read file from workspace
 *   { type: "file_save",           path, content }      — write file to workspace
 *   { type: "list_workspace" }                          — request workspace file list
 *   { type: "autocomplete_request", context }           — request ghost-text suggestion
 *   { type: "outline_request",     topic }              — generate outline for topic
 *   { type: "ingest_url",          url }                — ingest URL via ResearchPlugin
 *   { type: "ingest_pdf",          path }               — ingest workspace PDF path
 *   { type: "tone_transform",      text, tone, from, to } — transform selection tone
 *   { type: "summarize_request",   text, insertPos }    — summarize text, insert at pos
 *   { type: "metadata_request",    title, preview }     — generate YAML frontmatter
 *   { type: "toc_request",         markdown }           — generate narrative TOC
 *   { type: "autolink_request",    markdown, files }    — detect wikilink candidates
 *   { type: "diagram_request",     description, from, to } — generate Mermaid diagram
 *   { type: "table_request",       text, insertPos }    — generate Markdown table
 *   { type: "search_request",      query }              — unified search (arXiv + Wikipedia + workspace)
 *   { type: "detect_gaps_request", topic }              — detect knowledge gaps in workspace
 *   { type: "contradictions_request" }                  — fetch stored contradictions
 *   { type: "contradiction_scan_request" }              — run a new contradiction scan now
 *   { type: "graph_request" }                           — fetch knowledge graph data
 *   { type: "check_citations_request" }                 — validate bibliography URLs
 *   { type: "format_citation_request", url }            — format a URL as BibTeX
 *   { type: "analyze_image",       base64, mimeType, filename } — generate alt text for image
 *   { type: "explain_code",        code, language }     — explain a code block
 *   { type: "voice_data",          audioBase64, mimeType } — transcribe recorded audio
 *
 * WebSocket protocol (server → client):
 *   { type: "speak",                text }
 *   { type: "state_change",         state }             — "idle" | "thinking"
 *   { type: "tool_call",            name, args }
 *   { type: "tool_result",          name }
 *   { type: "file_content",         path, content }     — response to file_open
 *   { type: "workspace_files",      files }             — list of relative .md paths
 *   { type: "file_saved" }                              — save confirmed
 *   { type: "autocomplete_suggestion", text }           — ghost-text response
 *   { type: "insert_text",          text }              — insert at cursor (outline)
 *   { type: "ingest_result",        success, message }  — ingest outcome
 *   { type: "tone_result",          text, from, to }    — transformed text + original range
 *   { type: "summarize_result",     text, insertPos }   — summary text + insertion position
 *   { type: "lint_result",          issues }            — array of LintIssue after file_save
 *   { type: "metadata_result",      yaml }              — generated YAML frontmatter
 *   { type: "toc_result",           entries }           — narrative TOC entries
 *   { type: "autolink_result",      suggestions }       — wikilink candidates
 *   { type: "diagram_result",       code, from, to }    — Mermaid code + original range
 *   { type: "table_result",         text, insertPos }   — Markdown table + insertion pos
 *   { type: "search_result",        results }           — unified search response
 *   { type: "detect_gaps_result",   markdown }          — gap report as Markdown
 *   { type: "contradictions_data",  contradictions }    — stored contradiction records
 *   { type: "graph_data",           nodes, links }      — knowledge graph data
 *   { type: "check_citations_result", valid, broken }   — citation validation result
 *   { type: "format_citation_result", bibtex }          — formatted BibTeX entry
 *   { type: "alt_text",             text, mimeType, base64 } — generated alt text + image data
 *   { type: "explain_code_result",  explanation }       — code explanation
 *   { type: "transcript",           text }              — voice transcription result
 *   { type: "error",                message }
 *
 * REST:
 *   GET  /api/health
 *   GET  /api/style-guide
 *   PATCH /api/style-guide    body: raw Markdown text
 *   GET  /api/config
 *   PATCH /api/config         { models }
 *   POST /api/export          { filePath, format, includeFrontmatter }
 *   GET  /api/exports/:filename
 */
import type { ServerWebSocket } from "bun";
import { resolve, join, basename, dirname } from "node:path";
import { tmpdir, homedir } from "node:os";
import { rename as fsRename, mkdir } from "node:fs/promises";
import type { EpistemeAgentBundle } from "./agent.ts";
import type { EpistemeConfig } from "./config.ts";
import { saveConfig } from "./config.ts";
import { AutocompleteRunner } from "./features/autocomplete.ts";
import { generateOutline } from "./features/outline.ts";
import { transformTone } from "./features/tone.ts";
import { summarizeSection } from "./features/summarize.ts";
import { LintRunner } from "./features/lint.ts";
import { generateFrontmatter } from "./features/metadata.ts";
import { generateNarrativeToc, extractSectionsFromMarkdown } from "./features/toc.ts";
import { detectAutolinkCandidates } from "./features/autolink.ts";
import { generateTable } from "./features/table.ts";
import type { UnifiedSearchResponse } from "./plugins/ResearchPlugin.ts";
import { queryContradictions, runContradictionScan, buildKnowledgeGraph } from "./features/contradiction.ts";
import type { ContradictionRecord, GraphData } from "./features/contradiction.ts";
import type { CitationCheckResult } from "./plugins/CitationPlugin.ts";
import type { Tone } from "./features/tone.ts";
import type { LintIssue } from "./features/lint.ts";
import type { TocEntry } from "./features/toc.ts";
import type { WikilinkSuggestion } from "./features/autolink.ts";
import { checkPandoc, exportDocument, pandocAvailable } from "./features/export.ts";
import { explainCode } from "./features/explain.ts";
import index from "./index.html";

type ClientMsg =
  | { type: "send"; text: string }
  | { type: "interrupt" }
  | { type: "editor_context"; file: string; content: string; cursor: number }
  | { type: "file_open"; path: string }
  | { type: "file_save"; path: string; content: string }
  | { type: "file_create"; path: string }
  | { type: "file_rename"; oldPath: string; newPath: string }
  | { type: "list_workspace" }
  | { type: "autocomplete_request"; context: string }
  | { type: "outline_request"; topic: string }
  | { type: "ingest_url"; url: string }
  | { type: "ingest_pdf"; path: string }
  | { type: "tone_transform"; text: string; tone: Tone; from: number; to: number }
  | { type: "summarize_request"; text: string; insertPos: number }
  | { type: "metadata_request"; title: string; preview: string }
  | { type: "toc_request"; markdown: string }
  | { type: "autolink_request"; markdown: string; files: string[] }
  | { type: "diagram_request"; description: string; from: number; to: number }
  | { type: "table_request"; text: string; insertPos: number }
  | { type: "search_request"; query: string }
  | { type: "detect_gaps_request"; topic: string }
  | { type: "contradictions_request" }
  | { type: "contradiction_scan_request" }
  | { type: "graph_request" }
  | { type: "check_citations_request" }
  | { type: "format_citation_request"; url: string }
  | { type: "analyze_image"; base64: string; mimeType: string; filename: string }
  | { type: "explain_code"; code: string; language: string }
  | { type: "voice_data"; audioBase64: string; mimeType: string };

type ServerMsg =
  | { type: "speak"; text: string }
  | { type: "state_change"; state: "idle" | "thinking" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string }
  | { type: "file_content"; path: string; content: string }
  | { type: "workspace_files"; files: string[] }
  | { type: "file_saved" }
  | { type: "file_created"; path: string }
  | { type: "file_renamed"; oldPath: string; newPath: string }
  | { type: "autocomplete_suggestion"; text: string }
  | { type: "insert_text"; text: string }
  | { type: "ingest_result"; success: boolean; message: string }
  | { type: "tone_result"; text: string; from: number; to: number }
  | { type: "summarize_result"; text: string; insertPos: number }
  | { type: "lint_result"; issues: LintIssue[] }
  | { type: "metadata_result"; yaml: string }
  | { type: "toc_result"; entries: TocEntry[] }
  | { type: "autolink_result"; suggestions: WikilinkSuggestion[] }
  | { type: "diagram_result"; code: string; from: number; to: number }
  | { type: "table_result"; text: string; insertPos: number }
  | { type: "search_result"; results: UnifiedSearchResponse }
  | { type: "detect_gaps_result"; markdown: string }
  | { type: "contradictions_data"; contradictions: ContradictionRecord[] }
  | { type: "graph_data"; data: GraphData }
  | { type: "check_citations_result"; result: CitationCheckResult }
  | { type: "format_citation_result"; bibtex: string }
  | { type: "alt_text"; text: string; mimeType: string; base64: string }
  | { type: "explain_code_result"; explanation: string }
  | { type: "transcript"; text: string }
  | { type: "error"; message: string };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function isWithinWorkspace(absPath: string, root: string): boolean {
  return absPath === root || absPath.startsWith(root + "/");
}

function resolveWorkspacePath(root: string, inputPath: string): string | null {
  const absolute = inputPath.startsWith("/") ? inputPath : resolve(join(root, inputPath));
  return isWithinWorkspace(absolute, root) ? absolute : null;
}

/** Recursively collect all .md file paths within a directory. */
async function collectMarkdownFiles(dir: string): Promise<string[]> {
  const results: string[] = [];
  const glob = new Bun.Glob("**/*.md");
  for await (const match of glob.scan({ cwd: dir, dot: false })) {
    if (!match.startsWith(".episteme")) results.push(match);
  }
  return results.sort();
}

export async function startEpistemServer(
  bundle: EpistemeAgentBundle,
  workspaceRoot: string,
  config: EpistemeConfig,
  port: number,
): Promise<void> {
  const { agent, editorContext, workspace, styleGuide, research, citation, diagram: diagramPlugin, workspaceDb } = bundle;
  const absRoot = resolve(workspaceRoot);

  await agent.start();
  await workspace.index();
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
      collectMarkdownFiles(absRoot).then((files) => broadcast({ type: "workspace_files", files }));
    }, 200);
  }

  agent.on("speak", (text) => broadcast({ type: "speak", text }));
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
            const absolute = resolveWorkspacePath(absRoot, filePath);
            if (!absolute) {
              return json({ error: "Path escapes workspace boundary." }, 400);
            }
            const content = await Bun.file(absolute).text();
            const filename = filePath.split("/").at(-1) ?? "export.md";
            const result = await exportDocument(content, filename, { format, includeFrontmatter });
            // Schedule cleanup after 60 seconds
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
          // Basic sanitization — no path traversal
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
            const files = await collectMarkdownFiles(absRoot);
            send(ws, { type: "workspace_files", files });
            break;
          }

          case "file_open": {
            const absolute = resolveWorkspacePath(absRoot, msg.path);
            if (!absolute) {
              send(ws, { type: "error", message: "Path escapes workspace boundary." });
              return;
            }
            try {
              const content = await Bun.file(absolute).text();
              send(ws, { type: "file_content", path: msg.path, content });
            } catch {
              send(ws, { type: "error", message: `Cannot open: ${msg.path}` });
            }
            break;
          }

          case "file_save": {
            const absolute = resolveWorkspacePath(absRoot, msg.path);
            if (!absolute) {
              send(ws, { type: "error", message: "Path escapes workspace boundary." });
              return;
            }
            try {
              await Bun.write(absolute, msg.content);
              send(ws, { type: "file_saved" });
              // Async lint — non-blocking, only send to the saving client
              linter.run(msg.content).then((issues) => {
                send(ws, { type: "lint_result", issues });
              }).catch(() => {});
              // Async autolink detection after save
              collectMarkdownFiles(absRoot).then((files) => {
                const suggestions = detectAutolinkCandidates(msg.content, files);
                if (suggestions.length > 0) {
                  send(ws, { type: "autolink_result", suggestions });
                }
              }).catch(() => {});
            } catch {
              send(ws, { type: "error", message: `Cannot save: ${msg.path}` });
            }
            break;
          }

          case "file_create": {
            const absolute = resolveWorkspacePath(absRoot, msg.path);
            if (!absolute) {
              send(ws, { type: "error", message: "Path escapes workspace boundary." });
              return;
            }
            try {
              const file = Bun.file(absolute);
              if (await file.exists()) {
                send(ws, { type: "error", message: `File already exists: ${msg.path}` });
                break;
              }
              await mkdir(dirname(absolute), { recursive: true });
              await Bun.write(absolute, "");
              const relPath = absolute.slice(absRoot.length + 1);
              send(ws, { type: "file_created", path: relPath });
              const files = await collectMarkdownFiles(absRoot);
              send(ws, { type: "workspace_files", files });
            } catch {
              send(ws, { type: "error", message: `Cannot create: ${msg.path}` });
            }
            break;
          }

          case "file_rename": {
            const absOld = resolveWorkspacePath(absRoot, msg.oldPath);
            const absNew = resolveWorkspacePath(absRoot, msg.newPath);
            if (!absOld || !absNew) {
              send(ws, { type: "error", message: "Path escapes workspace boundary." });
              return;
            }
            try {
              await mkdir(dirname(absNew), { recursive: true });
              await fsRename(absOld, absNew);
              const relOld = absOld.slice(absRoot.length + 1);
              const relNew = absNew.slice(absRoot.length + 1);
              send(ws, { type: "file_renamed", oldPath: relOld, newPath: relNew });
              const files = await collectMarkdownFiles(absRoot);
              send(ws, { type: "workspace_files", files });
            } catch {
              send(ws, { type: "error", message: `Cannot rename: ${msg.oldPath}` });
            }
            break;
          }

          case "autocomplete_request": {
            if (!msg.context?.trim()) break;
            autocomplete.suggest(msg.context).then((text) => {
              if (text.trim()) send(ws, { type: "autocomplete_suggestion", text: text.trim() });
            }).catch(() => {});
            break;
          }

          case "outline_request": {
            const topic = msg.topic?.trim();
            if (!topic) break;
            generateOutline(topic, config).then((outline) => {
              broadcast({ type: "insert_text", text: outline });
            }).catch(() => {});
            break;
          }

          case "ingest_url": {
            const url = msg.url?.trim();
            if (!url) break;
            // Strip control characters to prevent prompt injection via crafted URLs
            const safeUrl = url.replace(/[\n\r\t]/g, "");
            agent.addDirect(`Call the ingest_url tool with url: ${JSON.stringify(safeUrl)}`);
            send(ws, { type: "ingest_result", success: true, message: `Ingesting ${safeUrl}…` });
            break;
          }

          case "ingest_pdf": {
            const path = msg.path?.trim();
            if (!path) break;
            const safePath = path.replace(/[\n\r\t]/g, "");
            agent.addDirect(`Call the ingest_pdf tool with path: ${JSON.stringify(safePath)}`);
            send(ws, { type: "ingest_result", success: true, message: `Ingesting PDF ${safePath}…` });
            break;
          }

          case "tone_transform": {
            const { text, tone, from, to } = msg;
            if (!text?.trim()) break;
            transformTone(text, tone, config).then((result) => {
              send(ws, { type: "tone_result", text: result.trim(), from, to });
            }).catch(() => {});
            break;
          }

          case "summarize_request": {
            const { text, insertPos } = msg;
            if (!text?.trim()) break;
            summarizeSection(text, config).then((result) => {
              send(ws, { type: "summarize_result", text: result.trim(), insertPos });
            }).catch(() => {});
            break;
          }

          case "metadata_request": {
            const { title, preview } = msg;
            if (!preview?.trim() && !title?.trim()) break;
            generateFrontmatter(title ?? "", preview ?? "", config).then((yaml) => {
              send(ws, { type: "metadata_result", yaml });
            }).catch(() => {
              send(ws, { type: "error", message: "Failed to generate frontmatter." });
            });
            break;
          }

          case "toc_request": {
            const { markdown } = msg;
            if (!markdown?.trim()) break;
            const sections = extractSectionsFromMarkdown(markdown);
            generateNarrativeToc(sections, config).then((entries) => {
              send(ws, { type: "toc_result", entries });
            }).catch(() => {
              send(ws, { type: "error", message: "Failed to generate TOC." });
            });
            break;
          }

          case "autolink_request": {
            const { markdown, files } = msg;
            if (!markdown?.trim()) break;
            const suggestions = detectAutolinkCandidates(markdown, files ?? []);
            send(ws, { type: "autolink_result", suggestions });
            break;
          }

          case "diagram_request": {
            const { description, from, to } = msg;
            if (!description?.trim()) break;
            diagramPlugin.generate(description).then((code) => {
              send(ws, { type: "diagram_result", code, from, to });
            }).catch(() => {
              send(ws, { type: "error", message: "Failed to generate diagram." });
            });
            break;
          }

          case "table_request": {
            const { text, insertPos } = msg;
            if (!text?.trim()) break;
            generateTable(text, config).then((result) => {
              send(ws, { type: "table_result", text: result.trim(), insertPos });
            }).catch(() => {
              send(ws, { type: "error", message: "Failed to generate table." });
            });
            break;
          }

          case "search_request": {
            const query = msg.query?.trim();
            if (!query) break;
            research.unifiedSearch(query).then((results) => {
              send(ws, { type: "search_result", results });
            }).catch(() => {
              send(ws, { type: "error", message: "Search failed." });
            });
            break;
          }

          case "detect_gaps_request": {
            const topic = msg.topic?.trim();
            if (!topic) break;
            research.detectGaps(topic).then((markdown) => {
              send(ws, { type: "detect_gaps_result", markdown });
            }).catch(() => {
              send(ws, { type: "error", message: "Gap detection failed." });
            });
            break;
          }

          case "contradictions_request": {
            const contradictions = queryContradictions(workspaceDb);
            send(ws, { type: "contradictions_data", contradictions });
            break;
          }

          case "contradiction_scan_request": {
            runContradictionScan(agent.memoryPlugin, config, workspaceDb).then((found) => {
              const all = queryContradictions(workspaceDb);
              send(ws, { type: "contradictions_data", contradictions: all });
              if (found.length > 0) {
                send(ws, { type: "speak", text: `Contradiction scan complete — ${found.length} new conflict(s) found.` });
              }
            }).catch(() => {
              send(ws, { type: "error", message: "Contradiction scan failed." });
            });
            break;
          }

          case "graph_request": {
            const data = buildKnowledgeGraph(agent.memoryPlugin, workspaceDb);
            send(ws, { type: "graph_data", data });
            break;
          }

          case "check_citations_request": {
            citation.checkCitations().then((result) => {
              send(ws, { type: "check_citations_result", result });
            }).catch(() => {
              send(ws, { type: "error", message: "Citation check failed." });
            });
            break;
          }

          case "format_citation_request": {
            const url = msg.url?.trim();
            if (!url) break;
            citation.formatCitation(url).then((bibtex) => {
              send(ws, { type: "format_citation_result", bibtex });
            }).catch(() => {
              send(ws, { type: "error", message: "Citation formatting failed." });
            });
            break;
          }

          case "analyze_image": {
            const { base64, mimeType, filename } = msg;
            if (!base64) break;
            // Write image to temp file for processing
            const ext = (mimeType.split("/")[1] ?? "png").replace(/[^a-z0-9]/gi, "").slice(0, 10) || "png";
            const imagePath = join(tmpdir(), `episteme-img-${Date.now()}.${ext}`);
            try {
              const imageBuffer = Buffer.from(base64, "base64");
              await Bun.write(imagePath, imageBuffer);
              // Generate alt text from filename hint via LLM
              const hint = filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
              const { HeadlessAgent } = await import("../../core/HeadlessAgent.ts");
              const { createProvider } = await import("../../providers/llm/createProvider.ts");
              const { featureModel } = await import("./config.ts");
              const llm = createProvider(featureModel(config, "default"));
              const altAgent = new HeadlessAgent(
                llm,
                [],
                "You generate concise descriptive alt text for images. Return ONLY the alt text — no quotes, no punctuation at the end, no explanation.",
                { agentName: "AltTextGenerator" },
              );
              const altText = (await altAgent.ask(
                `Generate short descriptive alt text for an image. The filename is: "${hint}". Alt text:`,
              )).trim().replace(/^["']|["']$/g, "");
              send(ws, { type: "alt_text", text: altText, mimeType, base64 });
            } catch {
              // Fallback: use filename as alt text
              const fallback = filename.replace(/\.[^.]+$/, "").replace(/[-_]/g, " ").trim();
              send(ws, { type: "alt_text", text: fallback, mimeType, base64 });
            } finally {
              await Bun.$`rm -f ${imagePath}`.quiet().catch(() => {});
            }
            break;
          }

          case "explain_code": {
            const { code, language } = msg;
            if (!code?.trim()) break;
            explainCode(code, language ?? "text", config).then((explanation) => {
              send(ws, { type: "explain_code_result", explanation });
            }).catch(() => {
              send(ws, { type: "error", message: "Failed to explain code." });
            });
            break;
          }

          case "voice_data": {
            const { audioBase64, mimeType } = msg;
            if (!audioBase64) break;

            // Check whisper availability
            const whisperCheck = await Bun.$`which whisper`.quiet().catch(() => null);
            if (!whisperCheck || whisperCheck.exitCode !== 0) {
              send(ws, {
                type: "error",
                message: "Whisper not installed. Run: pip install openai-whisper",
              });
              break;
            }

            try {
              const ext = mimeType.includes("mp4") ? "mp4" : mimeType.includes("ogg") ? "ogg" : "webm";
              const stamp = Date.now();
              const audioPath = join(tmpdir(), `episteme-voice-${stamp}.${ext}`);
              const audioBuffer = Buffer.from(audioBase64, "base64");
              await Bun.write(audioPath, audioBuffer);

              // Convert to mp3 via ffmpeg if available
              let transcribeInput = audioPath;
              const ffmpegCheck = await Bun.$`which ffmpeg`.quiet().catch(() => null);
              if (ffmpegCheck && ffmpegCheck.exitCode === 0 && ext !== "mp3") {
                const mp3Path = join(tmpdir(), `episteme-voice-${stamp}.mp3`);
                await Bun.$`ffmpeg -i ${audioPath} -q:a 0 -map a ${mp3Path} -y`.quiet();
                transcribeInput = mp3Path;
              }

              const outputDir = join(tmpdir(), "episteme-whisper");
              await Bun.$`mkdir -p ${outputDir}`.quiet();
              await Bun.$`whisper ${transcribeInput} --model base --output_format txt --output_dir ${outputDir}`.quiet();

              const txtFile = join(outputDir, basename(transcribeInput).replace(/\.[^.]+$/, ".txt"));
              const transcript = (await Bun.file(txtFile).text().catch(() => "")).trim();

              // Cleanup
              await Bun.$`rm -f ${audioPath} ${transcribeInput} ${txtFile}`.quiet().catch(() => {});

              if (transcript) {
                send(ws, { type: "transcript", text: transcript });
              } else {
                send(ws, { type: "error", message: "Could not transcribe audio." });
              }
            } catch {
              send(ws, { type: "error", message: "Voice transcription failed." });
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
            // Exit cleanly; Electron main process will restart with the new workspace
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
