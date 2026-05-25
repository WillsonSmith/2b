import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { signal, useConstant, type Signal } from "./signals.ts";
import type { UseFileManagerReturn } from "../hooks/useFileManager.ts";
import type { useFileTreeState } from "../hooks/useFileTreeState.ts";

type FileTreeStateReturn = ReturnType<typeof useFileTreeState>;

export interface FileContextValue {
  // Signals (sourced directly from useFileManager v2 — no mirror).
  activeFile: Signal<string | null>;
  editorContent: Signal<string>;
  isDirty: Signal<boolean>;
  workspaceFiles: Signal<string[]>;
  workspaceFolders: Signal<string[]>;
  workspaceName: Signal<string>;
  needsWorkspace: Signal<boolean>;
  isPickingWorkspace: Signal<boolean>;
  externalContent: Signal<string | null>;
  autosaveEnabled: Signal<boolean>;

  // workspaceRoot lives in AppShell (lifted so the reconnect handler can set
  // it); mirrored to a signal here so context consumers stay reactive.
  workspaceRoot: Signal<string>;

  // File-tree expansion state — still mirrored from React-state hook.
  expandedDirs: Signal<string[]>;
  setExpandedDirs: (paths: string[]) => void;

  // Actions (stable references from useFileManager v2).
  openFile: (path: string) => void;
  saveFile: () => void;
  createFile: (path: string) => void;
  createFolder: (path: string) => void;
  renameFile: (oldPath: string, newPath: string) => void;
  renameFolder: (oldPath: string, newPath: string) => void;
  deleteFile: (path: string) => void;
  refreshFiles: () => void;
  openInFinder: (path: string) => void;
  handleOpenWorkspace: () => void;
  resolveExternalConflict: (choice: "reload" | "keep") => void;
  setEditorContent: (content: string) => void;
  setWorkspaceName: (name: string) => void;
  setNeedsWorkspace: (v: boolean) => void;
  setWorkspaceRoot: (root: string) => void;
  setAutosaveEnabled: (v: boolean) => void;
}

const Ctx = createContext<FileContextValue | null>(null);

export function useFiles(): FileContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useFiles must be used inside <FileProvider>");
  return v;
}

interface FileProviderProps {
  fileManager: UseFileManagerReturn;
  fileTreeState: FileTreeStateReturn;
  workspaceRoot: string;
  setWorkspaceRoot: (root: string) => void;
  children: ReactNode;
}

export function FileProvider({
  fileManager,
  fileTreeState,
  workspaceRoot,
  setWorkspaceRoot,
  children,
}: FileProviderProps) {
  const ftsRef = useRef(fileTreeState);
  ftsRef.current = fileTreeState;
  const setRootRef = useRef(setWorkspaceRoot);
  setRootRef.current = setWorkspaceRoot;

  // The hook returns are stable across renders, so we can publish them through
  // a constant value object. Two pieces still need mirroring (workspaceRoot
  // and expandedDirs) because their source is React state, not signals.
  const value = useConstant<FileContextValue>(() => {
    const workspaceRootSig = signal("");
    const expandedDirs = signal<string[]>([]);
    return {
      // ── filled in below via assignment (still stable — same object) ──
      activeFile: fileManager.activeFile,
      editorContent: fileManager.editorContent,
      isDirty: fileManager.isDirty,
      workspaceFiles: fileManager.workspaceFiles,
      workspaceFolders: fileManager.workspaceFolders,
      workspaceName: fileManager.workspaceName,
      needsWorkspace: fileManager.needsWorkspace,
      isPickingWorkspace: fileManager.isPickingWorkspace,
      externalContent: fileManager.externalContent,
      autosaveEnabled: fileManager.autosaveEnabled,
      workspaceRoot: workspaceRootSig,
      expandedDirs,
      setExpandedDirs: (paths) => ftsRef.current.setExpandedDirs(paths),
      openFile: fileManager.openFile,
      saveFile: fileManager.saveFile,
      createFile: fileManager.createFile,
      createFolder: fileManager.createFolder,
      renameFile: fileManager.renameFile,
      renameFolder: fileManager.renameFolder,
      deleteFile: fileManager.deleteFile,
      refreshFiles: fileManager.refreshFiles,
      openInFinder: fileManager.openInFinder,
      handleOpenWorkspace: fileManager.handleOpenWorkspace,
      resolveExternalConflict: fileManager.resolveExternalConflict,
      setEditorContent: fileManager.setEditorContent,
      setWorkspaceName: fileManager.setWorkspaceName,
      setNeedsWorkspace: fileManager.setNeedsWorkspace,
      setAutosaveEnabled: fileManager.setAutosaveEnabled,
      setWorkspaceRoot: (r) => setRootRef.current(r),
    };
  });

  // Mirror the two remaining React-state inputs into signals.
  useEffect(() => {
    value.workspaceRoot.value = workspaceRoot;
    value.expandedDirs.value = fileTreeState.expandedDirs;
  });

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
