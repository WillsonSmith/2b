import { useCallback, useEffect, useRef, useState } from "react";
import { getShell } from "../shell/index.ts";
import { useDebounce } from "./useDebounce.ts";
import type { AgentState, Subscribe } from "./useWebSocket.ts";

export function useFileManager(
  wsRef: React.MutableRefObject<WebSocket | null>,
  agentState: AgentState,
  subscribe: Subscribe,
) {
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);

  const [workspaceFiles, setWorkspaceFiles] = useState<string[]>([]);
  const [workspaceFolders, setWorkspaceFolders] = useState<string[]>([]);
  const [workspaceName, setWorkspaceName] = useState("workspace");
  const [needsWorkspace, setNeedsWorkspace] = useState(false);
  const [isPickingWorkspace, setIsPickingWorkspace] = useState(false);

  const [autosaveEnabled, setAutosaveEnabled] = useState(true);
  const [externalContent, setExternalContent] = useState<string | null>(null);

  const editorContentRef = useRef(editorContent);
  editorContentRef.current = editorContent;
  const activeFileRef = useRef(activeFile);
  activeFileRef.current = activeFile;
  const isDirtyRef = useRef(isDirty);
  isDirtyRef.current = isDirty;
  const savedContentRef = useRef(savedContent);
  savedContentRef.current = savedContent;

  const debouncedContent = useDebounce(editorContent, 500);
  const lastSentHashRef = useRef<string>("");

  // Reset the dedupe hash whenever the active file changes so the next push
  // for a freshly opened file always goes through.
  useEffect(() => {
    lastSentHashRef.current = "";
  }, [activeFile]);

  useEffect(() => {
    if (!activeFile || !wsRef.current || agentState === "disconnected") return;
    let cancelled = false;
    (async () => {
      const buf = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(debouncedContent),
      );
      const hash = Array.from(new Uint8Array(buf))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      if (cancelled) return;
      if (hash === lastSentHashRef.current) return;
      lastSentHashRef.current = hash;
      wsRef.current?.send(
        JSON.stringify({
          type: "editor_context",
          file: activeFile,
          content: debouncedContent,
          cursor: 0,
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
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

  const createFolder = useCallback((path: string) => {
    wsRef.current?.send(JSON.stringify({ type: "folder_create", path }));
  }, [wsRef]);

  const renameFolder = useCallback((oldPath: string, newPath: string) => {
    wsRef.current?.send(JSON.stringify({ type: "folder_rename", oldPath, newPath }));
  }, [wsRef]);

  const renameFile = useCallback((oldPath: string, newPath: string) => {
    wsRef.current?.send(JSON.stringify({ type: "file_rename", oldPath, newPath }));
  }, [wsRef]);

  const deleteFile = useCallback((path: string) => {
    wsRef.current?.send(JSON.stringify({ type: "file_delete", path }));
  }, [wsRef]);

  const openInFinder = useCallback((path: string) => {
    wsRef.current?.send(JSON.stringify({ type: "open_in_finder", path }));
  }, [wsRef]);

  const resolveExternalConflict = useCallback((choice: "reload" | "keep") => {
    if (choice === "reload" && externalContent !== null) {
      setEditorContent(externalContent);
      setSavedContent(externalContent);
      setIsDirty(false);
    }
    setExternalContent(null);
  }, [externalContent]);

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

  // Server → client subscriptions
  useEffect(() => {
    const unsubFiles = subscribe("workspace_files", (msg) => {
      setWorkspaceFiles(msg.files);
      setWorkspaceFolders(msg.folders ?? []);
    });
    const unsubContent = subscribe("file_content", (msg) => {
      setEditorContent(msg.content);
      setSavedContent(msg.content);
      setIsDirty(false);
      setExternalContent(null);
    });
    const unsubCreated = subscribe("file_created", (msg) => {
      setActiveFile(msg.path);
      setEditorContent("");
      setSavedContent("");
      setIsDirty(false);
    });
    const unsubRenamed = subscribe("file_renamed", (msg) => {
      if (activeFileRef.current === msg.oldPath) setActiveFile(msg.newPath);
    });
    const unsubDeleted = subscribe("file_deleted", (msg) => {
      if (activeFileRef.current === msg.path) {
        setActiveFile(null);
        setEditorContent("");
        setSavedContent("");
        setIsDirty(false);
      }
    });
    const unsubSaved = subscribe("file_saved", () => {
      setSavedContent(editorContentRef.current);
      setIsDirty(false);
    });
    const unsubExternal = subscribe("file_externally_changed", (msg) => {
      if (msg.path !== activeFileRef.current) return;
      // Spurious watcher event (metadata change, iCloud sync, autosave timing)
      // — content on disk matches what we last wrote, so nothing actually changed.
      if (msg.content === savedContentRef.current) return;
      if (!isDirtyRef.current) {
        setEditorContent(msg.content);
        setSavedContent(msg.content);
        setIsDirty(false);
      } else {
        setExternalContent(msg.content);
      }
    });
    return () => {
      unsubFiles();
      unsubContent();
      unsubCreated();
      unsubRenamed();
      unsubDeleted();
      unsubSaved();
      unsubExternal();
    };
  }, [subscribe]);

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
    workspaceFolders,
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
    createFolder,
    renameFile,
    renameFolder,
    deleteFile,
    refreshFiles,
    openInFinder,
    handleOpenWorkspace,
    externalContent,
    resolveExternalConflict,
  };
}
