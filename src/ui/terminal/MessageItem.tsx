import { useState, useEffect } from "react";
import { Box, Text } from "ink";
import type { ChatMessage } from "../types.ts";

interface ThinkingBoxProps {
  thought: string;
  isInProgress: boolean;
}

function ThinkingBox({ thought, isInProgress }: ThinkingBoxProps) {
  const [expanded, setExpanded] = useState(true);

  useEffect(() => {
    if (!isInProgress) {
      setExpanded(false);
    }
  }, [isInProgress]);

  const lineCount = thought.split("\n").length;

  if (!expanded) {
    return (
      <Box marginLeft={2} marginBottom={1}>
        <Text color="gray" dimColor>
          {"▶ Thinking ("}
          {lineCount}
          {" lines)"}
        </Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginLeft={2} marginBottom={1}>
      <Text color="gray" dimColor bold>
        {"▼ Thinking"}
      </Text>
      <Box marginLeft={2} marginTop={0}>
        <Text color="gray" dimColor wrap="wrap">
          {thought}
        </Text>
      </Box>
    </Box>
  );
}

interface MessageItemProps {
  message: ChatMessage;
  showReasoning?: boolean;
}

export function MessageItem({ message, showReasoning = true }: MessageItemProps) {
  // System messages — inline notifications from slash commands
  if (message.role === "system") {
    return (
      <Box flexDirection="column" marginBottom={1} paddingX={1} borderStyle="single" borderColor="gray">
        <Text color="white">
          {message.content}
        </Text>
      </Box>
    );
  }

  const isUser = message.role === "user";
  const thinkingInProgress = message.status === "streaming" && message.content.length === 0;

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Role label */}
      <Text bold color={isUser ? "green" : "cyan"}>
        {isUser ? "You" : "2b"}
      </Text>

      {/* Thought block (reasoning) — collapsible */}
      {showReasoning && message.thought && (
        <ThinkingBox thought={message.thought} isInProgress={thinkingInProgress} />
      )}

      {/* Message content */}
      <Box marginLeft={2}>
        {message.status === "pending" ? (
          <Text color="gray">…</Text>
        ) : message.status === "error" ? (
          <Text color="red">Error — something went wrong.</Text>
        ) : (
          <Text>
            {message.content}
            {message.status === "streaming" && (
              <Text color="cyan">▌</Text>
            )}
          </Text>
        )}
      </Box>
    </Box>
  );
}
