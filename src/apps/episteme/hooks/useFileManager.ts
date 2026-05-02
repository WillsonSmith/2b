import { useCallback, useEffect, useRef, useState } from "react";
import { getShell } from "../shell/index.ts";
import { useDebounce } from "./useDebounce.ts";

type AgentState = "idle" | "thinking" | "disconnected";

export function useFileManager(
  wsRef: React.MutableRefObject<WebSocket | null>,
  agentState: AgentState,
) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceName, setWorkspaceName] = useState("workspace");
  const [needsWorkspace, setNeedsWorkspace] = useState(false);
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false);

  const [autosaveEnabled, setAutosaveEnabled] = useState(true);

  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;

  const debouncedContent = useDebounce(editorContent, 500);

  useEffect(() => {
    if (!activeFile || !wsRef.current || agentState === "disconnected") return;
    wsRef.current.send(
      JSON.stringify({
        type: "editor_context",
        file: activeFile,
        content: debouncedContent,
        cursor: 0,
      }),
    );
  }, [debouncedContent, activeFile, agentState, wsRef]);

  useEffect(() => {
    setIsDirty(editorContent !== savedContent);
  }, [editorContent, savedContent]);

  const openFile = useCallback((path: string) => {
    setActiveFile(path);
    wsRef.current?.send(JSON.stringify({ type: "file_open", path }));
  }, [wsRef]);

  const saveFile = useCallback(() => {
    if (!activeFile || !wsRef.current || !isDirty) return;
    wsRef.current.send(
      JSON.stringify({ type: "file_save", path: activeFile, content: editorContentRef.current }),
    );
  }, [activeFile, isDirty, wsRef]);

  useEffect(() => {
    if (!autosaveEnabled || !isDirty || !activeFile) return;
    const id = setTimeout(saveFile, 2000);
    return () => clearTimeout(id);
  }, [autosaveEnabled, isDirty, activeFile, editorContent, saveFile]);

  const refreshFiles = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "list_workspace" }));
  }, [wsRef]);

  const createFile = useCallback((path: string) => {
    wsRef.current?.send(JSON.stringify({ type: "file_create", path }));
  }, [wsRef]);

  const renameFile = useCallback((oldPath: string, newPath: string) => {
    wsRef.current?.send(JSON.stringify({ type: "file_rename", oldPath, newPath }));
  }, [wsRef]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") {
        e.preventDefault();
        saveFile();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [saveFile]);

  const handleOpenWorkspace = useCallback(async () => {
    setIsPickingWorkspace(true);
    try {
      const shell = getShell();
      const folderPath = await shell.openFolder();
      if (!folderPath) return;
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath }),
      });
      if (res.ok) {
        setNeedsWorkspace(false);
      }
    } catch {
      // ignore — user can retry
    } finally {
      setIsPickingWorkspace(false);
    }
  }, []);

  return {
    activeFile,
    editorContent,
    savedContent,
    isDirty,
    workspaceFiles,
    workspaceName,
    needsWorkspace,
    isPickingWorkspace,
    autosaveEnabled,
    editorContentRef,
    activeFileRef,
    setActiveFile,
    setEditorContent,
    setSavedContent,
    setIsDirty,
    setWorkspaceFiles,
    setWorkspaceName,
    setNeedsWorkspace,
    setAutosaveEnabled,
    openFile,
    saveFile,
    createFile,
    renameFile,
    refreshFiles,
    handleOpenWorkspace,
  };
}
