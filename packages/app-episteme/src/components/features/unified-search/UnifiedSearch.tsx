import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { SearchResult, UnifiedSearchResponse } from "../../../plugins/ResearchPlugin.ts";
import { CLOSE_ANIMATION_MS, PLACEHOLDERS, SCOPES } from "./constants.ts";
import { fuzzyMatch } from "./pathUtils.ts";
import { SearchInput } from "./SearchInput.tsx";
import { ScopeTabs } from "./ScopeTabs.tsx";
import { FileResultRow } from "./results/FileResultRow.tsx";
import { FullTextResultRow } from "./results/FullTextResultRow.tsx";
import { ResearchResultRow } from "./results/ResearchResultRow.tsx";
import { CommandResultRow } from "./results/CommandResultRow.tsx";
import type { FullTextResult, Scope, SearchCommand } from "./types.ts";

export type { SearchCommand } from "./types.ts";

interface UnifiedSearchProps {
  open: boolean;
  onClose: () => void;
  workspaceFiles: ReadonlyArray<string>;
  onFileSelect: (path: string) => void;
  onResearchSearch: (query: string) => void;
  researchResults: UnifiedSearchResponse | null;
  isResearching: boolean;
  commands: ReadonlyArray<SearchCommand>;
}

export function UnifiedSearch({
  open,
  onClose,
  workspaceFiles,
  onFileSelect,
  onResearchSearch,
  researchResults,
  isResearching,
  commands,
}: UnifiedSearchProps) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<Scope>("files");
  const [activeIndex, setActiveIndex] = useState(0);
  const [fullTextResults, setFullTextResults] = useState<FullTextResult[]>([]);
  const [isSearchingText, setIsSearchingText] = useState(false);
  const [exiting, setExiting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleClose = useCallback(() => {
    if (closeTimerRef.current) return;
    setExiting(true);
    closeTimerRef.current = setTimeout(() => onClose(), CLOSE_ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setScope("files");
      setActiveIndex(0);
      setFullTextResults([]);
      setExiting(false);
      if (closeTimerRef.current) {
        clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // ">" prefix auto-switches to commands
  useEffect(() => {
    if (query.startsWith(">") && scope !== "commands") setScope("commands");
  }, [query, scope]);

  // Full-text search with debounce
  useEffect(() => {
    if (scope !== "fulltext") return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 2) { setFullTextResults([]); return; }
    debounceRef.current = setTimeout(async () => {
      setIsSearchingText(true);
      try {
        const res = await fetch(`/api/search-text?q=${encodeURIComponent(q)}`);
        const data = (await res.json()) as { results: FullTextResult[] };
        setFullTextResults(data.results ?? []);
      } catch {
        setFullTextResults([]);
      } finally {
        setIsSearchingText(false);
      }
    }, 300);
  }, [query, scope]);

  const displayQuery =
    scope === "commands" && query.startsWith(">")
      ? query.slice(1).trim()
      : query;

  const fileResults: string[] =
    scope === "files"
      ? displayQuery
        ? workspaceFiles.filter((f) => fuzzyMatch(displayQuery, f))
        : workspaceFiles.slice(0, 20)
      : [];

  const commandResults: ReadonlyArray<SearchCommand> =
    scope === "commands"
      ? displayQuery
        ? commands.filter((c) => c.label.toLowerCase().includes(displayQuery.toLowerCase()))
        : commands
      : [];

  const researchItems: ReadonlyArray<SearchResult> = researchResults?.all ?? [];

  const totalResults =
    scope === "files" ? fileResults.length
    : scope === "fulltext" ? fullTextResults.length
    : scope === "research" ? researchItems.length
    : commandResults.length;

  useEffect(() => { setActiveIndex(0); }, [query, scope]);

  useEffect(() => {
    const container = resultsRef.current;
    if (!container) return;
    const active = container.querySelector(".usearch-result.active") as HTMLElement | null;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  function selectItem(index: number) {
    if (scope === "files") {
      const file = fileResults[index];
      if (file) { onFileSelect(file); handleClose(); }
    } else if (scope === "commands") {
      const cmd = commandResults[index];
      if (cmd) { cmd.action(); handleClose(); }
    } else if (scope === "fulltext") {
      const r = fullTextResults[index];
      if (r) { onFileSelect(r.path); handleClose(); }
    } else if (scope === "research") {
      const r = researchItems[index];
      if (r?.url) window.open(r.url, "_blank");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") { handleClose(); return; }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => Math.min(i + 1, totalResults - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (scope === "research" && researchItems.length === 0 && query.trim()) {
        onResearchSearch(query.trim());
      } else {
        selectItem(activeIndex);
      }
    } else if (e.key === "Tab") {
      e.preventDefault();
      const next = SCOPES[(SCOPES.indexOf(scope) + 1) % SCOPES.length] ?? "files";
      setScope(next);
    }
  }

  const handleScopeChange = (next: Scope) => {
    setScope(next);
    setActiveIndex(0);
    inputRef.current?.focus();
  };

  if (!open) return null;

  return (
    <div
      className={`usearch-overlay${exiting ? " usearch-overlay--exiting" : ""}`}
      onClick={handleClose}
    >
      <div
        className={`usearch-container${exiting ? " usearch-container--exiting" : ""}`}
        onClick={(e) => e.stopPropagation()}
      >
        <ScopeTabs active={scope} onChange={handleScopeChange} />
        <SearchInput
          inputRef={inputRef}
          value={query}
          onChange={setQuery}
          onKeyDown={handleKeyDown}
          placeholder={PLACEHOLDERS[scope]}
        />

        <div className="usearch-results" ref={resultsRef}>
          {scope === "files" && (
            fileResults.length === 0 && displayQuery ? (
              <div className="usearch-empty">No files match "{displayQuery}"</div>
            ) : fileResults.length === 0 ? (
              <div className="usearch-empty">No files in workspace</div>
            ) : (
              fileResults.map((f, i) => (
                <FileResultRow
                  key={f}
                  path={f}
                  active={i === activeIndex}
                  onSelect={() => selectItem(i)}
                  onHover={() => setActiveIndex(i)}
                />
              ))
            )
          )}

          {scope === "fulltext" && (
            isSearchingText ? (
              <div className="usearch-empty">Searching…</div>
            ) : query.trim().length < 2 ? (
              <div className="usearch-empty">Type at least 2 characters</div>
            ) : fullTextResults.length === 0 ? (
              <div className="usearch-empty">No matches for "{query.trim()}"</div>
            ) : (
              fullTextResults.map((r, i) => (
                <FullTextResultRow
                  key={r.path}
                  result={r}
                  active={i === activeIndex}
                  onSelect={() => selectItem(i)}
                  onHover={() => setActiveIndex(i)}
                />
              ))
            )
          )}

          {scope === "research" && (
            isResearching ? (
              <div className="usearch-empty">Searching…</div>
            ) : researchItems.length > 0 ? (
              researchItems.slice(0, 20).map((r, i) => (
                <ResearchResultRow
                  key={i}
                  result={r}
                  active={i === activeIndex}
                  onSelect={() => selectItem(i)}
                  onHover={() => setActiveIndex(i)}
                />
              ))
            ) : (
              <div className="usearch-empty">
                Press ↵ to search arXiv, Wikipedia &amp; workspace
              </div>
            )
          )}

          {scope === "commands" && (
            commandResults.length === 0 ? (
              <div className="usearch-empty">No commands match</div>
            ) : (
              commandResults.map((cmd, i) => (
                <CommandResultRow
                  key={cmd.id}
                  command={cmd}
                  active={i === activeIndex}
                  onSelect={() => selectItem(i)}
                  onHover={() => setActiveIndex(i)}
                />
              ))
            )
          )}
        </div>

        <div className="usearch-footer">
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>Tab cycle scope</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
