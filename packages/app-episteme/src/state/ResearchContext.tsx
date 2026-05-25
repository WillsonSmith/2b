import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { signal, useConstant, type Signal } from "./signals.ts";
import type { useResearch } from "../hooks/useResearch.ts";

type ResearchReturn = ReturnType<typeof useResearch>;
type SearchResults = ResearchReturn["searchResults"];
type GapReport = ResearchReturn["gapReport"];

export interface ResearchContextValue {
  showResearch: Signal<boolean>;
  searchResults: Signal<SearchResults>;
  gapReport: Signal<GapReport>;
  isSearching: Signal<boolean>;
  isDetectingGaps: Signal<boolean>;

  setShowResearch: (v: boolean) => void;
  toggleShowResearch: () => void;
  setIsSearching: (v: boolean) => void;
  setIsDetectingGaps: (v: boolean) => void;
  handleSearch: (query: string) => void;
  handleDetectGaps: (topic: string) => void;
  handleIngestFromSearch: ResearchReturn["handleIngestFromSearch"];
  handleReindex: () => void;
}

const Ctx = createContext<ResearchContextValue | null>(null);

export function useResearchCtx(): ResearchContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useResearchCtx must be used inside <ResearchProvider>");
  return v;
}

interface ResearchProviderProps {
  research: ResearchReturn;
  children: ReactNode;
}

export function ResearchProvider({ research, children }: ResearchProviderProps) {
  const rRef = useRef(research);
  rRef.current = research;

  const value = useConstant<ResearchContextValue>(() => {
    const showResearch = signal(false);
    const searchResults = signal<SearchResults>(null);
    const gapReport = signal<GapReport>(null);
    const isSearching = signal(false);
    const isDetectingGaps = signal(false);

    return {
      showResearch,
      searchResults,
      gapReport,
      isSearching,
      isDetectingGaps,
      setShowResearch: () => {},
      toggleShowResearch: () => {},
      setIsSearching: () => {},
      setIsDetectingGaps: () => {},
      handleSearch: () => {},
      handleDetectGaps: () => {},
      handleIngestFromSearch: (() => {}) as ResearchReturn["handleIngestFromSearch"],
      handleReindex: () => {},
    };
  });

  useEffect(() => {
    value.setShowResearch = (v) => rRef.current.setShowResearch(v);
    value.toggleShowResearch = () => rRef.current.setShowResearch((v) => !v);
    value.setIsSearching = (v) => rRef.current.setIsSearching(v);
    value.setIsDetectingGaps = (v) => rRef.current.setIsDetectingGaps(v);
    value.handleSearch = (q) => rRef.current.handleSearch(q);
    value.handleDetectGaps = (topic) => rRef.current.handleDetectGaps(topic);
    value.handleIngestFromSearch = ((...args: Parameters<ResearchReturn["handleIngestFromSearch"]>) =>
      rRef.current.handleIngestFromSearch(...args)) as ResearchReturn["handleIngestFromSearch"];
    value.handleReindex = () => rRef.current.handleReindex();
  }, [value]);

  useEffect(() => {
    value.showResearch.value = research.showResearch;
    value.searchResults.value = research.searchResults;
    value.gapReport.value = research.gapReport;
    value.isSearching.value = research.isSearching;
    value.isDetectingGaps.value = research.isDetectingGaps;
  });

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
