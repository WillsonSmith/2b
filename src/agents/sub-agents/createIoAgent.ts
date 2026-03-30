import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import type { LLMProvider } from "../../providers/llm/LLMProvider.ts";
import type { PermissionManager } from "../../core/PermissionManager.ts";
import { FileIOPlugin } from "../../plugins/FileIOPlugin.ts";

export interface SystemAgentOptions {
  permissionManager?: PermissionManager;
}

export function createFileSystemAgent(
  llm: LLMProvider,
  options: SystemAgentOptions = {},
): HeadlessAgent {
  return new HeadlessAgent(
    llm,
    [new FileIOPlugin()],
    "You are a file system manager. You can read and write files and directories.",
    {
      agentName: "FileSystemAgent",
      permissionManager: options.permissionManager,
    },
  );
}
