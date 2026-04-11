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
