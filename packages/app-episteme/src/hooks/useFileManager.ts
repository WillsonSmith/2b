import { useCallback, useEffect, useRef } from "react";
import { getShell } from "../shell/index.ts";
import type { AgentState, Subscribe } from "./useWebSocket.ts";
import { computed, effect, signal, useConstant, type Signal } from "../state/signals.ts";

export interface UseFileManagerReturn {
  // Signals — stable identity; consumers read .value or subscribe.
  activeFile: Signal<string | null>;
  editorContent: Signal<string>;
  savedContent: Signal<string>;
  isDirty: Signal<boolean>;
  workspaceFiles: Signal<string[]>;
  workspaceFolders: Signal<string[]>;
  workspaceName: Signal<string>;
  needsWorkspace: Signal<boolean>;
  isPickingWorkspace: Signal<boolean>;
  autosaveEnabled: Signal<boolean>;
  externalContent: Signal<string | null>;

  // Stable ref kept in sync with editorContent — for useEditorFeatures, which
  // reads `.current` from event handlers (autocomplete, metadata, etc.).
  editorContentRef: React.MutableRefObject<string>;

  // Stable callbacks — never re-created.
  setEditorContent: (v: string | ((prev: string) => string)) => void;
  setWorkspaceName: (v: string) => void;
  setNeedsWorkspace: (v: boolean) => void;
  setAutosaveEnabled: (v: boolean) => void;
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
}

const EDITOR_CONTEXT_DEBOUNCE_MS = 500;
const AUTOSAVE_DEBOUNCE_MS = 2000;

export function useFileManager(
  wsRef: React.MutableRefObject<WebSocket | null>,
  agentState: AgentState,
  subscribe: Subscribe,
): UseFileManagerReturn {
  // ── State signals (stable identity for the hook's lifetime) ─────────────
  const state = useConstant(() => {
    const activeFile = signal<string | null>(null);
    const editorContent = signal("");
    const savedContent = signal("");
    const isDirty = computed(() => editorContent.value !== savedContent.value);
    const workspaceFiles = signal<string[]>([]);
    const workspaceFolders = signal<string[]>([]);
    const workspaceName = signal("workspace");
    const needsWorkspace = signal(false);
    const isPickingWorkspace = signal(false);
    const autosaveEnabled = signal(true);
    const externalContent = signal<string | null>(null);
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
      externalContent,
    };
  });

  // Ref kept in sync with editorContent — useEditorFeatures consumes this from
  // event handlers (it expects `.current`, not a signal).
  const editorContentRef = useRef(state.editorContent.value);
  useEffect(() => {
    return effect(() => {
      editorContentRef.current = state.editorContent.value;
    });
  }, [state]);

  // ── Stable callbacks (closures read signals via .value) ─────────────────
  const setEditorContent = useCallback((v: string | ((prev: string) => string)) => {
    state.editorContent.value = typeof v === "function" ? v(state.editorContent.value) : v;
  }, [state]);
  const setWorkspaceName = useCallback((v: string) => { state.workspaceName.value = v; }, [state]);
  const setNeedsWorkspace = useCallback((v: boolean) => { state.needsWorkspace.value = v; }, [state]);
  const setAutosaveEnabled = useCallback((v: boolean) => { state.autosaveEnabled.value = v; }, [state]);

  const openFile = useCallback((path: string) => {
    state.activeFile.value = path;
    wsRef.current?.send(JSON.stringify({ type: "file_open", path }));
  }, [state, wsRef]);

  const saveFile = useCallback(() => {
    if (!state.activeFile.value || !wsRef.current || !state.isDirty.value) return;
    wsRef.current.send(
      JSON.stringify({ type: "file_save", path: state.activeFile.value, content: state.editorContent.value }),
    );
  }, [state, wsRef]);

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
    if (choice === "reload" && state.externalContent.value !== null) {
      state.editorContent.value = state.externalContent.value;
      state.savedContent.value = state.externalContent.value;
    }
    state.externalContent.value = null;
  }, [state]);

  const handleOpenWorkspace = useCallback(async () => {
    state.isPickingWorkspace.value = true;
    try {
      const folderPath = await getShell().openFolder();
      if (!folderPath) return;
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: folderPath }),
      });
      if (res.ok) state.needsWorkspace.value = false;
    } catch {
      // ignore — user can retry
    } finally {
      state.isPickingWorkspace.value = false;
    }
  }, [state]);

  // ── Debounced editor_context send (per active file) ─────────────────────
  // Reset hash whenever active file changes; fresh hash for a freshly opened
  // file always goes through.
  const lastSentHashRef = useRef("");
  useEffect(() => {
    return state.activeFile.subscribe(() => { lastSentHashRef.current = ""; });
  }, [state]);

  // Debounced send: watches editorContent + activeFile; agentState comes in as
  // a React-level prop so we re-run this effect on connect changes.
  useEffect(() => {
    if (agentState === "disconnected") return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;
    const dispose = effect(() => {
      // Auto-track reads.
      const content = state.editorContent.value;
      const file = state.activeFile.value;
      if (!file || !wsRef.current) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(async () => {
        const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
        const hash = Array.from(new Uint8Array(buf))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        if (cancelled) return;
        if (hash === lastSentHashRef.current) return;
        lastSentHashRef.current = hash;
        wsRef.current?.send(
          JSON.stringify({ type: "editor_context", file, content, cursor: 0 }),
        );
      }, EDITOR_CONTEXT_DEBOUNCE_MS);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      dispose();
    };
  }, [state, agentState, wsRef]);

  // ── Autosave (debounced) ────────────────────────────────────────────────
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const dispose = effect(() => {
      // Auto-track — re-fires on any of these changing.
      const enabled = state.autosaveEnabled.value;
      const dirty = state.isDirty.value;
      const file = state.activeFile.value;
      // Reading editorContent inside the effect ties the debounce timer reset
      // to every keystroke even when isDirty stays true (the prior value
      // matters for re-debouncing).
      state.editorContent.value;
      if (!enabled || !dirty || !file) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(saveFile, AUTOSAVE_DEBOUNCE_MS);
    });
    return () => {
      if (timer) clearTimeout(timer);
      dispose();
    };
  }, [state, saveFile]);

  // ── Cmd+S to save ───────────────────────────────────────────────────────
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

  // ── Server → client subscriptions ───────────────────────────────────────
  useEffect(() => {
    const unsubFiles = subscribe("workspace_files", (msg) => {
      state.workspaceFiles.value = msg.files;
      state.workspaceFolders.value = msg.folders ?? [];
    });
    const unsubContent = subscribe("file_content", (msg) => {
      state.editorContent.value = msg.content;
      state.savedContent.value = msg.content;
      state.externalContent.value = null;
    });
    const unsubCreated = subscribe("file_created", (msg) => {
      state.activeFile.value = msg.path;
      state.editorContent.value = "";
      state.savedContent.value = "";
    });
    const unsubRenamed = subscribe("file_renamed", (msg) => {
      if (state.activeFile.value === msg.oldPath) state.activeFile.value = msg.newPath;
    });
    const unsubDeleted = subscribe("file_deleted", (msg) => {
      if (state.activeFile.value === msg.path) {
        state.activeFile.value = null;
        state.editorContent.value = "";
        state.savedContent.value = "";
      }
    });
    const unsubSaved = subscribe("file_saved", () => {
      state.savedContent.value = state.editorContent.value;
    });
    const unsubExternal = subscribe("file_externally_changed", (msg) => {
      if (msg.path !== state.activeFile.value) return;
      // Spurious watcher event — disk matches what we last wrote.
      if (msg.content === state.savedContent.value) return;
      if (!state.isDirty.value) {
        state.editorContent.value = msg.content;
        state.savedContent.value = msg.content;
      } else {
        state.externalContent.value = msg.content;
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
  }, [state, subscribe]);

  return {
    ...state,
    editorContentRef,
    setEditorContent,
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
    resolveExternalConflict,
  };
}
