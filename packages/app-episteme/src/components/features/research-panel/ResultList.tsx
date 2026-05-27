import { ResearchResultRow } from "./ResearchResultRow.tsx";
import type { SearchResult } from "../../../plugins/ResearchPlugin.ts";

interface ResultListProps {
  results: ReadonlyArray<SearchResult>;
  onIngest: (url: string) => void;
}

export function ResultList({ results, onIngest }: ResultListProps) {
  if (results.length === 0) {
    return <div className="research-empty">No results in this category.</div>;
  }
  return (
    <ul className="research-results">
      {results.map((r, i) => (
        <ResearchResultRow key={i} result={r} onIngest={onIngest} />
      ))}
    </ul>
  );
}
