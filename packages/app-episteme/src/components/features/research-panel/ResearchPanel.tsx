import { useState } from "react";
import { useAI } from "../../../state/AIContext.tsx";
import { useResearchCtx } from "../../../state/ResearchContext.tsx";
import { useSignalValue } from "../../../state/signals.ts";
import { GapReportModal } from "./GapReportModal.tsx";
import { GapReportSection } from "./GapReportSection.tsx";
import { ResearchSearchForm } from "./ResearchSearchForm.tsx";
import { ResearchTabs } from "./ResearchTabs.tsx";
import { ResultList } from "./ResultList.tsx";
import type { ResearchTab, ResearchView } from "./types.ts";

export function ResearchPanel() {
  const research = useResearchCtx();
  const ai = useAI();
  const searchResults = useSignalValue(research.searchResults);
  const gapReport = useSignalValue(research.gapReport);
  const isSearching = useSignalValue(research.isSearching);
  const isDetectingGaps = useSignalValue(research.isDetectingGaps);

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<ResearchTab>("all");
  const [view, setView] = useState<ResearchView>("search");
  const [gapExpanded, setGapExpanded] = useState(false);

  const onSendToAgent = (text: string) => {
    ai.sendToAgent(text);
    ai.sidecarCollapsed.value = false;
  };

  const submitSearch = () => {
    const q = query.trim();
    if (!q || isSearching) return;
    research.handleSearch(q);
    setView("search");
  };

  const submitGaps = () => {
    const q = query.trim();
    if (!q || isDetectingGaps) return;
    research.handleDetectGaps(q);
    setView("gaps");
  };

  const tabResults =
    searchResults && view === "search"
      ? tab === "all"
        ? searchResults.all
        : searchResults[tab]
      : [];

  return (
    <div className="research-panel">
      <ResearchSearchForm
        query={query}
        onQueryChange={setQuery}
        onSearch={submitSearch}
        onGaps={submitGaps}
        onIndex={research.handleReindex}
        isSearching={isSearching}
        isDetectingGaps={isDetectingGaps}
      />

      <ResearchTabs
        searchResults={searchResults}
        gapReport={gapReport}
        view={view}
        activeTab={tab}
        onSelectSearchTab={(t) => { setView("search"); setTab(t); }}
        onSelectGaps={() => setView("gaps")}
      />

      <div className="research-content">
        {view === "gaps" && (
          <GapReportSection
            gapReport={gapReport}
            isDetectingGaps={isDetectingGaps}
            onExpand={() => setGapExpanded(true)}
            onSendToAgent={onSendToAgent}
          />
        )}

        {view === "search" && (
          isSearching ? (
            <div className="research-empty">Searching…</div>
          ) : searchResults ? (
            <ResultList results={tabResults} onIngest={research.handleIngestFromSearch} />
          ) : (
            <div className="research-empty">
              Search across arXiv, Wikipedia, and your workspace.
            </div>
          )
        )}
      </div>

      {gapReport && (
        <GapReportModal
          open={gapExpanded}
          gapReport={gapReport}
          onClose={() => setGapExpanded(false)}
          onSearch={(q) => {
            research.handleSearch(q);
            setView("search");
          }}
          onSendToAgent={onSendToAgent}
        />
      )}
    </div>
  );
}
