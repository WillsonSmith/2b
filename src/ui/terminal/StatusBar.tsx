import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { AgentState } from "../types.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface StatusBarProps {
  state: AgentState;
  activeToolCalls: string[];
  model?: string;
}

export function StatusBar({ state, activeToolCalls, model }: StatusBarProps) {
  const [spinnerFrame, setSpinnerFrame] = useState(0);

  useEffect(() => {
    if (state === "idle") return;
    const id = setInterval(() => {
      setSpinnerFrame((f) => (f + 1) % SPINNER_FRAMES.length);
    }, 80);
    return () => clearInterval(id);
  }, [state]);

  const isThinking = state === "thinking";
  const spinner = SPINNER_FRAMES[spinnerFrame] ?? "⠋";

  return (
    <Box flexDirection="column" marginBottom={1}>
      {/* Active tool call panel — visible only while thinking */}
      {isThinking && activeToolCalls.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="yellow"
          paddingX={1}
          marginBottom={1}
        >
          {activeToolCalls.map((name, i) => (
            <Box key={i} gap={1}>
              <Text color="yellow">{`[${name}]`}</Text>
              <Text color="gray">running</Text>
            </Box>
          ))}
        </Box>
      )}

      {/* Status line */}
      <Box justifyContent="space-between" paddingX={1}>
        <Box gap={1}>
          <Text bold color="cyan">
            2b
          </Text>
          {isThinking && (
            <Text color="yellow">
              {spinner}{" "}
              {activeToolCalls.length === 0 ? "thinking" : `${activeToolCalls.length} tool${activeToolCalls.length > 1 ? "s" : ""} running`}
            </Text>
          )}
          {!isThinking && <Text color="green">ready</Text>}
        </Box>
        {model && (
          <Text color="gray" dimColor>
            {model}
          </Text>
        )}
      </Box>
    </Box>
  );
}
