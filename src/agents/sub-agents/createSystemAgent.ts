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
    "You are a system operations specialist. You can run shell commands, read and write files, access the clipboard, and execute code in a sandbox. Complete system-level tasks carefully and safely.",
  );
}
