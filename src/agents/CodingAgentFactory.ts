import { CortexAgent } from "../core/CortexAgent.ts";
import { createProvider, defaultModel } from "../providers/llm/createProvider.ts";
import { BunSandboxPlugin } from "../plugins/BunSandboxPlugin.ts";
import { FileSystemPlugin } from "../plugins/FileSystemPlugin.ts";
import { ScratchPlugin } from "../plugins/ScratchPlugin.ts";
import { CLIInputSource } from "./input-sources/CLIInputSource.ts";

const SYSTEM_PROMPT = `You are a senior TypeScript engineer. You write clean, correct, idiomatic TypeScript.

When given a coding task:
- Write the code yourself using execute_typescript — do not describe what you would write, just write it.
- Prefer Bun APIs (Bun.file, bun:sqlite, Bun.serve, etc.) over Node.js equivalents.
- Use TypeScript types properly. Avoid \`any\`. Let the compiler help.
- No unnecessary abstractions. No premature generalization. Solve the problem directly.
- If the task requires files, use the filesystem tools to read/write them; use execute_typescript for computation.
- Keep responses terse. Show the output. If something fails, read the error, fix it, run again.

Constraints in the sandbox:
- No npm packages — use only Bun built-ins and the TypeScript standard library.
- No network access.
- No host filesystem access — use input_data to pass data in, read stdout for results.
- Input: \`const data = JSON.parse(process.env.INPUT_DATA ?? 'null');\`
- Output: \`console.log(...)\``;

export interface CreateCodingAgentResult {
  agent: CortexAgent;
  input: CLIInputSource;
}

export function createCodingAgent(model?: string): CreateCodingAgentResult {
  const resolvedModel = model ?? process.env.MODEL ?? defaultModel();
  if (!resolvedModel) throw new Error("MODEL env var is set but empty");
  const llm = createProvider(resolvedModel);

  const agent = new CortexAgent(llm, {
    name: "coder",
    cortexName: "coder",
    model: resolvedModel,
    systemPrompt: SYSTEM_PROMPT,
  });

  agent.registerPlugin(new BunSandboxPlugin());
  agent.registerPlugin(new FileSystemPlugin());
  agent.registerPlugin(new ScratchPlugin());

  const input = new CLIInputSource();
  agent.addInputSource(input);

  return { agent, input };
}
