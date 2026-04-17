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
  private activeGoal: string | null = null;

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
    const parts: string[] = [];

    if (this.activeGoal !== null) {
      parts.push(
        "## Active Goal",
        "You are currently committed to the following task. Continue pursuing it until it is complete or you are explicitly told to stop.",
        this.activeGoal,
        "Use clear_active_goal when the task is finished.",
      );
    }

    parts.push(
      "You have a scratch pad for saving content you may need to retrieve verbatim in a future turn.",
      "- scratch_write: Save text under a short descriptive name (e.g. 'auth-middleware', 'api-schema', 'refactor-plan').",
      "- scratch_read: Retrieve saved content in full.",
      "- scratch_list: List all saved scratch files with their sizes.",
      "- scratch_delete: Remove a scratch file you no longer need.",
      "IMPORTANT: Before generating substantial content — code, plans, analysis, long outputs — that you may need to reference verbatim in a future turn, save it with scratch_write. Do not rely on conversation history to preserve full content after summarization.",
      "When the user gives you a multi-turn task (e.g. 'ask me questions about X for 20 turns', 'work through this list one item per message'), call set_active_goal immediately with a clear description of the task and any progress tracking needed. This survives message summarization.",
    );

    return parts.join("\n");
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
      {
        name: "set_active_goal",
        description:
          "Pin a multi-turn task as the active goal. The goal is injected into every system prompt for the rest of the session, surviving message summarization. Use this immediately when the user gives you a task that spans multiple turns (e.g. 'ask me 20 questions', 'work through this list'). Include any progress tracking in the goal text (e.g. 'Question 3 of 20'). Call clear_active_goal when done.",
        parameters: {
          type: "object",
          properties: {
            goal: {
              type: "string",
              description: "Description of the task and any progress state to track.",
            },
          },
          required: ["goal"],
        },
      },
      {
        name: "get_active_goal",
        description: "Return the current active goal, or null if none is set.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
        },
      },
      {
        name: "clear_active_goal",
        description: "Clear the active goal once the task is complete.",
        parameters: {
          type: "object",
          properties: {},
          required: [],
          additionalProperties: false,
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
      case "set_active_goal":
        this.activeGoal = String(args.goal ?? "");
        logger.debug("Scratch", `set_active_goal: "${this.activeGoal.slice(0, 80)}"`);
        return { ok: true, goal: this.activeGoal };
      case "get_active_goal":
        return { goal: this.activeGoal };
      case "clear_active_goal":
        this.activeGoal = null;
        logger.debug("Scratch", "clear_active_goal");
        return { ok: true };
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
