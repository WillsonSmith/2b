import { join, resolve } from "node:path";
import type { AgentPlugin, ToolDefinition } from "../../../core/Plugin.ts";

/**
 * Provides workspace-level file access tools to the agent.
 *
 * Phase 0: skeletons only — index and search return not-implemented stubs.
 * Phase 1: full implementation with semantic search via CortexMemoryPlugin.
 */
export class WorkspacePlugin implements AgentPlugin {
  name = "Workspace";
  private readonly root: string;

  constructor(workspaceRoot: string) {
    this.root = resolve(workspaceRoot);
  }

  getSystemPromptFragment(): string {
    return `You have access to a Markdown workspace at: ${this.root}\nUse workspace tools to index, search, and read files.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "index_workspace",
        description:
          "Crawl the workspace directory and index all Markdown (.md) files for semantic search. Run this once after opening a workspace.",
        parameters: { type: "object", properties: {}, required: [] },
      },
      {
        name: "search_workspace",
        description:
          "Semantic search across all indexed Markdown files in the workspace. Returns relevant passages with file paths.",
        parameters: {
          type: "object",
          properties: {
            query: { type: "string", description: "Natural language search query" },
          },
          required: ["query"],
        },
      },
      {
        name: "get_workspace_file",
        description: "Read the content of a file in the workspace by its path relative to the workspace root.",
        parameters: {
          type: "object",
          properties: {
            path: { type: "string", description: "Relative path to the file (e.g. 'notes/intro.md')" },
          },
          required: ["path"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    if (name === "index_workspace") {
      // Phase 1: crawl workspace, embed file summaries into CortexMemoryPlugin
      return { status: "pending", message: "Workspace indexing will be implemented in Phase 1." };
    }

    if (name === "search_workspace") {
      // Phase 1: semantic search via CortexMemoryPlugin hybrid_search
      return { status: "pending", message: "Workspace search will be implemented in Phase 1." };
    }

    if (name === "get_workspace_file") {
      const relativePath = String(args.path ?? "");
      const absolute = resolve(join(this.root, relativePath));
      if (!absolute.startsWith(this.root)) {
        return { error: "Path escapes workspace boundary." };
      }
      try {
        const content = await Bun.file(absolute).text();
        return { path: relativePath, content };
      } catch {
        return { error: `File not found: ${relativePath}` };
      }
    }
  }
}
