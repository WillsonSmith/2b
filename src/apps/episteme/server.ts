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
 *   { type: "error",                message }
 *
 * REST:
 *   GET  /api/health
 *   GET  /api/style-guide
 *   PATCH /api/style-guide    body: raw Markdown text
 *   GET  /api/config
 *   PATCH /api/config         { models }
 */
import type { ServerWebSocket } from "bun";
import { resolve, join } from "node:path";
import type { EpistemAgentBundle } from "./agent.ts";
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
import { DiagramPlugin } from "./plugins/DiagramPlugin.ts";
import type { UnifiedSearchResponse } from "./plugins/ResearchPlugin.ts";
import { queryContradictions, runContradictionScan, buildKnowledgeGraph } from "./features/contradiction.ts";
import type { ContradictionRecord, GraphData } from "./features/contradiction.ts";
import type { CitationCheckResult } from "./plugins/CitationPlugin.ts";
import type { Tone } from "./features/tone.ts";
import type { LintIssue } from "./features/lint.ts";
import type { TocEntry } from "./features/toc.ts";
import type { WikilinkSuggestion } from "./features/autolink.ts";
import index from "./index.html";

type ClientMsg =
  | { type: "send"; text: string }
  | { type: "interrupt" }
  | { type: "editor_context"; file: string; content: string; cursor: number }
  | { type: "file_open"; path: string }
  | { type: "file_save"; path: string; content: string }
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
  | { type: "format_citation_request"; url: string };

type ServerMsg =
  | { type: "speak"; text: string }
  | { type: "state_change"; state: "idle" | "thinking" }
  | { type: "tool_call"; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; name: string }
  | { type: "file_content"; path: string; content: string }
  | { type: "workspace_files"; files: string[] }
  | { type: "file_saved" }
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
  | { type: "error"; message: string };

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
  bundle: EpistemAgentBundle,
  workspaceRoot: string,
  config: EpistemeConfig,
  port: number,
): Promise<void> {
  const { agent, editorContext, styleGuide, research, citation } = bundle;
  const absRoot = resolve(workspaceRoot);

  await agent.start();

  const autocomplete = new AutocompleteRunner(config);
  const linter = new LintRunner(config);
  const diagramPlugin = new DiagramPlugin(config);

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
            const files = await collectMarkdownFiles(absRoot);
            send(ws, { type: "workspace_files", files });
            break;
          }

          case "file_open": {
            const absolute = msg.path.startsWith("/")
              ? msg.path
              : resolve(join(absRoot, msg.path));
            if (!absolute.startsWith(absRoot)) {
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
            agent.addDirect(`ingest_url ${url}`);
            send(ws, { type: "ingest_result", success: true, message: `Ingesting ${url}…` });
            break;
          }

          case "ingest_pdf": {
            const path = msg.path?.trim();
            if (!path) break;
            agent.addDirect(`ingest_pdf ${path}`);
            send(ws, { type: "ingest_result", success: true, message: `Ingesting PDF ${path}…` });
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
            const contradictions = queryContradictions(agent.memoryPlugin);
            send(ws, { type: "contradictions_data", contradictions });
            break;
          }

          case "contradiction_scan_request": {
            runContradictionScan(agent.memoryPlugin, config).then((found) => {
              const all = queryContradictions(agent.memoryPlugin);
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
            const data = buildKnowledgeGraph(agent.memoryPlugin);
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
