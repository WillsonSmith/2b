import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { logger } from "../logger.ts";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdir, readdir, unlink, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const MAX_SCRATCH_FILE_BYTES = 1 * 1024 * 1024; // 1 MB per file
const SCRATCH_OP_TIMEOUT_MS = 10_000; // 10 s

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let id: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}

/**
 * Validates a scratch file name: alphanumeric, hyphens, underscores, and dots only.
 * Blocks path traversal and the bare "." name.
 */
function isValidName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 64 &&
    /^[a-zA-Z0-9_\-.]+$/.test(name) &&
    !name.includes("..") &&
    name !== "."
  );
}

export class ScratchPlugin implements AgentPlugin {
  name = "Scratch";

  readonly sessionDir: string;
  private initialized = false;

  constructor(sessionId?: string) {
    this.sessionDir = join(tmpdir(), `agent-${sessionId ?? randomUUID()}`);
  }

  private async ensureDir(): Promise<void> {
    if (!this.initialized) {
      await mkdir(this.sessionDir, { recursive: true });
      this.initialized = true;
    }
  }

  private safePath(name: string): string {
    if (!isValidName(name)) {
      throw new Error(
        `Invalid scratch file name: "${name}". Use letters, numbers, hyphens, underscores, and dots only (max 64 chars).`,
      );
    }
    return join(this.sessionDir, name);
  }

  getSystemPromptFragment(): string {
    return [
      "You have a scratch pad for saving content you may need to retrieve verbatim in a future turn.",
      "- scratch_write: Save text under a short descriptive name (e.g. 'auth-middleware', 'api-schema', 'refactor-plan').",
      "- scratch_read: Retrieve saved content in full.",
      "- scratch_list: List all saved scratch files with their sizes.",
      "- scratch_delete: Remove a scratch file you no longer need.",
      "IMPORTANT: Before generating substantial content — code, plans, analysis, long outputs — that you may need to reference verbatim in a future turn, save it with scratch_write. Do not rely on conversation history to preserve full content after summarization.",
    ].join("\n");
  }

  async getContext(): Promise<string> {
    try {
      await this.ensureDir();
      const entries = await readdir(this.sessionDir);
      if (entries.length === 0) return "";

      const lines = await Promise.all(
        entries.map(async (name) => {
          try {
            const s = await stat(join(this.sessionDir, name));
            return `- ${name} (${s.size} bytes)`;
          } catch {
            return `- ${name}`;
          }
        }),
      );

      return `Scratch pad (retrieve with scratch_read):\n${lines.join("\n")}`;
    } catch {
      return "";
    }
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "scratch_write",
        description:
          "Save text to the scratch pad under a short descriptive name. Use this to preserve code, plans, analysis, or any output you may need verbatim in a future turn. Overwrites if the name already exists. Max 1 MB per file.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description:
                "Short descriptive name: letters, numbers, hyphens, underscores, dots — max 64 chars. E.g. 'auth-middleware', 'api-schema', 'refactor-plan'.",
            },
            content: {
              type: "string",
              description: "Text content to save.",
            },
          },
          required: ["name", "content"],
        },
      },
      {
        name: "scratch_read",
        description: "Read the full content of a scratch file by name.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the scratch file to read.",
            },
          },
          required: ["name"],
        },
      },
      {
        name: "scratch_list",
        description: "List all scratch files with their names and sizes.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
        },
      },
      {
        name: "scratch_delete",
        description: "Delete a scratch file by name.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Name of the scratch file to delete.",
            },
          },
          required: ["name"],
        },
      },
    ];
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    switch (name) {
      case "scratch_write":
        return withTimeout(
          this.scratchWrite(args.name as string, args.content as string),
          SCRATCH_OP_TIMEOUT_MS,
          "scratch_write",
        );
      case "scratch_read":
        return withTimeout(
          this.scratchRead(args.name as string),
          SCRATCH_OP_TIMEOUT_MS,
          "scratch_read",
        );
      case "scratch_list":
        return withTimeout(this.scratchList(), SCRATCH_OP_TIMEOUT_MS, "scratch_list");
      case "scratch_delete":
        return withTimeout(
          this.scratchDelete(args.name as string),
          SCRATCH_OP_TIMEOUT_MS,
          "scratch_delete",
        );
      default:
        return undefined;
    }
  }

  private async scratchWrite(
    name: string,
    content: string,
  ): Promise<{ name: string; size: number }> {
    if (typeof content !== "string") throw new Error("content must be a string.");
    const filePath = this.safePath(name); // validates name
    const encoded = new TextEncoder().encode(content);
    if (encoded.length > MAX_SCRATCH_FILE_BYTES) {
      throw new Error(
        `Content is ${encoded.length} bytes, which exceeds the ${MAX_SCRATCH_FILE_BYTES / 1024} KB per-file limit.`,
      );
    }
    await this.ensureDir();
    await Bun.write(filePath, content);
    logger.debug("Scratch", `write: ${name} (${encoded.length} bytes)`);
    return { name, size: encoded.length };
  }

  private async scratchRead(name: string): Promise<{ name: string; content: string; size: number }> {
    const filePath = this.safePath(name);
    const file = Bun.file(filePath);
    if (!(await file.exists())) {
      throw new Error(`Scratch file not found: "${name}". Use scratch_list to see available files.`);
    }
    const content = await file.text();
    return { name, content, size: file.size };
  }

  private async scratchList(): Promise<{ files: Array<{ name: string; size: number }> }> {
    await this.ensureDir();
    const entries = await readdir(this.sessionDir);
    const files = await Promise.all(
      entries.map(async (entryName) => {
        try {
          const s = await stat(join(this.sessionDir, entryName));
          return { name: entryName, size: s.size };
        } catch {
          return { name: entryName, size: 0 };
        }
      }),
    );
    return { files: files.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  private async scratchDelete(name: string): Promise<{ name: string }> {
    const filePath = this.safePath(name);
    try {
      await unlink(filePath);
    } catch {
      throw new Error(`Scratch file not found: "${name}".`);
    }
    logger.debug("Scratch", `delete: ${name}`);
    return { name };
  }
}
