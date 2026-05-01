import { useState, useRef } from "react";
import type { SearchResult, UnifiedSearchResponse } from "../plugins/ResearchPlugin.ts";
import { MarkdownView } from "./MarkdownView.tsx";

export type { SearchResult, UnifiedSearchResponse };

type Tab = "all" | "arxiv" | "wikipedia" | "workspace";

interface ResearchPanelProps {
  onClose: () => void;
  onSearch: (query: string) => void;
  onDetectGaps: (topic: string) => void;
  onIngest: (url: string) => void;
  onReindex: () => void;
  onSendToAgent: (text: string) => void;
  searchResults: UnifiedSearchResponse | null;
  gapReport: string | null;
  isSearching: boolean;
  isDetectingGaps: boolean;
}

const SOURCE_COLORS: Record<SearchResult["source"], { bg: string; fg: string; label: string }> = {
  arxiv:     { bg: "#1a365d", fg: "#90cdf4", label: "arXiv" },
  wikipedia: { bg: "#1a3a1a", fg: "#9ae6b4", label: "Wikipedia" },
  workspace: { bg: "#2d2d2d", fg: "#e2e8f0", label: "Workspace" },
};

/** Extract bullet/numbered list items from a markdown string. */
function parseGapItems(markdown: string): string[] {
  return markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[-*+]\s+/.test(line) || /^\d+\.\s+/.test(line))
    .map((line) => line.replace(/^[-*+]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .filter(Boolean);
}

// ── Expanded gap report modal ─────────────────────────────────────────────────

interface GapReportModalProps {
  gapReport: string;
  onClose: () => void;
  onSearch: (query: string) => void;
  onSendToAgent: (text: string) => void;
}

function GapReportModal({ gapReport, onClose, onSearch, onSendToAgent }: GapReportModalProps) {
  const gapItems = parseGapItems(gapReport);

  function planWithAI() {
    onSendToAgent(
      `Based on the following identified knowledge gaps, help me plan a focused research agenda — suggest what to search for, what questions to answer first, and which gaps are highest priority:\n\n${gapReport}`,
    );
    onClose();
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-gap-expanded" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Knowledge Gaps</span>
          <button className="gap-plan-btn" onClick={planWithAI} title="Send to AI for research planning">
            Plan with AI →
          </button>
          <button className="modal-close" onClick={onClose} title="Close">✕</button>
        </div>

        <div className="gap-expanded-body">
          <div className="gap-expanded-report">
            <MarkdownView content={gapReport} className="gap-markdown" />
          </div>

          {gapItems.length > 0 && (
            <div className="gap-actions-section">
              <div className="gap-actions-heading">Actionable Items</div>
              <div className="gap-actions-list">
                {gapItems.map((item, i) => (
                  <div key={i} className="gap-action-card">
                    <span className="gap-action-text">{item}</span>
                    <button
                      className="gap-action-search-btn"
                      onClick={() => { onSearch(item); onClose(); }}
                      title={`Search: ${item}`}
                    >
                      Search →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ResearchPanel ─────────────────────────────────────────────────────────────

export function ResearchPanel({
  onClose,
  onSearch,
  onDetectGaps,
  onIngest,
  onReindex,
  onSendToAgent,
  searchResults,
  gapReport,
  isSearching,
  isDetectingGaps,
}: ResearchPanelProps) {
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<Tab>("all");
  const [view, setView] = useState<"search" | "gaps">("search");
  const [gapExpanded, setGapExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || isSearching) return;
    onSearch(q);
    setView("search");
  }

  function handleGapsSubmit(e: React.FormEvent) {
    e.preventDefault();
    const q = query.trim();
    if (!q || isDetectingGaps) return;
    onDetectGaps(q);
    setView("gaps");
  }

  const tabResults: SearchResult[] =
    searchResults && view === "search"
      ? tab === "all"
        ? searchResults.all
        : searchResults[tab]
      : [];

  const tabCount = (t: Tab) =>
    searchResults ? (t === "all" ? searchResults.all.length : searchResults[t].length) : 0;

  return (
    <div className="research-panel">
      <div className="research-panel-header">
        <span className="research-panel-title">Research</span>
        <button className="research-panel-close" onClick={onClose} title="Close">✕</button>
      </div>

      {/* Search form */}
      <div className="research-form-row">
        <input
          ref={inputRef}
          className="research-search-input"
          type="text"
          placeholder="Search or topic for gap detection…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSearchSubmit(e as unknown as React.FormEvent); }
          }}
          autoFocus
        />
        <button
          className="research-search-btn"
          onClick={handleSearchSubmit}
          disabled={isSearching || !query.trim()}
          title="Search arXiv + Wikipedia + Workspace"
        >
          {isSearching ? "…" : "Search"}
        </button>
        <button
          className="research-gaps-btn"
          onClick={handleGapsSubmit}
          disabled={isDetectingGaps || !query.trim()}
          title="Detect knowledge gaps in workspace"
        >
          {isDetectingGaps ? "…" : "Gaps"}
        </button>
        <button
          className="research-gaps-btn"
          onClick={onReindex}
          title="Re-index workspace files for search and gap detection"
        >
          Index
        </button>
      </div>

      {/* Tabs */}
      {(searchResults || gapReport) && (
        <div className="research-tabs">
          {searchResults && (["all", "arxiv", "wikipedia", "workspace"] as Tab[]).map((t) => {
            const count = tabCount(t);
            return (
              <button
                key={t}
                className={`research-tab${view === "search" && tab === t ? " active" : ""}`}
                onClick={() => { setView("search"); setTab(t); }}
              >
                {t === "all" ? "All" : SOURCE_COLORS[t as Exclude<Tab, "all">].label}
                {count > 0 && <span className="research-tab-count">{count}</span>}
              </button>
            );
          })}
          {gapReport && (
            <button
              className={`research-tab${view === "gaps" ? " active" : ""}`}
              onClick={() => setView("gaps")}
            >
              Gaps
            </button>
          )}
        </div>
      )}

      {/* Content area */}
      <div className="research-content">
        {/* Gap report view */}
        {view === "gaps" && (
          isDetectingGaps ? (
            <div className="research-empty">Analyzing workspace for gaps…</div>
          ) : gapReport ? (
            <div className="research-gap-report">
              <div className="research-gap-actions">
                <button
                  className="gap-expand-btn"
                  onClick={() => setGapExpanded(true)}
                  title="Open full-screen view"
                >
                  ⤢ Expand
                </button>
                <button
                  className="gap-plan-btn"
                  onClick={() => {
                    onSendToAgent(
                      `Based on the following identified knowledge gaps, help me plan a focused research agenda — suggest what to search for, what questions to answer first, and which gaps are highest priority:\n\n${gapReport}`,
                    );
                  }}
                  title="Send gap report to AI for research planning"
                >
                  Plan with AI →
                </button>
              </div>
              <MarkdownView content={gapReport} className="gap-markdown gap-markdown-narrow" />
            </div>
          ) : (
            <div className="research-empty">
              Enter a topic and click <strong>Gaps</strong> to detect missing perspectives.
            </div>
          )
        )}

        {/* Search results view */}
        {view === "search" && (
          isSearching ? (
            <div className="research-empty">Searching…</div>
          ) : searchResults ? (
            tabResults.length === 0 ? (
              <div className="research-empty">No results in this category.</div>
            ) : (
              <ul className="research-results">
                {tabResults.map((r, i) => {
                  const color = SOURCE_COLORS[r.source];
                  return (
                    <li key={i} className="research-result">
                      <div className="research-result-meta">
                        <span
                          className="research-result-source"
                          style={{ background: color.bg, color: color.fg }}
                        >
                          {color.label}
                        </span>
                        {r.date && (
                          <span className="research-result-date">{r.date.slice(0, 4)}</span>
                        )}
                      </div>
                      <div className="research-result-title">{r.title}</div>
                      {r.authors.length > 0 && (
                        <div className="research-result-authors">
                          {r.authors.join(", ")}
                        </div>
                      )}
                      {r.excerpt && (
                        <div className="research-result-excerpt">{r.excerpt}</div>
                      )}
                      <div className="research-result-actions">
                        {r.source !== "workspace" && r.url && (
                          <button
                            className="research-ingest-btn"
                            onClick={() => onIngest(r.url)}
                            title={`Ingest: ${r.url}`}
                          >
                            Ingest
                          </button>
                        )}
                        {r.source !== "workspace" && r.url && (
                          <a
                            className="research-open-link"
                            href={r.url}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            Open ↗
                          </a>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )
          ) : (
            <div className="research-empty">
              Search across arXiv, Wikipedia, and your workspace.
            </div>
          )
        )}
      </div>

      {/* Expanded gap report modal */}
      {gapExpanded && gapReport && (
        <GapReportModal
          gapReport={gapReport}
          onClose={() => setGapExpanded(false)}
          onSearch={(q) => { onSearch(q); setView("search"); }}
          onSendToAgent={onSendToAgent}
        />
      )}
    </div>
  );
}
