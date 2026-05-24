import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { signal, useConstant, type Signal } from "./signals.ts";
import type { useFileManager } from "../hooks/useFileManager.ts";
import type { useFileTreeState } from "../hooks/useFileTreeState.ts";

type FileManagerReturn = ReturnType<typeof useFileManager>;
type FileTreeStateReturn = ReturnType<typeof useFileTreeState>;

export interface FileContextValue {
  // ── File / editor state (mirrored from useFileManager) ──────────────────
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

  // ── Workspace root (lifted in AppShell so reconnect handler can set it) ─
  workspaceRoot: Signal<string>;

  // ── File-tree expansion state ───────────────────────────────────────────
  expandedDirs: Signal<string[]>;
  setExpandedDirs: (paths: string[]) => void;

  // ── Actions (stable; closures read latest props via refs) ───────────────
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
  fileManager: FileManagerReturn;
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
  const fmRef = useRef(fileManager);
  fmRef.current = fileManager;
  const ftsRef = useRef(fileTreeState);
  ftsRef.current = fileTreeState;
  const setRootRef = useRef(setWorkspaceRoot);
  setRootRef.current = setWorkspaceRoot;

  const value = useConstant<FileContextValue>(() => {
    const activeFile = signal<string | null>(null);
    const editorContent = signal("");
    const isDirty = signal(false);
    const workspaceFiles = signal<string[]>([]);
    const workspaceFolders = signal<string[]>([]);
    const workspaceName = signal("workspace");
    const needsWorkspace = signal(false);
    const isPickingWorkspace = signal(false);
    const externalContent = signal<string | null>(null);
    const autosaveEnabled = signal(true);
    const workspaceRootSig = signal("");
    const expandedDirs = signal<string[]>([]);

    return {
      activeFile,
      editorContent,
      isDirty,
      workspaceFiles,
      workspaceFolders,
      workspaceName,
      needsWorkspace,
      isPickingWorkspace,
      externalContent,
      autosaveEnabled,
      workspaceRoot: workspaceRootSig,
      expandedDirs,

      // Stubs — bound below. Closures read latest props via refs.
      setExpandedDirs: () => {},
      openFile: () => {},
      saveFile: () => {},
      createFile: () => {},
      createFolder: () => {},
      renameFile: () => {},
      renameFolder: () => {},
      deleteFile: () => {},
      refreshFiles: () => {},
      openInFinder: () => {},
      handleOpenWorkspace: () => {},
      resolveExternalConflict: () => {},
      setEditorContent: () => {},
      setWorkspaceName: () => {},
      setNeedsWorkspace: () => {},
      setWorkspaceRoot: () => {},
      setAutosaveEnabled: () => {},
    };
  });

  // Bind actions once; they read latest underlying hook via refs.
  useEffect(() => {
    value.setExpandedDirs = (paths) => ftsRef.current.setExpandedDirs(paths);
    value.openFile = (path) => fmRef.current.openFile(path);
    value.saveFile = () => fmRef.current.saveFile();
    value.createFile = (path) => fmRef.current.createFile(path);
    value.createFolder = (path) => fmRef.current.createFolder(path);
    value.renameFile = (a, b) => fmRef.current.renameFile(a, b);
    value.renameFolder = (a, b) => fmRef.current.renameFolder(a, b);
    value.deleteFile = (path) => fmRef.current.deleteFile(path);
    value.refreshFiles = () => fmRef.current.refreshFiles();
    value.openInFinder = (path) => fmRef.current.openInFinder(path);
    value.handleOpenWorkspace = () => fmRef.current.handleOpenWorkspace();
    value.resolveExternalConflict = (c) => fmRef.current.resolveExternalConflict(c);
    value.setEditorContent = (c) => fmRef.current.setEditorContent(c);
    value.setWorkspaceName = (n) => fmRef.current.setWorkspaceName(n);
    value.setNeedsWorkspace = (v) => fmRef.current.setNeedsWorkspace(v);
    value.setWorkspaceRoot = (r) => setRootRef.current(r);
    value.setAutosaveEnabled = (v) => fmRef.current.setAutosaveEnabled(v);
  }, [value]);

  // Mirror React state → signals after commit. Children that read signals via
  // useSignalValue re-render only when their specific signal changes. Writing
  // an identical value is a no-op on @preact/signals-core, so unchanged fields
  // don't trigger anything.
  useEffect(() => {
    value.activeFile.value = fileManager.activeFile;
    value.editorContent.value = fileManager.editorContent;
    value.isDirty.value = fileManager.isDirty;
    value.workspaceFiles.value = fileManager.workspaceFiles;
    value.workspaceFolders.value = fileManager.workspaceFolders;
    value.workspaceName.value = fileManager.workspaceName;
    value.needsWorkspace.value = fileManager.needsWorkspace;
    value.isPickingWorkspace.value = fileManager.isPickingWorkspace;
    value.externalContent.value = fileManager.externalContent;
    value.autosaveEnabled.value = fileManager.autosaveEnabled;
    value.workspaceRoot.value = workspaceRoot;
    value.expandedDirs.value = fileTreeState.expandedDirs;
  });

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
