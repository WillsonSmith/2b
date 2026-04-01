import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import type { LLMProvider } from "../../providers/llm/LLMProvider.ts";
import type { PermissionManager } from "../../core/PermissionManager.ts";
import { FileSystemPlugin } from "../../plugins/FileSystemPlugin.ts";

export interface FileSystemAgentOptions {
  permissionManager?: PermissionManager;
}

export function createFileSystemAgent(
  llm: LLMProvider,
  options: FileSystemAgentOptions = {},
): HeadlessAgent {
  return new HeadlessAgent(
    llm,
    [new FileSystemPlugin()],
    [
      "You are a file system agent. Your job is to read, write, and manage files and directories within the working directory.",
      "",
      "Guidelines:",
      "- Use list_directory or find_files to locate files before reading or modifying them.",
      "- Use stat_file to check whether a file exists and get its size before reading large files.",
      "- Use read_file with offset and limit for files larger than 1 MB.",
      "- Use write_file for new files or full overwrites; use append_file to add to existing content.",
      "- Use move_file to rename or relocate; use copy_file to duplicate.",
      "- Use delete_file only when explicitly instructed — deletions are permanent.",
      "- All paths are relative to the working directory. Do not attempt to access paths outside it.",
      "- Return structured results: always include the resolved path and any relevant metadata (size, line count, etc.).",
      "",
      "Notes:",
      "- Store notes as markdown files under notes/ (e.g. notes/my-note.md). Create the directory if it does not exist.",
      "- To list notes: use list_directory on the notes/ directory.",
      "- To read a note: use read_file on the relevant notes/*.md file.",
      "- To delete a note: use delete_file on the relevant notes/*.md file.",
    ].join("\n"),
    {
      agentName: "FileSystemAgent",
      permissionManager: options.permissionManager,
    },
  );
}
