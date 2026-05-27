import { memo } from "react";
import type { MutableRefObject } from "react";
import { useAI } from "../../../state/AIContext.tsx";
import { useSignalValue } from "../../../state/signals.ts";
import { EmptyState } from "../../composites/EmptyState.tsx";
import {
  UserMessageRow,
  AssistantMessageRow,
  ToolRow,
  PlanStepRow,
  NotificationRow,
  SystemEventRow,
  EmptyResponseRow,
  ThinkingIndicator,
} from "./rows/index.ts";

interface MessageListProps {
  endRef: MutableRefObject<HTMLDivElement | null>;
  onNavigate?: (path: string) => void;
}

export const MessageList = memo(function MessageList({ endRef, onNavigate }: MessageListProps) {
  const ai = useAI();
  const messages = useSignalValue(ai.messages);
  const isThinking = useSignalValue(ai.agentState) === "thinking";

  return (
    <div className="ep-sidecar__messages">
      {messages.length === 0 && (
        <EmptyState
          description="Ask Episteme anything, or use Quick Actions to kick off a research task."
        />
      )}

      {messages.map((m, i) => {
        switch (m.role) {
          case "tool":
            return <ToolRow key={i} message={m} />;
          case "notification":
            return <NotificationRow key={i} message={m} />;
          case "system_event":
            return <SystemEventRow key={i} message={m} />;
          case "empty_response":
            return <EmptyResponseRow key={i} message={m} index={i} />;
          case "plan_step":
            return <PlanStepRow key={i} message={m} />;
          case "assistant":
            return <AssistantMessageRow key={i} message={m} index={i} onNavigate={onNavigate} />;
          case "user":
            return <UserMessageRow key={i} message={m} index={i} />;
        }
      })}

      {isThinking && <ThinkingIndicator />}
      <div ref={endRef} />
    </div>
  );
});
