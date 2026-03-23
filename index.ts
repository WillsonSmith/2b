#!/usr/bin/env bun
import { createAgent } from "./src/agents/AgentFactory.ts";

const GRAY = "\x1b[90m", CYAN = "\x1b[36m", BOLD = "\x1b[1m", RESET = "\x1b[0m";

// --- Arg parsing ---
const rawArgs = process.argv.slice(2);

// Subcommands
if (rawArgs[0] === "memory") {
  const { runMemoryCommand } = await import("./src/cli/memory-cmd.ts");
  await runMemoryCommand(rawArgs.slice(1));
  process.exit(0);
}

// Flags
let quiet = false;
let noReasoning = false;
let showHelp = false;
const positional: string[] = [];

for (let i = 0; i < rawArgs.length; i++) {
  const arg = rawArgs[i]!;
  if (arg === "--quiet" || arg === "-q") {
    quiet = true;
  } else if (arg === "--no-reasoning") {
    noReasoning = true;
  } else if (arg === "--model" || arg === "-m") {
    const next = rawArgs[++i];
    if (next) process.env.MODEL = next;
  } else if (arg === "--help" || arg === "-h") {
    showHelp = true;
  } else if (!arg.startsWith("-")) {
    positional.push(arg);
  }
}

if (showHelp) {
  console.log(`
${BOLD}2b${RESET} — AI assistant

${BOLD}USAGE${RESET}
  2b [options] [message]
  echo "message" | 2b [options]

${BOLD}OPTIONS${RESET}
  -m, --model <name>    Use a specific model (overrides MODEL env var)
  -q, --quiet           Output response text only, no labels or colors
  --no-reasoning        Suppress reasoning/thinking output
  -h, --help            Show this help

${BOLD}SUBCOMMANDS${RESET}
  2b memory list              List all stored memories
  2b memory search <query>    Search memories by text
  2b memory clear             Delete all memories

${BOLD}EXAMPLES${RESET}
  2b "what time is it?"
  echo "summarize this" < report.txt
  cat error.log | 2b --quiet "explain this error"
  2b memory list
  2b --model qwen3:8b "hello"
`);
  process.exit(0);
}

// One-shot detection
const isPiped = !process.stdin.isTTY;
const oneShotMessage = positional.length > 0 ? positional.join(" ") : null;

// Read piped stdin before agent starts (so CLIInputSource doesn't consume it)
let pipedInput = "";
if (isPiped) {
  pipedInput = (await Bun.stdin.text()).trim();
}

const oneShotInput = [oneShotMessage, pipedInput].filter(Boolean).join("\n").trim();
const isOneShot = oneShotInput.length > 0;

if (isPiped && !isOneShot) {
  console.error("No input provided.");
  process.exit(1);
}

// --- Agent setup ---
const { agent } = createAgent();

let reasoningActive = false;
let responseActive = false;

agent.setTokenCallback((token, isReasoning) => {
  if (isReasoning) {
    if (noReasoning || quiet) return;
    if (!reasoningActive) {
      process.stdout.write(`\n${GRAY}${BOLD}[thinking]${RESET}${GRAY} `);
      reasoningActive = true;
    }
    process.stdout.write(`${GRAY}${token}${RESET}`);
  } else {
    if (reasoningActive) {
      process.stdout.write(`${RESET}\n`);
      reasoningActive = false;
    }
    if (quiet) {
      process.stdout.write(token);
    } else {
      if (!responseActive) {
        process.stdout.write(`\n${CYAN}${BOLD}[response]${RESET}${CYAN} `);
        responseActive = true;
      }
      process.stdout.write(`${CYAN}${token}${RESET}`);
    }
  }
});

if (isOneShot) {
  agent.once("speak", () => {
    process.stdout.write(quiet ? "\n" : `${RESET}\n`);
    process.exit(0);
  });
} else {
  agent.on("speak", () => {
    process.stdout.write(`${RESET}\n`);
    reasoningActive = false;
    responseActive = false;
    process.stdout.write(`\n${BOLD}You:${RESET} `);
  });

  console.log(`\n${BOLD}2b${RESET} — type a message or Ctrl+C to quit.`);
  console.log(`${GRAY}Reasoning in gray · responses in cyan${RESET}\n`);
  process.stdout.write(`${BOLD}You:${RESET} `);
}

await agent.start();

if (isOneShot) {
  agent.addDirect(oneShotInput);
}
