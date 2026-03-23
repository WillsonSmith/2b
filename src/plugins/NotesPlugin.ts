import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { join, resolve, relative, isAbsolute } from "node:path";
import { mkdirSync, unlinkSync } from "node:fs";
import { logger } from "../logger.ts";

const NOTES_DIR = join(process.cwd(), "notes");

function safeNotePath(title: string): string {
  const safe = title
    .replace(/[^a-zA-Z0-9_\- ]/g, "")
    .trim()
    .replace(/\s+/g, "-");
  if (!safe) throw new Error("Invalid note title.");
  const path = resolve(join(NOTES_DIR, `${safe}.md`));
  const rel = relative(resolve(NOTES_DIR), path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw new Error("Invalid note path.");
  return path;
}

export class NotesPlugin implements AgentPlugin {
  name = "Notes";

  constructor() {
    mkdirSync(NOTES_DIR, { recursive: true });
  }

  getSystemPromptFragment(): string {
    return `You can save and retrieve persistent markdown notes stored in the notes/ directory.
Use create_note to save information the user wants to keep across conversations.
Use list_notes to see all saved notes, read_note to retrieve one, and delete_note to remove one.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "create_note",
        description:
          "Create or overwrite a persistent note with the given title and markdown content. Use this when the user wants to save, jot down, or remember something. The title becomes the filename.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "The note title." },
            content: { type: "string", description: "The markdown content of the note." },
          },
          required: ["title", "content"],
        },
      },
      {
        name: "list_notes",
        description: "List all saved notes by title. Use this when the user asks what notes exist or wants to browse saved notes.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "read_note",
        description: "Read the full content of a saved note by its title. Use this when the user asks to recall or view a specific note.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "The note title to read." },
          },
          required: ["title"],
        },
      },
      {
        name: "delete_note",
        description: "Delete a saved note by its title. Use this when the user asks to remove or discard a note.",
        parameters: {
          type: "object",
          properties: {
            title: { type: "string", description: "The note title to delete." },
          },
          required: ["title"],
        },
      },
    ];
  }

  async executeTool(name: string, args: any): Promise<any> {
    if (name === "create_note") {
      const path = safeNotePath(args.title);
      const content = `# ${args.title}\n\n${args.content}`;
      await Bun.write(path, content);
      logger.info("Notes", `create_note: ${path}`);
      return { success: true, path };
    }

    if (name === "list_notes") {
      const glob = new Bun.Glob("*.md");
      const notes: string[] = [];
      for await (const file of glob.scan(NOTES_DIR)) {
        notes.push(file.replace(/\.md$/, ""));
      }
      return { notes, count: notes.length };
    }

    if (name === "read_note") {
      const path = safeNotePath(args.title);
      const file = Bun.file(path);
      if (!(await file.exists())) return { error: `Note "${args.title}" not found.` };
      return { title: args.title, content: await file.text() };
    }

    if (name === "delete_note") {
      const path = safeNotePath(args.title);
      const file = Bun.file(path);
      if (!(await file.exists())) return { error: `Note "${args.title}" not found.` };
      unlinkSync(path);
      logger.info("Notes", `delete_note: ${path}`);
      return { success: true };
    }
  }
}
