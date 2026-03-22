import { CortexAgent } from "../core/CortexAgent.ts";
import { LMStudioProvider } from "../providers/llm/LMStudioProvider.ts";
import { MemoryPlugin } from "../plugins/MemoryPlugin.ts";
import { CLIInputSource } from "./input-sources/CLIInputSource.ts";
import type { AgentPlugin, ToolDefinition } from "../core/Plugin.ts";
import { TMDBPlugin } from "../plugins/TMDBPlugin.ts";
import { FileIOPlugin } from "../plugins/FileIOPlugin.ts";
import { ImageVisionPlugin } from "../plugins/ImageVisionPlugin.ts";

// ── Safe arithmetic evaluator (replaces Function/eval) ────────────────────────

function safeEvaluate(expression: string): string {
  if (!/^[\d\s+\-*/().%]+$/.test(expression)) {
    return "Error: only arithmetic expressions are allowed.";
  }
  try {
    const tokens = expression.replace(/\s+/g, "");
    let pos = 0;

    function parseExpr(): number {
      return parseAddSub();
    }
    function parseAddSub(): number {
      let left = parseMulDiv();
      while (pos < tokens.length && (tokens[pos] === "+" || tokens[pos] === "-")) {
        const op = tokens[pos++];
        const right = parseMulDiv();
        left = op === "+" ? left + right : left - right;
      }
      return left;
    }
    function parseMulDiv(): number {
      let left = parseUnary();
      while (pos < tokens.length && (tokens[pos] === "*" || tokens[pos] === "/" || tokens[pos] === "%")) {
        const op = tokens[pos++];
        const right = parseUnary();
        if (op === "/") {
          if (right === 0) throw new Error("Division by zero");
          left = left / right;
        } else if (op === "%") {
          left = left % right;
        } else {
          left = left * right;
        }
      }
      return left;
    }
    function parseUnary(): number {
      if (tokens[pos] === "-") { pos++; return -parsePrimary(); }
      if (tokens[pos] === "+") { pos++; return parsePrimary(); }
      return parsePrimary();
    }
    function parsePrimary(): number {
      if (tokens[pos] === "(") {
        pos++;
        const val = parseExpr();
        if (tokens[pos] !== ")") throw new Error("Expected closing parenthesis");
        pos++;
        return val;
      }
      const start = pos;
      while (pos < tokens.length && /[\d.]/.test(tokens[pos]!)) pos++;
      if (pos === start) throw new Error("Unexpected character in expression");
      const n = parseFloat(tokens.slice(start, pos));
      if (isNaN(n)) throw new Error("Invalid number");
      return n;
    }

    const result = parseExpr();
    if (pos < tokens.length) throw new Error("Unexpected trailing characters");
    return String(result);
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

// ── Inline tools plugin ───────────────────────────────────────────────────────

class MinimalToolsPlugin implements AgentPlugin {
  name = "MinimalTools";

  getTools(): ToolDefinition[] {
    return [
      {
        name: "get_current_time",
        description: "Returns the current local date and time.",
        parameters: { type: "object", properties: {} },
        implementation: () => new Date().toString(),
      },
      {
        name: "calculate",
        description:
          "Evaluates a simple arithmetic expression and returns the result.",
        parameters: {
          type: "object",
          properties: {
            expression: {
              type: "string",
              description: "e.g. '(3 + 4) * 2'",
            },
          },
          required: ["expression"],
        },
        implementation: ({ expression }: { expression: string }) =>
          safeEvaluate(expression),
      },
      {
        name: "echo",
        description:
          "Echoes text back. Useful for confirming what the agent heard.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
        },
        implementation: ({ text }: { text: string }) => text,
      },
    ];
  }
}

// ── Factory ───────────────────────────────────────────────────────────────────

export function createAgent(): {
  agent: CortexAgent;
  input: CLIInputSource;
} {
  const model = process.env.MODEL ?? "nvidia/nemotron-3-nano-4b";
  const lmStudioUrl = process.env.LM_STUDIO_URL ?? "http://127.0.0.1:1234";
  const llm = new LMStudioProvider(model, lmStudioUrl, {
    toolCallingStrategy: "native",
  });

  const agent = new CortexAgent(llm, {
    name: "2b",
    cortexName: "2b",
    model,
    systemPrompt:
      "You are a helpful assistant with access to tools. Think carefully before responding.",
  });

  const input = new CLIInputSource();

  agent.registerPlugin(new TMDBPlugin());
  agent.registerPlugin(new FileIOPlugin());
  agent.registerPlugin(new ImageVisionPlugin());
  agent.registerPlugin(new MinimalToolsPlugin());
  agent.registerPlugin(new MemoryPlugin(llm));
  agent.addInputSource(input);

  return { agent, input };
}
