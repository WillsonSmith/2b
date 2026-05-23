import { useCallback, useEffect, useRef, useState } from "react";
import { Search, FileText, Globe, Terminal } from "lucide-react";
import type { UnifiedSearchResponse, SearchResult } from "./ResearchPanel.tsx";

type Scope = "files" | "fulltext" | "research" | "commands";

export interface SearchCommand {
  id: string;
  label: string;
  description?: string;
  action: () => void;
}

interface FullTextResult {
  path: string;
  matches: Array<{ line: number; text: string }>;
}

interface UnifiedSearchProps {
  open: boolean;
  onClose: () => void;
  workspaceFiles: string[];
  onFileSelect: (path: string) => void;
  onResearchSearch: (query: string) => void;
  researchResults: UnifiedSearchResponse | null;
  isResearching: boolean;
  commands: SearchCommand[];
}

const SCOPE_LABELS: Record<Scope, string> = {
  files: "Files",
  fulltext: "Full-text",
  research: "Research",
  commands: "Commands",
};

const PLACEHOLDERS: Record<Scope, string> = {
  files: "Find file…",
  fulltext: "Search in notes…",
  research: "Search arXiv, Wikipedia, workspace…",
  commands: "> command",
};

const CLOSE_ANIMATION_MS = 180;

function fuzzyMatch(pattern: string, str: string): boolean {
  const p = pattern.toLowerCase();
  const s = str.toLowerCase();
  let pi = 0;
  for (let i = 0; i < s.length && pi < p.length; i++) {
    if (s[i] === p[pi]) pi++;
  }
  return pi === p.length;
}

function basename(path: string): string {
  return path.split("/").at(-1)?.replace(/\.md$/i, "") ?? path;
}

function dirpart(path: string): string {
  const parts = path.split("/");
  return parts.length > 1 ? parts.slice(0, -1).join("/") : "";
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
    closeTimerRef.current = setTimeout(() => {
      onClose();
    }, CLOSE_ANIMATION_MS);
  }, [onClose]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  // Reset on open
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

  const commandResults: SearchCommand[] =
    scope === "commands"
      ? displayQuery
        ? commands.filter((c) =>
            c.label.toLowerCase().includes(displayQuery.toLowerCase()),
          )
        : commands
      : [];

  const researchItems: SearchResult[] = researchResults?.all ?? [];

  const totalResults =
    scope === "files"
      ? fileResults.length
      : scope === "fulltext"
        ? fullTextResults.length
        : scope === "research"
          ? researchItems.length
          : commandResults.length;

  useEffect(() => {
    setActiveIndex(0);
  }, [query, scope]);

  // Scroll active item into view
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

  function handleKeyDown(e: React.KeyboardEvent) {
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
      const scopes: Scope[] = ["files", "fulltext", "research", "commands"];
      const next = scopes[(scopes.indexOf(scope) + 1) % scopes.length] ?? "files";
      setScope(next);
    }
  }

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
        {/* Scope tabs */}
        <div className="usearch-scopes">
          {(["files", "fulltext", "research", "commands"] as Scope[]).map(
            (s) => (
              <button
                key={s}
                className={`usearch-scope-tab${scope === s ? " active" : ""}`}
                onClick={() => {
                  setScope(s);
                  setActiveIndex(0);
                  inputRef.current?.focus();
                }}
              >
                {SCOPE_LABELS[s]}
              </button>
            ),
          )}
          <span className="usearch-scope-hint">Tab to cycle</span>
        </div>

        {/* Input */}
        <div className="usearch-input-row">
          <Search size={15} className="usearch-input-icon" />
          <input
            ref={inputRef}
            className="usearch-input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={PLACEHOLDERS[scope]}
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        {/* Results */}
        <div className="usearch-results" ref={resultsRef}>
          {scope === "files" && (
            fileResults.length === 0 && displayQuery ? (
              <div className="usearch-empty">No files match "{displayQuery}"</div>
            ) : fileResults.length === 0 ? (
              <div className="usearch-empty">No files in workspace</div>
            ) : (
              fileResults.map((f, i) => (
                <div
                  key={f}
                  className={`usearch-result${i === activeIndex ? " active" : ""}`}
                  onClick={() => selectItem(i)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <FileText size={13} className="usearch-result-icon" />
                  <span className="usearch-result-label">{basename(f)}</span>
                  {dirpart(f) && (
                    <span className="usearch-result-sub">{dirpart(f)}</span>
                  )}
                </div>
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
                <div
                  key={r.path}
                  className={`usearch-result usearch-result--block${i === activeIndex ? " active" : ""}`}
                  onClick={() => selectItem(i)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <div className="usearch-result-main">
                    <FileText size={13} className="usearch-result-icon" />
                    <span className="usearch-result-label">{basename(r.path)}</span>
                    {dirpart(r.path) && (
                      <span className="usearch-result-sub">{dirpart(r.path)}</span>
                    )}
                  </div>
                  {r.matches.map((m, j) => (
                    <div key={j} className="usearch-match-row">
                      <span className="usearch-match-line">:{m.line}</span>
                      <span className="usearch-match-text">{m.text}</span>
                    </div>
                  ))}
                </div>
              ))
            )
          )}

          {scope === "research" && (
            isResearching ? (
              <div className="usearch-empty">Searching…</div>
            ) : researchItems.length > 0 ? (
              researchItems.slice(0, 20).map((r, i) => (
                <div
                  key={i}
                  className={`usearch-result${i === activeIndex ? " active" : ""}`}
                  onClick={() => selectItem(i)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <Globe size={13} className="usearch-result-icon" />
                  <span className="usearch-result-label">{r.title}</span>
                  <span className="usearch-result-sub">{r.source}</span>
                </div>
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
                <div
                  key={cmd.id}
                  className={`usearch-result${i === activeIndex ? " active" : ""}`}
                  onClick={() => selectItem(i)}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <Terminal size={13} className="usearch-result-icon" />
                  <span className="usearch-result-label">{cmd.label}</span>
                  {cmd.description && (
                    <span className="usearch-result-sub">{cmd.description}</span>
                  )}
                </div>
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
