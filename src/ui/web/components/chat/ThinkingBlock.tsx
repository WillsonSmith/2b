import { useEffect, useState } from "react";

export function ThinkingBlock({
  thought,
  inProgress,
}: {
  thought: string;
  inProgress: boolean;
}) {
  const [expanded, setExpanded] = useState(inProgress);

  useEffect(() => {
    if (!inProgress) setExpanded(false);
  }, [inProgress]);

  const lineCount = thought.split("\n").length;

  return (
    <div className="thinking">
      <div className="thinking-header" onClick={() => setExpanded((x) => !x)}>
        <span
          className={`thinking-chevron ${expanded ? "thinking-chevron--open" : ""}`}
        >
          ▶
        </span>
        <span>Thinking</span>
        {!expanded && (
          <span style={{ color: "var(--text-dim)" }}>
            ({lineCount} {lineCount === 1 ? "line" : "lines"})
          </span>
        )}
      </div>
      {expanded && <div className="thinking-body">{thought}</div>}
    </div>
  );
}
