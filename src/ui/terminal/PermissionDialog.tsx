import { Box, Text, useInput } from "ink";
import type { PendingPermission } from "./InkPermissionManager.ts";

const MAX_ARG_VALUE_LENGTH = 200;

function truncateArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string" && v.length > MAX_ARG_VALUE_LENGTH) {
      out[k] = `${v.slice(0, MAX_ARG_VALUE_LENGTH)}… [truncated, ${v.length} total chars]`;
    } else {
      out[k] = v;
    }
  }
  return out;
}

interface PermissionDialogProps {
  pending: PendingPermission;
  onRespond: (response: "yes" | "always" | "no") => void;
}

export function PermissionDialog({ pending, onRespond }: PermissionDialogProps) {
  const { request } = pending;

  useInput((input) => {
    const key = input.toLowerCase();
    if (key === "y") onRespond("yes");
    else if (key === "a") onRespond("always");
    else if (key === "n") onRespond("no");
  });

  const argsStr = JSON.stringify(truncateArgs(request.args), null, 2);

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginY={1}>
      <Text bold color="yellow">
        Permission Request
      </Text>
      <Text>
        {"Agent: "}
        <Text bold>{request.agentName}</Text>
      </Text>
      <Text>
        {"Tool:  "}
        <Text bold>{request.toolName}</Text>
      </Text>
      <Text>Args:</Text>
      <Text color="gray">{argsStr}</Text>
      <Text>
        {"Allow?  "}
        <Text bold color="green">
          [y]
        </Text>
        {"es once   "}
        <Text bold color="blue">
          [a]
        </Text>
        {"lways (session)   "}
        <Text bold color="red">
          [n]
        </Text>
        {"o"}
      </Text>
    </Box>
  );
}
