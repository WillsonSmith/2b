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
    return `You can create, read, list, and delete persistent notes saved to disk.
Use create_note to save a note with a title and markdown content.
Use list_notes to see all saved notes.
Use read_note to retrieve a note's content by title.
Use delete_note to remove a note.
Notes are saved as markdown files in the notes/ directory.`;
  }

  getTools(): ToolDefinition[] {
    return [
      {
        name: "create_note",
        description:
          "Create or overwrite a note with the given title and markdown content. The title becomes the filename.",
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
        description: "List all saved notes, returning their titles.",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "read_note",
        description: "Read the content of a saved note by its title.",
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
        description: "Delete a saved note by its title.",
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
