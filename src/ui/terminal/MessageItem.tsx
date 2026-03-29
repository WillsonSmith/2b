import { Box, Text } from "ink";
import type { ChatMessage } from "../types.ts";

interface MessageItemProps {
  message: ChatMessage;
}

export function MessageItem({ message }: MessageItemProps) {
  const isUser = message.role === "user";

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Role label */}
      <Text bold color={isUser ? "green" : "cyan"}>
        {isUser ? "You" : "2b"}
      </Text>

      {/* Thought block (reasoning) */}
      {message.thought && (
        <Box marginLeft={2} marginBottom={1}>
          <Text color="gray" dimColor>
            {"⟨think⟩ "}
            {message.thought.length > 200
              ? message.thought.slice(0, 200) + "…"
              : message.thought}
          </Text>
        </Box>
      )}

      {/* Tool calls */}
      {message.toolCalls.length > 0 && (
        <Box flexDirection="column" marginLeft={2} marginBottom={1}>
          {message.toolCalls.map((tc, i) => (
            <Text key={i} color="yellow">
              {"⚙ "}
              {tc.name}
            </Text>
          ))}
        </Box>
      )}

      {/* Message content */}
      <Box marginLeft={2}>
        {message.status === "pending" ? (
          <Text color="gray">…</Text>
        ) : message.status === "error" ? (
          <Text color="red">Error — something went wrong.</Text>
        ) : (
          <Text color={isUser ? "white" : "white"}>
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
