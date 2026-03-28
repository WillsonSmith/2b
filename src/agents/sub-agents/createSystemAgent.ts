import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import type { LLMProvider } from "../../providers/llm/LLMProvider.ts";
import { ShellPlugin } from "../../plugins/ShellPlugin.ts";
import { FileIOPlugin } from "../../plugins/FileIOPlugin.ts";
import { ClipboardPlugin } from "../../plugins/ClipboardPlugin.ts";
import { CodeSandboxPlugin } from "../../plugins/CodeSandboxPlugin.ts";

export function createSystemAgent(llm: LLMProvider): HeadlessAgent {
  return new HeadlessAgent(
    llm,
    [new ShellPlugin(), new FileIOPlugin(), new ClipboardPlugin(), new CodeSandboxPlugin()],
    "You are a system operations specialist. You can run read-only shell commands (ls, git, cat, grep, etc.), read and write files, access the clipboard, and execute code in a sandbox. For the sandbox, describe the computation in plain language via the task parameter — a dedicated coding model will write the Python for you. Complete system-level tasks carefully and safely.",
  );
}
