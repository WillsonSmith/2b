import { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type { ActiveTool, AgentState, DynamicAgentRecord } from "../types.ts";

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

interface StatusBarProps {
  state: AgentState;
  activeToolCalls: ActiveTool[];
  dynamicAgents: DynamicAgentRecord[];
  model?: string;
}

function ToolLabel({ tool }: { tool: ActiveTool }) {
  const label = tool.agentName ? `[${tool.agentName}]` : `[${tool.name}]`;
  if (tool.currentSubTool) {
    return (
      <Box gap={1}>
        <Text color="yellow">{label}</Text>
        <Text color="gray">→</Text>
        <Text color="cyan">{tool.currentSubTool}</Text>
      </Box>
    );
  }
  return (
    <Box gap={1}>
      <Text color="yellow">{label}</Text>
      <Text color="gray">running</Text>
    </Box>
  );
}

export function StatusBar({ state, activeToolCalls, dynamicAgents, model }: StatusBarProps) {
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

  const activeAgents = dynamicAgents.filter((a) => a.state !== "idle");

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
          {activeToolCalls.map((tool, i) => (
            <ToolLabel key={i} tool={tool} />
          ))}
        </Box>
      )}

      {/* Active dynamic agents panel */}
      {activeAgents.length > 0 && (
        <Box
          flexDirection="column"
          borderStyle="single"
          borderColor="magenta"
          paddingX={1}
          marginBottom={1}
        >
          <Text color="magenta" dimColor>agents</Text>
          {activeAgents.map((a) => (
            <Box key={a.name} gap={1}>
              <Text color="magenta">{`[${a.name}]`}</Text>
              <Text color={a.state === "error" ? "red" : "gray"}>
                {a.state === "error" ? "error" : a.state === "thinking" ? "thinking" : "idle"}
              </Text>
              <Text color="gray" dimColor>{a.type}</Text>
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
