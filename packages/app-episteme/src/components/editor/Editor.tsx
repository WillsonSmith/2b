import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import { Table } from "@tiptap/extension-table";
import { TableRow } from "@tiptap/extension-table-row";
import { TableHeader } from "@tiptap/extension-table-header";
import { TableCell } from "@tiptap/extension-table-cell";
import { useEffect, useRef, useCallback, useState } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import type { LintIssue } from "../../features/lint.ts";
import {
  isLocalLink,
  resolveLocalHref,
  computeRelativeHref,
  rankFilesForLink,
} from "../../features/links.ts";
import type { LinkSuggestionItem } from "../../features/links.ts";
import { GhostTextExtension } from "./extensions/ghostText.ts";
import { LintExtension, resolveIssuePositions, type ResolvedIssue } from "./extensions/lint.ts";
import { FindExtension, resolveFindMatches, type FindMatch, type FindState } from "./extensions/find.ts";
import { MarkdownRevealExtension } from "./extensions/markdownReveal.ts";
import {
  MarkdownLinkDecorationExtension,
  resolveMarkdownLinks,
  type ResolvedLocalLink,
} from "./extensions/markdownLinks.ts";
import { DiagramCommandExtension } from "./extensions/diagramCommand.ts";
import { MermaidCodeBlock } from "./extensions/mermaid.tsx";
import { DiagramPlaceholderExtension } from "./extensions/diagramPlaceholder.tsx";
import { AIFillBlockExtension } from "./extensions/aiFillBlock.tsx";
import { AIFillCommandExtension } from "./extensions/aiFillCommand.ts";
import { EditorBubbleMenu } from "./BubbleMenu.tsx";
import { LinkPicker } from "./LinkPicker.tsx";
import { MarkdownToolbar } from "./MarkdownToolbar.tsx";
import { FrontmatterPanel } from "./FrontmatterPanel.tsx";
import { useImagePaste } from "./imagePaste.ts";
import { parseFrontmatter } from "../../features/frontmatter.ts";

// prosemirror-markdown's esc() escapes every [ and ] in text nodes, turning
// [[wikilink]] into \[\[wikilink\]\] on save. Unescape double-bracket patterns
// after serialization so any remaining wikilinks survive round-trips.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getMarkdown(ed: any): string {
  return (ed.storage.markdown.getMarkdown() as string).replace(/\\\[\\\[([^\n]*?)\\\]\\\]/g, "[[$1]]");
}

interface EditorProps {
  content: string;
  onUpdate: (markdown: string) => void;
  onAutocompleteRequest?: (context: string) => void;
  ghostText?: string;
  onGhostAccept?: (text: string) => void;
  onGhostDismiss?: () => void;
  toneReplacement?: { text: string; from: number; to: number } | null;
  summarizeResult?: { text: string; insertPos: number } | null;
  onToneApplied?: () => void;
  onSummarizeApplied?: () => void;
  lintIssues?: LintIssue[];
  onMetadataRequest?: () => void;
  isGeneratingMetadata?: boolean;
  onDiagramRequest?: (description: string, placeholderId: string) => void;
  diagramResult?: { code: string; placeholderId: string } | null;
  onDiagramApplied?: () => void;
  onAIFillRequest?: (id: string, instruction: string) => void;
  aiFillResult?: { id: string; content: string; error?: string } | null;
  onAIFillApplied?: () => void;
  metadataResult?: string | null;
  onMetadataApplied?: () => void;
  tableResult?: { text: string; insertPos: number } | null;
  onTableApplied?: () => void;
  onImagePaste?: (base64: string, mimeType: string, filename: string) => void;
  onExplainCode?: (code: string, language: string) => void;
  isRecording?: boolean;
  onToggleRecording?: () => void;
  onSendToChat?: (selectionRef: string) => void;
  onNavigate?: (path: string) => void;
  onCreateFile?: (path: string) => void;
  workspaceFiles?: string[];
  onCountsChange?: (words: number, chars: number) => void;
  editorMode?: "formatted" | "markdown";
  currentFilePath?: string;
}

interface FindBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  matchCount: number;
  currentIndex: number;
  caseSensitive: boolean;
  onToggleCase: () => void;
  onNext: () => void;
  onPrev: () => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function FindBar({
  query, onQueryChange, matchCount, currentIndex,
  caseSensitive, onToggleCase, onNext, onPrev, onClose, inputRef,
}: FindBarProps) {
  return (
    <div className="find-bar" role="search">
      <input
        ref={inputRef}
        className="find-input"
        type="text"
        placeholder="Find in document"
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            if (e.shiftKey) onPrev(); else onNext();
          } else if (e.key === "Escape") {
            e.preventDefault();
            onClose();
          }
        }}
        autoFocus
      />
      <span className="find-count">
        {query === "" ? "" : matchCount === 0 ? "No matches" : `${currentIndex + 1} of ${matchCount}`}
      </span>
      <button
        className={`find-btn${caseSensitive ? " active" : ""}`}
        title="Match case"
        onClick={onToggleCase}
        type="button"
      >
        Aa
      </button>
      <button
        className="find-btn"
        title="Previous match (⇧↵)"
        onClick={onPrev}
        disabled={matchCount === 0}
        type="button"
      >
        <ChevronUp size={14} />
      </button>
      <button
        className="find-btn"
        title="Next match (↵)"
        onClick={onNext}
        disabled={matchCount === 0}
        type="button"
      >
        <ChevronDown size={14} />
      </button>
      <button className="find-btn" title="Close (Esc)" onClick={onClose} type="button">
        <X size={14} />
      </button>
    </div>
  );
}


interface DiagramBarProps {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
  onClose: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function DiagramBar({ value, onChange, onSubmit, onClose, inputRef }: DiagramBarProps) {
  return (
    <div className="diagram-bar" role="dialog" aria-label="Insert diagram">
      <input
        ref={inputRef}
        className="diagram-input"
        type="text"
        placeholder="Describe your diagram…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); onSubmit(); }
          else if (e.key === "Escape") { e.preventDefault(); onClose(); }
        }}
        autoFocus
      />
      <button
        className="diagram-submit-btn toolbar-btn"
        onClick={onSubmit}
        disabled={!value.trim()}
        type="button"
      >
        Generate
      </button>
      <button className="find-btn" title="Close (Esc)" onClick={onClose} type="button">
        <X size={14} />
      </button>
    </div>
  );
}

export function Editor({
  content,
  onUpdate,
  onAutocompleteRequest,
  ghostText = "",
  onGhostAccept,
  onGhostDismiss,
  toneReplacement,
  summarizeResult,
  onToneApplied,
  onSummarizeApplied,
  lintIssues = [],
  onMetadataRequest,
  isGeneratingMetadata,
  onDiagramRequest,
  diagramResult,
  onDiagramApplied,
  onAIFillRequest,
  aiFillResult,
  onAIFillApplied,
  metadataResult,
  onMetadataApplied,
  tableResult,
  onTableApplied,
  onImagePaste,
  onExplainCode,
  isRecording,
  onToggleRecording,
  onSendToChat,
  onNavigate,
  onCreateFile,
  workspaceFiles = [],
  onCountsChange,
  editorMode: editorModeProp = "formatted",
  currentFilePath = "",
}: EditorProps) {
  const ghostRef = useRef(ghostText);
  const lintRef = useRef<ResolvedIssue[]>([]);
  const localLinksRef = useRef<ResolvedLocalLink[]>([]);
  const filesRef = useRef<string[]>(workspaceFiles);
  filesRef.current = workspaceFiles;
  const currentFileRef = useRef(currentFilePath);
  currentFileRef.current = currentFilePath;

  const findStateRef = useRef<FindState>({ matches: [], activeIndex: 0 });
  const [frontmatter, setFrontmatter] = useState<string | null>(
    () => parseFrontmatter(content).yaml,
  );
  const frontmatterRef = useRef(frontmatter);
  frontmatterRef.current = frontmatter;
  const editorMode = editorModeProp;
  const prevEditorMode = useRef(editorModeProp);
  const [rawContent, setRawContent] = useState("");

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<FindMatch[]>([]);
  const [findIndex, setFindIndex] = useState(0);
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  // Link picker state
  const [linkPickerOpen, setLinkPickerOpen] = useState(false);
  const [linkPickerQuery, setLinkPickerQuery] = useState("");
  const [linkPickerPos, setLinkPickerPos] = useState<{ top: number; left: number } | null>(null);
  const [linkPickerSelection, setLinkPickerSelection] = useState<{ from: number; to: number } | null>(null);
  const [linkPickerSelectedIndex, setLinkPickerSelectedIndex] = useState(0);

  const linkPickerMatches: LinkSuggestionItem[] = linkPickerOpen
    ? rankFilesForLink(filesRef.current, linkPickerQuery)
    : [];

  const [codeHover, setCodeHover] = useState<{
    code: string;
    language: string;
    top: number;
    right: number;
  } | null>(null);

  const acceptRef = useRef(onGhostAccept);
  const dismissRef = useRef(onGhostDismiss);
  acceptRef.current = onGhostAccept;
  dismissRef.current = onGhostDismiss;
  const diagramCallbackRef = useRef<((description: string, placeholderId: string) => void) | undefined>(undefined);
  diagramCallbackRef.current = onDiagramRequest;
  const aiFillCallbackRef = useRef<((id: string, instruction: string) => void) | undefined>(undefined);
  aiFillCallbackRef.current = onAIFillRequest;
  const fillQueueRef = useRef<string[]>([]);

  const [diagramBarOpen, setDiagramBarOpen] = useState(false);
  const [diagramBarInput, setDiagramBarInput] = useState("");
  const diagramInsertPosRef = useRef<number>(0);
  const diagramBarInputRef = useRef<HTMLInputElement | null>(null);

  const handleAccept = useCallback((t: string) => acceptRef.current?.(t), []);
  const handleDismiss = useCallback(() => dismissRef.current?.(), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false }, codeBlock: false }),
      MermaidCodeBlock,
      DiagramPlaceholderExtension,
      Markdown.configure({ transformPastedText: true }),
      Placeholder.configure({ placeholder: "Start writing… (type /diagram <description> to insert a diagram)" }),
      CharacterCount,
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false, renderWrapper: true }),
      TableRow,
      TableHeader,
      TableCell,
      GhostTextExtension(ghostRef, handleAccept, handleDismiss),
      LintExtension(lintRef),
      FindExtension(findStateRef),
      MarkdownRevealExtension,
      DiagramCommandExtension(diagramCallbackRef),
      AIFillBlockExtension(aiFillCallbackRef),
      AIFillCommandExtension,
      MarkdownLinkDecorationExtension(localLinksRef),
    ],
    content: parseFrontmatter(content).body.trimStart(),
    onUpdate({ editor }) {
      const body = getMarkdown(editor);
      const fm = frontmatterRef.current;
      onUpdate(fm != null ? `---\n${fm}\n---\n\n${body.trimStart()}` : body);
    },
    editorProps: {
      attributes: { class: "tiptap" },
    },
  });

  useEffect(() => {
    ghostRef.current = ghostText;
    if (editor) {
      const { tr } = editor.state;
      editor.view.dispatch(tr.setMeta("ghost-refresh", true));
    }
  }, [ghostText, editor]);

  useEffect(() => {
    if (!editor) return;
    const { yaml, body } = parseFrontmatter(content);
    frontmatterRef.current = yaml;
    setFrontmatter(yaml);
    const trimmedBody = body.trimStart();
    const current = getMarkdown(editor);
    if (current !== trimmedBody) {
      editor.commands.setContent(trimmedBody, { emitUpdate: false });
    }
    // Refresh link decorations after content load
    localLinksRef.current = resolveMarkdownLinks(editor.state.doc, filesRef.current, currentFileRef.current);
    editor.view.dispatch(editor.state.tr.setMeta("markdown-link-refresh", true));
  }, [content]);

  useEffect(() => {
    if (!editor || !toneReplacement) return;
    const { from, to, text } = toneReplacement;
    editor.chain().focus().insertContentAt({ from, to }, text).run();
    onToneApplied?.();
  }, [toneReplacement]);

  useEffect(() => {
    if (!editor || !summarizeResult) return;
    const { insertPos, text } = summarizeResult;
    editor.chain().focus().insertContentAt(insertPos, {
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: `[TL;DR]: ${text}` }] }],
    }).run();
    onSummarizeApplied?.();
  }, [summarizeResult]);

  useEffect(() => {
    if (!editor || !diagramResult) return;
    const { code, placeholderId } = diagramResult;
    const replacement = "```mermaid\n" + code + "\n```";
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "diagramPlaceholder" && node.attrs.id === placeholderId) {
        editor.chain().focus().insertContentAt({ from: pos, to: pos + node.nodeSize }, replacement).run();
        return false;
      }
    });
    onDiagramApplied?.();
  }, [diagramResult]);

  useEffect(() => {
    if (!editor || !aiFillResult) return;
    const { id, content, error } = aiFillResult;
    console.log("[ai-fill] result received", { id, hasContent: !!content, error });
    let target: { pos: number; size: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "aiFillBlock" && node.attrs.id === id) {
        target = { pos, size: node.nodeSize };
        return false;
      }
      return undefined;
    });
    if (!target) {
      console.warn("[ai-fill] no matching block found for id", id);
      onAIFillApplied?.();
      return;
    }
    const { pos, size } = target as { pos: number; size: number };
    if (error || !content.trim()) {
      const node = editor.state.doc.nodeAt(pos);
      const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
        ...node?.attrs,
        generating: false,
      });
      editor.view.dispatch(tr);
      const message = error ?? "AI fill returned empty content";
      console.error("[ai-fill]", message);
      onAIFillApplied?.();
      advanceFillQueue();
      return;
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parser = (editor.storage as any).markdown?.parser;
    let inserted = false;
    if (parser) {
      try {
        const parsedDoc = parser.parse(content);
        if (parsedDoc?.content?.childCount > 0) {
          const tr = editor.state.tr;
          tr.replaceWith(pos, pos + size, parsedDoc.content);
          editor.view.dispatch(tr);
          inserted = true;
        }
      } catch (e) {
        console.warn("[ai-fill] markdown parse failed, falling back to text insert", e);
      }
    }
    if (!inserted) {
      editor.chain().focus().insertContentAt({ from: pos, to: pos + size }, content).run();
    }
    onAIFillApplied?.();
    advanceFillQueue();
  }, [aiFillResult]);

  useEffect(() => {
    if (!editor || !metadataResult) return;
    setFrontmatter(metadataResult);
    const body = getMarkdown(editor);
    onUpdate(`---\n${metadataResult}\n---\n\n${body.trimStart()}`);
    onMetadataApplied?.();
  }, [metadataResult]);

  const handleFrontmatterChange = useCallback(
    (newYaml: string | null) => {
      setFrontmatter(newYaml);
      if (!editor) return;
      const body = getMarkdown(editor);
      onUpdate(
        newYaml != null
          ? `---\n${newYaml}\n---\n\n${body.trimStart()}`
          : body,
      );
    },
    [editor, onUpdate],
  );

  useEffect(() => {
    if (!editor || !tableResult) return;
    const { insertPos, text } = tableResult;
    editor.chain().focus().insertContentAt(insertPos, "\n\n" + text + "\n\n").run();
    onTableApplied?.();
  }, [tableResult]);

  useEffect(() => {
    if (!editor) return;
    lintRef.current = resolveIssuePositions(editor.state.doc, lintIssues);
    const { tr } = editor.state;
    editor.view.dispatch(tr.setMeta("lint-refresh", true));
  }, [lintIssues, editor]);

  // Refresh link decorations when files list or current file changes
  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      localLinksRef.current = resolveMarkdownLinks(editor.state.doc, filesRef.current, currentFileRef.current);
      editor.view.dispatch(editor.state.tr.setMeta("markdown-link-refresh", true));
    };
    refresh();
    editor.on("update", refresh);
    return () => { editor.off("update", refresh); };
  }, [editor, workspaceFiles, currentFilePath]);

  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        setFindOpen(true);
        requestAnimationFrame(() => findInputRef.current?.select());
      }
    }
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  useEffect(() => {
    if (!editor) return;
    if (!findOpen || !findQuery) {
      setFindMatches([]);
      setFindIndex(0);
      return;
    }
    const recompute = () => {
      const ms = resolveFindMatches(editor.state.doc, findQuery, findCaseSensitive);
      setFindMatches(ms);
      setFindIndex((prev) => (ms.length === 0 ? 0 : Math.min(prev, ms.length - 1)));
    };
    recompute();
    editor.on("update", recompute);
    return () => { editor.off("update", recompute); };
  }, [editor, findOpen, findQuery, findCaseSensitive]);

  useEffect(() => {
    if (!editor) return;
    findStateRef.current = { matches: findMatches, activeIndex: findIndex };
    editor.view.dispatch(editor.state.tr.setMeta("find-refresh", true));
    if (findMatches.length === 0) return;
    requestAnimationFrame(() => {
      const el = editor.view.dom.querySelector(".find-match-active");
      if (el && el instanceof HTMLElement) {
        el.scrollIntoView({ block: "center", behavior: "smooth" });
      }
    });
  }, [findMatches, findIndex, editor]);

  const onFindNext = useCallback(() => {
    setFindIndex((i) => (findMatches.length === 0 ? 0 : (i + 1) % findMatches.length));
  }, [findMatches.length]);

  const onFindPrev = useCallback(() => {
    setFindIndex((i) =>
      findMatches.length === 0 ? 0 : (i - 1 + findMatches.length) % findMatches.length,
    );
  }, [findMatches.length]);

  const onFindClose = useCallback(() => {
    setFindOpen(false);
    setFindQuery("");
    editor?.commands.focus();
  }, [editor]);

  const openDiagramBar = useCallback(() => {
    diagramInsertPosRef.current = editor?.state.selection.from ?? 0;
    setDiagramBarInput("");
    setDiagramBarOpen(true);
    requestAnimationFrame(() => diagramBarInputRef.current?.focus());
  }, [editor]);

  const triggerFill = useCallback((id: string) => {
    if (!editor) return false;
    let started = false;
    editor.state.doc.descendants((node, pos) => {
      if (started) return false;
      if (node.type.name === "aiFillBlock" && node.attrs.id === id) {
        const instruction = node.textContent.trim();
        if (!instruction) return false;
        const tr = editor.state.tr.setNodeMarkup(pos, undefined, {
          ...node.attrs,
          generating: true,
        });
        editor.view.dispatch(tr);
        aiFillCallbackRef.current?.(id, instruction);
        started = true;
        return false;
      }
      return undefined;
    });
    return started;
  }, [editor]);

  const advanceFillQueue = useCallback(() => {
    while (fillQueueRef.current.length > 0) {
      const nextId = fillQueueRef.current.shift()!;
      if (triggerFill(nextId)) return;
    }
  }, [triggerFill]);

  const processAllFills = useCallback(() => {
    if (!editor) return;
    const ids: string[] = [];
    editor.state.doc.descendants((node) => {
      if (node.type.name === "aiFillBlock" && !node.attrs.generating) {
        const id = node.attrs.id as string | null;
        if (id && node.textContent.trim()) ids.push(id);
      }
      return undefined;
    });
    if (ids.length === 0) return;
    fillQueueRef.current = ids;
    advanceFillQueue();
  }, [editor, advanceFillQueue]);

  const submitDiagram = useCallback(() => {
    const description = diagramBarInput.trim();
    if (!description || !editor || !onDiagramRequest) return;
    const placeholderId = crypto.randomUUID();
    editor.chain().focus().insertContentAt(diagramInsertPosRef.current, {
      type: "diagramPlaceholder",
      attrs: { id: placeholderId },
    }).run();
    onDiagramRequest(description, placeholderId);
    setDiagramBarOpen(false);
    setDiagramBarInput("");
  }, [diagramBarInput, editor, onDiagramRequest]);

  // ── Link picker ──────────────────────────────────────────────────────────────

  const openLinkPicker = useCallback(() => {
    if (!editor) return;
    let { from, to } = editor.state.selection;

    // If cursor is inside a link mark, expand selection to the full link extent
    if (editor.isActive("link")) {
      const { doc } = editor.state;
      const linkType = editor.schema.marks.link;
      // Walk backward to find the start of the link mark
      let linkFrom = from;
      let probe = from - 1;
      while (probe >= 0) {
        const $probe = doc.resolve(probe);
        const nodeAfter = $probe.nodeAfter;
        if (!nodeAfter || !nodeAfter.isText) break;
        if (!nodeAfter.marks.some((m) => m.type === linkType)) break;
        linkFrom = probe;
        probe -= nodeAfter.nodeSize;
      }
      // Walk forward to find the end of the link mark
      let linkTo = to;
      probe = from;
      while (probe <= doc.content.size) {
        const $probe = doc.resolve(probe);
        const nodeAfter = $probe.nodeAfter;
        if (!nodeAfter || !nodeAfter.isText) break;
        if (!nodeAfter.marks.some((m) => m.type === linkType)) break;
        linkTo = probe + nodeAfter.nodeSize;
        probe += nodeAfter.nodeSize;
      }
      from = linkFrom;
      to = linkTo;
    }

    const coords = editor.view.coordsAtPos(from);
    setLinkPickerSelection({ from, to });
    setLinkPickerQuery("");
    setLinkPickerSelectedIndex(0);
    setLinkPickerPos({ top: coords.bottom + 6, left: coords.left });
    setLinkPickerOpen(true);
  }, [editor]);

  const acceptLinkSuggestion = useCallback((targetPath: string) => {
    if (!editor || !linkPickerSelection) return;
    const href = currentFileRef.current
      ? computeRelativeHref(currentFileRef.current, targetPath)
      : targetPath;
    const basename = targetPath.split("/").at(-1)?.replace(/\.md$/i, "") ?? targetPath;
    const { from, to } = linkPickerSelection;

    if (from === to) {
      // No selection — insert link with basename as text
      editor.chain().focus().insertContentAt(from, {
        type: "text",
        text: basename,
        marks: [{ type: "link", attrs: { href } }],
      }).run();
    } else {
      // Wrap selection in link
      editor.chain().focus()
        .setTextSelection({ from, to })
        .setLink({ href })
        .run();
    }
    setLinkPickerOpen(false);
    editor.commands.focus();
  }, [editor, linkPickerSelection]);

  const closeLinkPicker = useCallback(() => {
    setLinkPickerOpen(false);
    editor?.commands.focus();
  }, [editor]);

  // ── Autocomplete ─────────────────────────────────────────────────────────────

  const autocompleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAutocomplete = useCallback(() => {
    if (!onAutocompleteRequest || !editor) return;
    if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    autocompleteTimer.current = setTimeout(() => {
      const { from, to } = editor.state.selection;
      if (from !== to) return;
      const md = getMarkdown(editor);
      if (md.trim().length > 10) onAutocompleteRequest(md);
    }, 800);
  }, [onAutocompleteRequest, editor]);

  const handleSelectionUpdate = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from !== to) {
      if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
      onGhostDismiss?.();
    }
  }, [editor, onGhostDismiss]);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", handleAutocomplete);
    editor.on("selectionUpdate", handleSelectionUpdate);
    return () => {
      editor.off("update", handleAutocomplete);
      editor.off("selectionUpdate", handleSelectionUpdate);
      if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    };
  }, [editor, handleAutocomplete, handleSelectionUpdate]);

  useImagePaste(editor, onImagePaste);

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onCreateFileRef = useRef(onCreateFile);
  onCreateFileRef.current = onCreateFile;

  // ── Click handling (links + wikilinks) ──────────────────────────────────────

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href) return;
      if (!isLocalLink(href)) return;
      e.preventDefault();
      if (!(e.metaKey || e.ctrlKey) || !onNavigateRef.current) return;
      const resolved = resolveLocalHref(href, currentFileRef.current, filesRef.current);
      if (resolved) {
        onNavigateRef.current(resolved);
      } else {
        onCreateFileRef.current?.(href.replace(/\.md$/i, "").trim() + ".md");
      }
    };
    dom.addEventListener("click", handleClick);
    return () => dom.removeEventListener("click", handleClick);
  }, [editor]);

  const onExplainCodeRef = useRef(onExplainCode);
  onExplainCodeRef.current = onExplainCode;

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;

    const handleMouseOver = (e: MouseEvent) => {
      const pre = (e.target as HTMLElement).closest("pre");
      if (!pre) return;
      const codeEl = pre.querySelector("code");
      if (!codeEl) return;
      const language = Array.from(codeEl.classList)
        .find((c) => c.startsWith("language-"))
        ?.replace("language-", "") ?? "text";
      const rect = pre.getBoundingClientRect();
      setCodeHover({
        code: codeEl.textContent ?? "",
        language,
        top: rect.top,
        right: window.innerWidth - rect.right,
      });
    };

    const handleMouseOut = (e: MouseEvent) => {
      const pre = (e.target as HTMLElement).closest("pre");
      if (!pre) return;
      const related = e.relatedTarget as HTMLElement | null;
      if (!related || !pre.contains(related)) {
        setCodeHover(null);
      }
    };

    dom.addEventListener("mouseover", handleMouseOver);
    dom.addEventListener("mouseout", handleMouseOut);
    return () => {
      dom.removeEventListener("mouseover", handleMouseOver);
      dom.removeEventListener("mouseout", handleMouseOut);
    };
  }, [editor]);

  const onCountsChangeRef = useRef(onCountsChange);
  onCountsChangeRef.current = onCountsChange;

  useEffect(() => {
    if (!editor) return;
    const emit = () => {
      onCountsChangeRef.current?.(
        editor.storage.characterCount?.words() ?? 0,
        editor.storage.characterCount?.characters() ?? 0,
      );
    };
    emit();
    editor.on("update", emit);
    return () => { editor.off("update", emit); };
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    if (prevEditorMode.current === editorMode) return;
    if (editorMode === "markdown") {
      const body = getMarkdown(editor);
      const fm = frontmatterRef.current;
      setRawContent(
        fm != null ? `---\n${fm}\n---\n\n${body.trimStart()}` : body,
      );
    }
    prevEditorMode.current = editorMode;
  }, [editor, editorMode]);

  useEffect(() => {
    if (editorMode === "markdown") setRawContent(content);
  }, [content, editorMode]);

  const handleRawChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setRawContent(e.target.value);
    onUpdate(e.target.value);
  }, [onUpdate]);

  return (
    <div className="editor-pane">
      {findOpen && (
        <FindBar
          query={findQuery}
          onQueryChange={setFindQuery}
          matchCount={findMatches.length}
          currentIndex={findIndex}
          caseSensitive={findCaseSensitive}
          onToggleCase={() => setFindCaseSensitive((v) => !v)}
          onNext={onFindNext}
          onPrev={onFindPrev}
          onClose={onFindClose}
          inputRef={findInputRef}
        />
      )}
      {diagramBarOpen && (
        <DiagramBar
          value={diagramBarInput}
          onChange={setDiagramBarInput}
          onSubmit={submitDiagram}
          onClose={() => { setDiagramBarOpen(false); editor?.commands.focus(); }}
          inputRef={diagramBarInputRef}
        />
      )}
      <MarkdownToolbar
        editor={editor}
        onMetadataRequest={onMetadataRequest}
        isGeneratingMetadata={isGeneratingMetadata}
        onToggleRecording={onToggleRecording}
        isRecording={isRecording}
        onOpenDiagramBar={openDiagramBar}
        onOpenLinkPicker={openLinkPicker}
        onProcessAllFills={processAllFills}
      />

      <div className="editor-scroll">
        {editor && (
          <EditorBubbleMenu
            editor={editor}
            onOpenLinkPicker={openLinkPicker}
            onSendToChat={onSendToChat}
            currentFilePath={currentFilePath}
          />
        )}

        {editorMode === "markdown" ? (
          <textarea
            className="editor-raw"
            value={rawContent}
            onChange={handleRawChange}
            spellCheck={false}
          />
        ) : (
          <>
            <FrontmatterPanel
              yaml={frontmatter}
              onChange={handleFrontmatterChange}
            />
            <EditorContent editor={editor} />
          </>
        )}
      </div>

      {linkPickerOpen && linkPickerPos && (
        <LinkPicker
          top={linkPickerPos.top}
          left={linkPickerPos.left}
          query={linkPickerQuery}
          onQueryChange={(q) => { setLinkPickerQuery(q); setLinkPickerSelectedIndex(0); }}
          matches={linkPickerMatches}
          selectedIndex={linkPickerSelectedIndex}
          onHover={setLinkPickerSelectedIndex}
          onAccept={acceptLinkSuggestion}
          onClose={closeLinkPicker}
        />
      )}

      {codeHover && onExplainCode && (
        <div
          className="code-explain-overlay"
          style={{ top: codeHover.top + 4, right: codeHover.right + 4 }}
          onMouseLeave={() => setCodeHover(null)}
        >
          <button
            className="code-explain-btn"
            onClick={() => {
              onExplainCode(codeHover.code, codeHover.language);
              setCodeHover(null);
            }}
          >
            Explain
          </button>
        </div>
      )}
    </div>
  );
}
