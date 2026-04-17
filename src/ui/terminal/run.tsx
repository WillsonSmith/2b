/**
 * Terminal UI entry point.
 *
 * Starts the agent, wraps it in a ChatSession, then mounts the Ink-based
 * TerminalChat React component. Ink takes over stdout for the session lifetime.
 *
 * `onModelChange` is wired through so the user can switch models mid-session
 * via a UI command; it calls `llm.setModel()` back in 2b.ts.
 *
 * Critical: `agent.start()` must complete before rendering so all plugins are
 * initialized and the heartbeat loop is running before the first input arrives.
 */
import { render } from "ink";
import type { CortexAgent } from "../../core/CortexAgent.ts";
import { InkPermissionManager } from "./InkPermissionManager.ts";
import { ChatSession } from "../ChatSession.ts";
import { TerminalChat } from "./TerminalChat.tsx";

export async function startTerminalUI({
  agent,
  model,
  systemPrompt,
  permissionManager,
  onModelChange,
}: {
  agent: CortexAgent;
  model: string;
  systemPrompt: string;
  permissionManager: InkPermissionManager;
  onModelChange: (newModel: string) => void;
}) {
  await agent.start();
  const session = new ChatSession(agent);
  render(
    <TerminalChat
      session={session}
      model={model}
      systemPrompt={systemPrompt}
      onModelChange={onModelChange}
      permissionManager={permissionManager}
    />,
  );
}
