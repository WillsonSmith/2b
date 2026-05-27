import { useMemo } from "react";
import { MAX_ARG_VALUE_PREVIEW } from "./types.ts";

interface ToolArgsViewProps {
  args: Record<string, unknown>;
}

export function ToolArgsView({ args }: ToolArgsViewProps) {
  const pretty = useMemo(() => {
    const sanitized: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args)) {
      if (typeof v === "string" && v.length > MAX_ARG_VALUE_PREVIEW) {
        sanitized[k] = `${v.slice(0, MAX_ARG_VALUE_PREVIEW)}… [${v.length - MAX_ARG_VALUE_PREVIEW} chars truncated]`;
      } else {
        sanitized[k] = v;
      }
    }
    return JSON.stringify(sanitized, null, 2);
  }, [args]);

  return (
    <div className="permission-dialog-body">
      <h3 className="permission-dialog-subheading">Arguments</h3>
      <pre className="permission-dialog-args">{pretty}</pre>
    </div>
  );
}
