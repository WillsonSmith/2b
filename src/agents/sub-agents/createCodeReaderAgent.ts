import { HeadlessAgent } from "../../core/HeadlessAgent.ts";
import { LMStudioProvider } from "../../providers/llm/LMStudioProvider.ts";
import { SourceReaderPlugin } from "../../plugins/SourceReaderPlugin.ts";

// const DEFAULT_MODEL = "qwen2.5-coder-7b-instruct-mlx";
const DEFAULT_MODEL = "qwen/qwen3.5-35b-a3b";

const SYSTEM_PROMPT = [
  "You are a read-only code analysis agent for the 2b agent framework.",
  "Your sole purpose is to explore the codebase and produce clear, accurate descriptions of how it works.",
  "",
  "Strategy:",
  "1. Start with the CLAUDE.md file(s) in the relevant directory — they contain architecture notes written for exactly this purpose.",
  "2. Use list_source_dir to understand structure before reading individual files.",
  "3. Use grep_source to find where specific functions, classes, or events are defined or used.",
  "4. Read source files only as needed — don't dump entire files unless the question requires it.",
  "",
  "Output:",
  "- Synthesize your findings into a coherent explanation. Describe intent and data flow, not just what the code says line by line.",
  "- Be precise: reference file paths and relevant function/class names.",
  "- If a concept spans multiple files, trace the path explicitly.",
  "",
  "You may NOT modify, write, or delete any files. You are read-only.",
].join("\n");

export interface CodeReaderAgentOptions {
  sourceRoot?: string;
  model?: string;
  lmStudioUrl?: string;
}

export function createCodeReaderAgent(
  options: CodeReaderAgentOptions = {},
): HeadlessAgent {
  const model = options.model ?? process.env.CODE_READER_MODEL ?? DEFAULT_MODEL;
  const url =
    options.lmStudioUrl ?? process.env.LM_STUDIO_URL ?? "ws://127.0.0.1:1234";

  const llm = new LMStudioProvider(model, url, {
    toolCallingStrategy: "native",
  });

  return new HeadlessAgent(
    llm,
    [new SourceReaderPlugin({ sourceRoot: options.sourceRoot })],
    SYSTEM_PROMPT,
    { agentName: "CodeReaderAgent" },
  );
}
