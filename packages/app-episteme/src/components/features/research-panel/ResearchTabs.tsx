import type { UnifiedSearchResponse } from "../../../plugins/ResearchPlugin.ts";
import { SOURCE_META } from "./sourceMeta.ts";
import type { ResearchTab, ResearchView } from "./types.ts";

const SEARCH_TABS: ReadonlyArray<ResearchTab> = ["all", "arxiv", "wikipedia", "workspace"];

interface ResearchTabsProps {
  searchResults: UnifiedSearchResponse | null;
  gapReport: string | null;
  view: ResearchView;
  activeTab: ResearchTab;
  onSelectSearchTab: (tab: ResearchTab) => void;
  onSelectGaps: () => void;
}

function tabLabel(tab: ResearchTab): string {
  return tab === "all" ? "All" : SOURCE_META[tab].label;
}

export function ResearchTabs({
  searchResults,
  gapReport,
  view,
  activeTab,
  onSelectSearchTab,
  onSelectGaps,
}: ResearchTabsProps) {
  if (!searchResults && !gapReport) return null;

  const tabCount = (t: ResearchTab): number => {
    if (!searchResults) return 0;
    return t === "all" ? searchResults.all.length : searchResults[t].length;
  };

  return (
    <div className="research-tabs" role="tablist">
      {searchResults && SEARCH_TABS.map((t) => {
        const count = tabCount(t);
        const active = view === "search" && activeTab === t;
        return (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={active}
            className={`research-tab${active ? " active" : ""}`}
            onClick={() => onSelectSearchTab(t)}
          >
            {tabLabel(t)}
            {count > 0 && <span className="research-tab-count">{count}</span>}
          </button>
        );
      })}
      {gapReport && (
        <button
          type="button"
          role="tab"
          aria-selected={view === "gaps"}
          className={`research-tab${view === "gaps" ? " active" : ""}`}
          onClick={onSelectGaps}
        >
          Gaps
        </button>
      )}
    </div>
  );
}
