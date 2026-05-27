import { useRef, type FormEvent } from "react";
import { Button } from "../../primitives/Button.tsx";
import { Input } from "../../primitives/Input.tsx";

interface ResearchSearchFormProps {
  query: string;
  onQueryChange: (q: string) => void;
  onSearch: () => void;
  onGaps: () => void;
  onIndex: () => void;
  isSearching: boolean;
  isDetectingGaps: boolean;
}

export function ResearchSearchForm({
  query,
  onQueryChange,
  onSearch,
  onGaps,
  onIndex,
  isSearching,
  isDetectingGaps,
}: ResearchSearchFormProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!query.trim() || isSearching) return;
    onSearch();
  };

  return (
    <form className="research-form-row" onSubmit={handleSubmit}>
      <Input
        ref={inputRef}
        size="sm"
        className="research-search-input"
        placeholder="Search or topic for gap detection…"
        value={query}
        autoFocus
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            if (query.trim() && !isSearching) onSearch();
          }
        }}
      />
      <Button
        size="sm"
        variant="solid"
        type="submit"
        disabled={isSearching || !query.trim()}
        title="Search arXiv + Wikipedia + Workspace"
      >
        {isSearching ? "…" : "Search"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onGaps}
        disabled={isDetectingGaps || !query.trim()}
        title="Detect knowledge gaps in workspace"
      >
        {isDetectingGaps ? "…" : "Gaps"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onIndex}
        title="Re-index workspace files for search and gap detection"
      >
        Index
      </Button>
    </form>
  );
}
