import { createContext, useContext, type ReactNode } from "react";
import {
  persistedSignal,
  signal,
  useConstant,
  type Signal,
} from "./signals.ts";

export type SettingsSection = "style" | "models" | "help";
export type EditorMode = "formatted" | "markdown";

export interface FocusSnapshot {
  fileTree: boolean;
  sidecar: boolean;
  research: boolean;
}

export interface IndexProgress {
  indexed: number;
  total: number;
}

export interface EditorCounts {
  words: number;
  chars: number;
}

export interface UIContextValue {
  // ── Persisted ───────────────────────────────────────────────────────────
  fileTreeCollapsed: Signal<boolean>;

  // ── Panel visibility ────────────────────────────────────────────────────
  showToc: Signal<boolean>;
  showSearch: Signal<boolean>;
  showSettings: Signal<boolean>;
  settingsInitialSection: Signal<SettingsSection>;
  showPlan: Signal<boolean>;

  // ── Plan-panel composer seed ────────────────────────────────────────────
  planSeedGoal: Signal<string>;

  // ── Editor / overlay ────────────────────────────────────────────────────
  editorMode: Signal<EditorMode>;
  editorCounts: Signal<EditorCounts>;
  dismissedLargeFile: Signal<boolean>;
  isDragOver: Signal<boolean>;
  indexProgress: Signal<IndexProgress | null>;
  focusSnapshot: Signal<FocusSnapshot | null>;
}

const Ctx = createContext<UIContextValue | null>(null);

export function useUI(): UIContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useUI must be used inside <UIProvider>");
  return v;
}

export function UIProvider({ children }: { children: ReactNode }) {
  const value = useConstant<UIContextValue>(() => ({
    fileTreeCollapsed: persistedSignal(
      "episteme:filetree-collapsed",
      false,
      { serialize: (v) => (v ? "1" : "0"), deserialize: (raw) => raw === "1" },
    ),
    showToc: signal(false),
    showSearch: signal(false),
    showSettings: signal(false),
    settingsInitialSection: signal<SettingsSection>("style"),
    showPlan: signal(false),
    planSeedGoal: signal(""),
    editorMode: signal<EditorMode>("formatted"),
    editorCounts: signal<EditorCounts>({ words: 0, chars: 0 }),
    dismissedLargeFile: signal(false),
    isDragOver: signal(false),
    indexProgress: signal<IndexProgress | null>(null),
    focusSnapshot: signal<FocusSnapshot | null>(null),
  }));

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
