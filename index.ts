import { createAgent } from "./src/agents/AgentFactory.ts";

const GRAY = "\x1b[90m", CYAN = "\x1b[36m", BOLD = "\x1b[1m", RESET = "\x1b[0m";

const { agent } = createAgent();

let reasoningActive = false, responseActive = false;

agent.setTokenCallback((token, isReasoning) => {
  if (isReasoning) {
    if (!reasoningActive) { process.stdout.write(`\n${GRAY}${BOLD}[thinking]${RESET}${GRAY} `); reasoningActive = true; }
    process.stdout.write(`${GRAY}${token}${RESET}`);
  } else {
    if (reasoningActive) { process.stdout.write(`${RESET}\n`); reasoningActive = false; }
    if (!responseActive) { process.stdout.write(`\n${CYAN}${BOLD}[response]${RESET}${CYAN} `); responseActive = true; }
    process.stdout.write(`${CYAN}${token}${RESET}`);
  }
});

agent.on("speak", () => {
  process.stdout.write(`${RESET}\n`);
  reasoningActive = false; responseActive = false;
  process.stdout.write(`\n${BOLD}You:${RESET} `);
});

console.log(`\n${BOLD}2b${RESET} — type a message or Ctrl+C to quit.`);
console.log(`${GRAY}Reasoning in gray · responses in cyan${RESET}\n`);
process.stdout.write(`${BOLD}You:${RESET} `);

await agent.start();
