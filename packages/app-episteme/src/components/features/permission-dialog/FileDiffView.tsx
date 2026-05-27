import { useMemo } from "react";
import { DiffView } from "../../composites/DiffView.tsx";
import { diffLines } from "./diffLines.ts";

interface FileDiffViewProps {
  path: string;
  currentContent: string;
  proposedContent: string;
}

export function FileDiffView({ path, currentContent, proposedContent }: FileDiffViewProps) {
  const rows = useMemo(
    () => diffLines(currentContent, proposedContent),
    [currentContent, proposedContent],
  );
  return (
    <div className="permission-dialog-body">
      <h3 className="permission-dialog-subheading">
        Edit to <code>{path}</code>
      </h3>
      <DiffView rows={rows} />
    </div>
  );
}
