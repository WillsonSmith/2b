import { createContext, useContext, useEffect, useRef, type ReactNode } from "react";
import { signal, useConstant, type Signal } from "./signals.ts";
import type { useEditorFeatures } from "../hooks/useEditorFeatures.ts";
import type { TocEntry } from "../features/toc.ts";

type EditorFeaturesReturn = ReturnType<typeof useEditorFeatures>;

interface DiagramResult { code: string; placeholderId: string; error?: string }
interface AIFillResult { id: string; content: string; error?: string }

export interface EditorContextValue {
  // ── State signals (mirrored from useEditorFeatures) ─────────────────────
  ghostText: Signal<string>;
  autocompleteEnabled: Signal<boolean>;
  isGeneratingMetadata: Signal<boolean>;
  metadataResult: Signal<string | null>;
  tocEntries: Signal<TocEntry[]>;
  isTocGenerating: Signal<boolean>;
  diagramResult: Signal<DiagramResult | null>;
  aiFillResult: Signal<AIFillResult | null>;

  // ── Actions ─────────────────────────────────────────────────────────────
  setGhostText: (text: string) => void;
  setAutocompleteEnabled: (v: boolean) => void;
  setIsGeneratingMetadata: (v: boolean) => void;
  setIsTocGenerating: (v: boolean) => void;
  clearMetadata: () => void;
  clearDiagram: () => void;
  clearAIFill: () => void;
  handleAutocompleteRequest: (context: string) => void;
  /** Accept the ghost suggestion; Editor passes the accepted text but the
   *  current implementation just clears the ghost — text param is informational. */
  handleGhostAccept: (text: string) => void;
  handleGhostDismiss: () => void;
  handleMetadataRequest: () => void;
  handleGenerateToc: () => void;
  handleDiagramRequest: (description: string, placeholderId: string) => void;
  handleAIFillRequest: (id: string, instruction: string) => void;
}

const Ctx = createContext<EditorContextValue | null>(null);

export function useEditor(): EditorContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useEditor must be used inside <EditorProvider>");
  return v;
}

interface EditorProviderProps {
  editorFeatures: EditorFeaturesReturn;
  children: ReactNode;
}

export function EditorProvider({ editorFeatures, children }: EditorProviderProps) {
  const efRef = useRef(editorFeatures);
  efRef.current = editorFeatures;

  const value = useConstant<EditorContextValue>(() => {
    const ghostText = signal("");
    const autocompleteEnabled = signal(false);
    const isGeneratingMetadata = signal(false);
    const metadataResult = signal<string | null>(null);
    const tocEntries = signal<TocEntry[]>([]);
    const isTocGenerating = signal(false);
    const diagramResult = signal<DiagramResult | null>(null);
    const aiFillResult = signal<AIFillResult | null>(null);

    return {
      ghostText,
      autocompleteEnabled,
      isGeneratingMetadata,
      metadataResult,
      tocEntries,
      isTocGenerating,
      diagramResult,
      aiFillResult,

      // Stubs — bound below.
      setGhostText: () => {},
      setAutocompleteEnabled: () => {},
      setIsGeneratingMetadata: () => {},
      setIsTocGenerating: () => {},
      clearMetadata: () => {},
      clearDiagram: () => {},
      clearAIFill: () => {},
      handleAutocompleteRequest: () => {},
      handleGhostAccept: () => {},
      handleGhostDismiss: () => {},
      handleMetadataRequest: () => {},
      handleGenerateToc: () => {},
      handleDiagramRequest: () => {},
      handleAIFillRequest: () => {},
    };
  });

  useEffect(() => {
    value.setGhostText = (t) => efRef.current.setGhostText(t);
    value.setAutocompleteEnabled = (v) => efRef.current.setAutocompleteEnabled(v);
    value.setIsGeneratingMetadata = (v) => efRef.current.setIsGeneratingMetadata(v);
    value.setIsTocGenerating = (v) => efRef.current.setIsTocGenerating(v);
    value.clearMetadata = () => efRef.current.clearMetadata();
    value.clearDiagram = () => efRef.current.clearDiagram();
    value.clearAIFill = () => efRef.current.clearAIFill();
    value.handleAutocompleteRequest = (ctx) => efRef.current.handleAutocompleteRequest(ctx);
    value.handleGhostAccept = (_text) => efRef.current.handleGhostAccept();
    value.handleGhostDismiss = () => efRef.current.handleGhostDismiss();
    value.handleMetadataRequest = () => efRef.current.handleMetadataRequest();
    value.handleGenerateToc = () => efRef.current.handleGenerateToc();
    value.handleDiagramRequest = (d, id) => efRef.current.handleDiagramRequest(d, id);
    value.handleAIFillRequest = (id, instr) => efRef.current.handleAIFillRequest(id, instr);
  }, [value]);

  useEffect(() => {
    value.ghostText.value = editorFeatures.ghostText;
    value.autocompleteEnabled.value = editorFeatures.autocompleteEnabled;
    value.isGeneratingMetadata.value = editorFeatures.isGeneratingMetadata;
    value.metadataResult.value = editorFeatures.metadataResult;
    value.tocEntries.value = editorFeatures.tocEntries;
    value.isTocGenerating.value = editorFeatures.isTocGenerating;
    value.diagramResult.value = editorFeatures.diagramResult;
    value.aiFillResult.value = editorFeatures.aiFillResult;
  });

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
