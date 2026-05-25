import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { signal, useConstant, type Signal } from "./signals.ts";
import type { useConflictsAndGraph } from "../hooks/useConflictsAndGraph.ts";

type ConflictsReturn = ReturnType<typeof useConflictsAndGraph>;
type Contradictions = ConflictsReturn["contradictions"];
type GraphData = ConflictsReturn["graphData"];
type GraphPagination = ConflictsReturn["graphPagination"];

export interface ConflictsContextValue {
  showConflicts: Signal<boolean>;
  contradictions: Signal<Contradictions>;
  isScanning: Signal<boolean>;
  showGraph: Signal<boolean>;
  graphData: Signal<GraphData>;
  graphPagination: Signal<GraphPagination>;
  isLoadingGraph: Signal<boolean>;

  setShowConflicts: (v: boolean) => void;
  setShowGraph: (v: boolean) => void;
  setIsScanning: (v: boolean) => void;
  setIsLoadingGraph: (v: boolean) => void;
  handleOpenConflicts: () => void;
  handleContradictionScan: () => void;
  handleOpenGraph: () => void;
  handleRefreshGraph: () => void;
  handleReindex: () => void;
  handleLoadMoreGraph: () => void;
  handleGraphNodeClick: ConflictsReturn["handleGraphNodeClick"];
}

const Ctx = createContext<ConflictsContextValue | null>(null);

export function useConflictsCtx(): ConflictsContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useConflictsCtx must be used inside <ConflictsProvider>");
  return v;
}

interface ConflictsProviderProps {
  conflictsGraph: ConflictsReturn;
  children: ReactNode;
}

export function ConflictsProvider({ conflictsGraph, children }: ConflictsProviderProps) {
  const cRef = useRef(conflictsGraph);
  cRef.current = conflictsGraph;

  const value = useConstant<ConflictsContextValue>(() => {
    const showConflicts = signal(false);
    const contradictions = signal<Contradictions>([]);
    const isScanning = signal(false);
    const showGraph = signal(false);
    const graphData = signal<GraphData>(null);
    const graphPagination = signal<GraphPagination>(null);
    const isLoadingGraph = signal(false);

    return {
      showConflicts,
      contradictions,
      isScanning,
      showGraph,
      graphData,
      graphPagination,
      isLoadingGraph,
      setShowConflicts: () => {},
      setShowGraph: () => {},
      setIsScanning: () => {},
      setIsLoadingGraph: () => {},
      handleOpenConflicts: () => {},
      handleContradictionScan: () => {},
      handleOpenGraph: () => {},
      handleRefreshGraph: () => {},
      handleReindex: () => {},
      handleLoadMoreGraph: () => {},
      handleGraphNodeClick: (() => {}) as ConflictsReturn["handleGraphNodeClick"],
    };
  });

  useEffect(() => {
    value.setShowConflicts = (v) => cRef.current.setShowConflicts(v);
    value.setShowGraph = (v) => cRef.current.setShowGraph(v);
    value.setIsScanning = (v) => cRef.current.setIsScanning(v);
    value.setIsLoadingGraph = (v) => cRef.current.setIsLoadingGraph(v);
    value.handleOpenConflicts = () => cRef.current.handleOpenConflicts();
    value.handleContradictionScan = () => cRef.current.handleContradictionScan();
    value.handleOpenGraph = () => cRef.current.handleOpenGraph();
    value.handleRefreshGraph = () => cRef.current.handleRefreshGraph();
    value.handleReindex = () => cRef.current.handleReindex();
    value.handleLoadMoreGraph = () => cRef.current.handleLoadMoreGraph();
    value.handleGraphNodeClick = ((...args: Parameters<ConflictsReturn["handleGraphNodeClick"]>) =>
      cRef.current.handleGraphNodeClick(...args)) as ConflictsReturn["handleGraphNodeClick"];
  }, [value]);

  useEffect(() => {
    value.showConflicts.value = conflictsGraph.showConflicts;
    value.contradictions.value = conflictsGraph.contradictions;
    value.isScanning.value = conflictsGraph.isScanning;
    value.showGraph.value = conflictsGraph.showGraph;
    value.graphData.value = conflictsGraph.graphData;
    value.graphPagination.value = conflictsGraph.graphPagination;
    value.isLoadingGraph.value = conflictsGraph.isLoadingGraph;
  });

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
