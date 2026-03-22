import { tool } from "@lmstudio/sdk";
import { z } from "zod";

import { Glob } from "bun";

export const readTool = tool({
  name: "read_file",
  description: "Reads the contents of a file from disk",
  parameters: {
    filePath: z
      .string()
      .describe("The absolute or relative path to the file to read"),
  },
  implementation: async ({ filePath }) => {
    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return `Error: File not found at path: ${filePath}`;
      }
      return await file.text();
    } catch (error) {
      return `Error reading file: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const findFilesOfTypeTool = tool({
  name: "find_files_of_type",
  description:
    "Recursively searches a directory for files matching a specific extension.",
  parameters: {
    fileType: z
      .string()
      .describe(
        "The file extension to search for, WITHOUT the dot (e.g., 'md', 'ts', 'json')",
      ),
    directory: z
      .string()
      .default(".")
      .describe(
        "The directory path to search within. Defaults to the current directory '.'",
      ),
  },
  implementation: ({ fileType, directory }) => {
    try {
      const cleanExtension = fileType.replace(/^\./, "");
      const glob = new Glob(`**/*.${cleanExtension}`);

      const results = Array.from(glob.scanSync(directory));

      if (results.length === 0) {
        return `No files found with extension '.${cleanExtension}' in directory '${directory}'.`;
      }

      return results.join("\n");
    } catch (error) {
      return `Error searching for files: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const createNoteTool = tool({
  name: "create_note",
  description: "Creates a new markdown note with optional initial content.",
  parameters: {
    filePath: z
      .string()
      .describe(
        "The path where the note should be created (e.g., 'notes/my-thought.md')",
      ),
    content: z
      .string()
      .default("")
      .describe("Optional initial content for the note"),
  },
  implementation: async ({ filePath, content }) => {
    try {
      const finalPath = filePath.endsWith(".md") ? filePath : `${filePath}.md`;
      const file = Bun.file(finalPath);
      if (await file.exists()) {
        return `Error: File already exists at ${finalPath}. Use append_to_note instead.`;
      }
      await Bun.write(finalPath, content);
      return `Successfully created note at ${finalPath}`;
    } catch (error) {
      return `Error creating note: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const appendNoteTool = tool({
  name: "append_to_note",
  description: "Appends content to the end of an existing markdown note.",
  parameters: {
    filePath: z.string().describe("The path to the markdown file"),
    content: z.string().describe("The content to append to the file"),
  },
  implementation: async ({ filePath, content }) => {
    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) {
        return `Error: File ${filePath} does not exist. Use create_note first.`;
      }
      const currentContent = await file.text();
      const separator =
        currentContent.endsWith("\n") || currentContent.length === 0
          ? ""
          : "\n";
      await Bun.write(filePath, currentContent + separator + content);
      return `Successfully appended to ${filePath}`;
    } catch (error) {
      return `Error appending to note: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const searchNoteContentsTool = tool({
  name: "search_note_contents",
  description:
    "Searches for a specific string inside all markdown files in a directory.",
  parameters: {
    query: z.string().describe("The text to search for"),
    directory: z.string().default(".").describe("The directory to search in"),
  },
  implementation: async ({ query, directory }) => {
    try {
      const glob = new Glob("**/*.md");
      const files = Array.from(glob.scanSync(directory));
      const matches: string[] = [];

      for (const filePath of files) {
        const fullPath = `${directory}/${filePath}`.replace(/\/+/g, "/");
        const content = await Bun.file(fullPath).text();
        if (content.toLowerCase().includes(query.toLowerCase())) {
          matches.push(fullPath);
        }
      }

      return matches.length > 0
        ? `Found matches in:\n${matches.join("\n")}`
        : `No matches found for "${query}"`;
    } catch (error) {
      return `Error searching note contents: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const listNotesTool = tool({
  name: "list_notes",
  description: "Lists all markdown notes in a directory.",
  parameters: {
    directory: z
      .string()
      .default(".")
      .describe("The directory to list notes from"),
  },
  implementation: ({ directory }) => {
    try {
      const glob = new Glob("**/*.md");
      const files = Array.from(glob.scanSync(directory));
      return files.length > 0 ? files.join("\n") : "No markdown notes found.";
    } catch (error) {
      return `Error listing notes: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});

export const getCurrentDateTimeTool = tool({
  name: "get_current_datetime",
  description: "Returns the current local date and time.",
  parameters: {},
  implementation: () => {
    return new Date().toLocaleString();
  },
});

export const updateNoteMetadataTool = tool({
  name: "update_note_metadata",
  description:
    "Updates or adds YAML frontmatter metadata (like tags or status) to a markdown note.",
  parameters: {
    filePath: z.string().describe("The path to the markdown file"),
    metadata: z
      .record(z.string(), z.any())
      .describe("A key-value object of metadata to add/update"),
  },
  implementation: async ({ filePath, metadata }) => {
    try {
      const file = Bun.file(filePath);
      if (!(await file.exists())) return `Error: File not found: ${filePath}`;

      let content = await file.text();
      const yamlEntries = Object.entries(metadata)
        .map(([k, v]) => `${k}: ${Array.isArray(v) ? `[${v.join(", ")}]` : v}`)
        .join("\n");

      const frontmatterRegex = /^---\n([\s\S]*?)\n---\n/;
      const match = content.match(frontmatterRegex);

      if (match && match[1] !== undefined) {
        const existing = match[1];
        const updatedFrontmatter = `---\n${existing.trim()}\n${yamlEntries}\n---`;
        content = content.replace(frontmatterRegex, updatedFrontmatter + "\n");
      } else {
        content = `---\n${yamlEntries}\n---\n\n${content}`;
      }

      await Bun.write(filePath, content);
      return `Successfully updated metadata for ${filePath}`;
    } catch (error) {
      return `Error updating metadata: ${error instanceof Error ? error.message : String(error)}`;
    }
  },
});
