export type DiffRowKind = "add" | "remove" | "context";

export interface DiffRow {
  kind: DiffRowKind;
  text: string;
}

interface DiffViewProps {
  rows: ReadonlyArray<DiffRow>;
  showLineNumbers?: boolean;
  className?: string;
}

const MARKER: Record<DiffRowKind, string> = {
  add: "+",
  remove: "−",
  context: " ",
};

export function DiffView({ rows, showLineNumbers = false, className }: DiffViewProps) {
  const classes = ["ep-diff", showLineNumbers && "ep-diff--lined", className]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={classes} role="region" aria-label="Diff">
      {rows.map((row, idx) => (
        <div key={idx} className={`ep-diff__row ep-diff__row--${row.kind}`}>
          {showLineNumbers && <span className="ep-diff__lineno">{idx + 1}</span>}
          <span className="ep-diff__marker" aria-hidden="true">
            {MARKER[row.kind]}
          </span>
          <span className="ep-diff__text">{row.text || " "}</span>
        </div>
      ))}
    </div>
  );
}
