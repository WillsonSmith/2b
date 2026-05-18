import type { ServerWebSocket } from "bun";
import type { ClientMsg } from "../../protocol.ts";
import type { WsContext } from "../context.ts";

export type AIFillMsg = Extract<ClientMsg, { type: "ai_fill_request" }>;

export async function handleAIFill(
  msg: AIFillMsg,
  ctx: WsContext,
  ws: ServerWebSocket<unknown>,
): Promise<void> {
  const { send, aiFill } = ctx;
  const { id, instruction, document, mentions } = msg;
  if (!instruction?.trim()) {
    send(ws, { type: "ai_fill_result", id, content: "", error: "Empty instruction" });
    return;
  }
  try {
    const content = await aiFill.generate(instruction, document ?? "", mentions ?? []);
    send(ws, { type: "ai_fill_result", id, content });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to generate fill content.";
    send(ws, { type: "ai_fill_result", id, content: "", error: message });
  }
}
