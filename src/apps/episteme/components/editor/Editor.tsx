import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { useEffect, useRef, useCallback, useState } from "react";
import { ChevronUp, ChevronDown, X } from "lucide-react";
import type { Tone } from "../../features/tone.ts";
import type { LintIssue } from "../../features/lint.ts";
import { resolveWikilinkTarget, wikilinkCreatePath, rankFilesForWikilink } from "../../features/wikilinks.ts";
import { GhostTextExtension } from "./extensions/ghostText.ts";
import { LintExtension, resolveIssuePositions, type ResolvedIssue } from "./extensions/lint.ts";
import { FindExtension, resolveFindMatches, type FindMatch, type FindState } from "./extensions/find.ts";
import {
  WikilinkExtension,
  WikilinkPopupExtension,
  resolveWikilinks,
  type ResolvedWikilink,
  type WikilinkPopupKeyHandlers,
} from "./extensions/wikilinks.ts";
import { EditorBubbleMenu } from "./BubbleMenu.tsx";
import { WikilinkPopup } from "./SlashCommand.tsx";
import { MarkdownToolbar } from "./MarkdownToolbar.tsx";
import { useImagePaste } from "./imagePaste.ts";

interface EditorProps {
  content: string;
  onUpdate: (markdown: string) => void;
  onAutocompleteRequest?: (context: string) => void;
  ghostText?: string;
  onGhostAccept?: (text: string) => void;
  onGhostDismiss?: () => void;
  onGenerateOutline?: () => void;
  isGeneratingOutline?: boolean;
  onToneRequest?: (text: string, tone: Tone, from: number, to: number) => void;
  onSummarizeRequest?: (text: string, insertPos: number) => void;
  toneReplacement?: { text: string; from: number; to: number } | null;
  summarizeResult?: { text: string; insertPos: number } | null;
  onToneApplied?: () => void;
  onSummarizeApplied?: () => void;
  lintIssues?: LintIssue[];
  onMetadataRequest?: () => void;
  isGeneratingMetadata?: boolean;
  onTableRequest?: (text: string, insertPos: number) => void;
  onDiagramRequest?: (description: string, from: number, to: number) => void;
  diagramResult?: { code: string; from: number; to: number } | null;
  onDiagramApplied?: () => void;
  metadataResult?: string | null;
  onMetadataApplied?: () => void;
  tableResult?: { text: string; insertPos: number } | null;
  onTableApplied?: () => void;
  onImagePaste?: (base64: string, mimeType: string, filename: string) => void;
  onExplainCode?: (code: string, language: string) => void;
  isRecording?: boolean;
  onToggleRecording?: () => void;
  onAskAboutSelection?: (text: string) => void;
  onNavigate?: (path: string) => void;
  onCreateFile?: (path: string) => void;
  workspaceFiles?: string[];
  onCountsChange?: (words: number, chars: number) => void;
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

function MermaidBlock({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        mermaid.initialize({ startOnLoad: false, theme: "dark" });
        const id = `mermaid-${Math.random().toString(36).slice(2)}`;
        const { svg } = await mermaid.render(id, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
        }
      } catch {
        if (!cancelled && ref.current) {
          ref.current.textContent = code;
        }
      }
    })();
    return () => { cancelled = true; };
  }, [code]);

  return <div className="mermaid-block" ref={ref} />;
}

export function Editor({
  content,
  onUpdate,
  onAutocompleteRequest,
  ghostText = "",
  onGhostAccept,
  onGhostDismiss,
  onGenerateOutline,
  isGeneratingOutline,
  onToneRequest,
  onSummarizeRequest,
  toneReplacement,
  summarizeResult,
  onToneApplied,
  onSummarizeApplied,
  lintIssues = [],
  onMetadataRequest,
  isGeneratingMetadata,
  onTableRequest,
  onDiagramRequest,
  diagramResult,
  onDiagramApplied,
  metadataResult,
  onMetadataApplied,
  tableResult,
  onTableApplied,
  onImagePaste,
  onExplainCode,
  isRecording,
  onToggleRecording,
  onAskAboutSelection,
  onNavigate,
  onCreateFile,
  workspaceFiles = [],
  onCountsChange,
}: EditorProps) {
  const ghostRef = useRef(ghostText);
  const lintRef = useRef<ResolvedIssue[]>([]);
  const wikilinkRef = useRef<ResolvedWikilink[]>([]);
  const filesRef = useRef<string[]>(workspaceFiles);
  filesRef.current = workspaceFiles;
  const popupKeysRef = useRef<WikilinkPopupKeyHandlers>({
    open: false,
    onArrowUp: () => {},
    onArrowDown: () => {},
    onEnter: () => false,
    onEscape: () => false,
  });
  const findStateRef = useRef<FindState>({ matches: [], activeIndex: 0 });
  const [previewMode, setPreviewMode] = useState(false);

  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [findMatches, setFindMatches] = useState<FindMatch[]>([]);
  const [findIndex, setFindIndex] = useState(0);
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const findInputRef = useRef<HTMLInputElement | null>(null);

  const [wikiPopup, setWikiPopup] = useState<{
    query: string;
    from: number;
    top: number;
    left: number;
  } | null>(null);
  const [wikiSelectedIndex, setWikiSelectedIndex] = useState(0);

  const wikiMatches = wikiPopup
    ? rankFilesForWikilink(workspaceFiles, wikiPopup.query)
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

  const handleAccept = useCallback((t: string) => acceptRef.current?.(t), []);
  const handleDismiss = useCallback(() => dismissRef.current?.(), []);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: { openOnClick: false } }),
      Markdown.configure({ transformPastedText: true }),
      Placeholder.configure({ placeholder: "Start writing… (type /diagram: <description> to insert a diagram)" }),
      CharacterCount,
      GhostTextExtension(ghostRef, handleAccept, handleDismiss),
      LintExtension(lintRef),
      WikilinkExtension(wikilinkRef),
      WikilinkPopupExtension(popupKeysRef),
      FindExtension(findStateRef),
    ],
    content,
    onUpdate({ editor }) {
      onUpdate(editor.storage.markdown.getMarkdown());
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
    const current = editor.storage.markdown.getMarkdown();
    if (current !== content) {
      editor.commands.setContent(content);
    }
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
    const { from, to, code } = diagramResult;
    const replacement = "```mermaid\n" + code + "\n```";
    editor.chain().focus().insertContentAt({ from, to }, replacement).run();
    onDiagramApplied?.();
  }, [diagramResult]);

  useEffect(() => {
    if (!editor || !metadataResult) return;
    const md = editor.storage.markdown.getMarkdown();
    const hasFrontmatter = md.startsWith("---\n");
    if (hasFrontmatter) {
      const endOfFm = md.indexOf("\n---\n", 4);
      if (endOfFm !== -1) {
        const newMd = `---\n${metadataResult}\n---\n` + md.slice(endOfFm + 5);
        editor.commands.setContent(newMd);
        onUpdate(newMd);
        onMetadataApplied?.();
        return;
      }
    }
    const newMd = `---\n${metadataResult}\n---\n\n${md.trimStart()}`;
    editor.commands.setContent(newMd);
    onUpdate(newMd);
    onMetadataApplied?.();
  }, [metadataResult]);

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

  useEffect(() => {
    if (!editor) return;
    const refresh = () => {
      wikilinkRef.current = resolveWikilinks(editor.state.doc, filesRef.current);
      editor.view.dispatch(editor.state.tr.setMeta("wikilink-refresh", true));
    };
    refresh();
    editor.on("update", refresh);
    return () => { editor.off("update", refresh); };
  }, [editor, workspaceFiles]);

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

  const autocompleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAutocomplete = useCallback(() => {
    if (!onAutocompleteRequest || !editor) return;
    if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    autocompleteTimer.current = setTimeout(() => {
      const { from, to } = editor.state.selection;
      if (from !== to) return;
      const md = editor.storage.markdown.getMarkdown();
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

  const handleWikiPopupUpdate = useCallback(() => {
    if (!editor) return;
    const { from, to } = editor.state.selection;
    if (from !== to) { setWikiPopup(null); return; }

    const $pos = editor.state.doc.resolve(from);
    for (let d = $pos.depth; d >= 0; d--) {
      if ($pos.node(d).type.name === "codeBlock") { setWikiPopup(null); return; }
    }
    if ($pos.marks().some((m) => m.type.name === "code")) { setWikiPopup(null); return; }

    const before = editor.state.doc.textBetween(Math.max(0, from - 500), from, "\n");
    const m = before.match(/\[\[([^\]\n]*)$/);
    if (!m) { setWikiPopup(null); return; }

    const query = m[1] ?? "";
    const startPos = from - m[0].length;
    const coords = editor.view.coordsAtPos(from);
    setWikiPopup((prev) =>
      prev && prev.query === query && prev.from === startPos
        ? prev
        : { query, from: startPos, top: coords.bottom + 4, left: coords.left },
    );
    onGhostDismiss?.();
  }, [editor, onGhostDismiss]);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", handleAutocomplete);
    editor.on("update", handleWikiPopupUpdate);
    editor.on("selectionUpdate", handleSelectionUpdate);
    editor.on("selectionUpdate", handleWikiPopupUpdate);
    return () => {
      editor.off("update", handleAutocomplete);
      editor.off("update", handleWikiPopupUpdate);
      editor.off("selectionUpdate", handleSelectionUpdate);
      editor.off("selectionUpdate", handleWikiPopupUpdate);
      if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    };
  }, [editor, handleAutocomplete, handleSelectionUpdate, handleWikiPopupUpdate]);

  useEffect(() => {
    setWikiSelectedIndex(0);
  }, [wikiPopup?.query]);

  const acceptWikiSuggestion = useCallback((basename: string) => {
    if (!editor || !wikiPopup) return;
    const replacement = `[[${basename}]]`;
    const cursor = editor.state.selection.from;
    editor
      .chain()
      .focus()
      .insertContentAt({ from: wikiPopup.from, to: cursor }, replacement)
      .run();
    setWikiPopup(null);
  }, [editor, wikiPopup]);

  useEffect(() => {
    popupKeysRef.current = {
      open: wikiPopup !== null && wikiMatches.length > 0,
      onArrowDown: () =>
        setWikiSelectedIndex((i) => (wikiMatches.length === 0 ? 0 : (i + 1) % wikiMatches.length)),
      onArrowUp: () =>
        setWikiSelectedIndex((i) =>
          wikiMatches.length === 0 ? 0 : (i - 1 + wikiMatches.length) % wikiMatches.length,
        ),
      onEnter: () => {
        const item = wikiMatches[wikiSelectedIndex];
        if (!item) return false;
        acceptWikiSuggestion(item.basename);
        return true;
      },
      onEscape: () => {
        setWikiPopup(null);
        return true;
      },
    };
  }, [wikiPopup, wikiMatches, wikiSelectedIndex, acceptWikiSuggestion]);

  const handleDiagramCommand = useCallback(() => {
    if (!editor || !onDiagramRequest) return false;
    const { from } = editor.state.selection;

    const textBefore = editor.state.doc.textBetween(0, from, "\n");
    const lines = textBefore.split("\n");
    const currentLine = lines.at(-1) ?? "";
    const diagramMatch = currentLine.match(/^\/diagram:\s*(.+)/i);
    if (!diagramMatch) return false;

    const description = diagramMatch[1]?.trim() ?? "";
    if (!description) return false;

    const lineStart = from - currentLine.length;
    onDiagramRequest(description, lineStart, from);
    return true;
  }, [editor, onDiagramRequest]);

  useEffect(() => {
    if (!editor) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Enter" && !e.shiftKey) {
        if (handleDiagramCommand()) e.preventDefault();
      }
    };
    editor.view.dom.addEventListener("keydown", handleKeyDown);
    return () => editor.view.dom.removeEventListener("keydown", handleKeyDown);
  }, [editor, handleDiagramCommand]);

  useImagePaste(editor, onImagePaste);

  const onNavigateRef = useRef(onNavigate);
  onNavigateRef.current = onNavigate;
  const onCreateFileRef = useRef(onCreateFile);
  onCreateFileRef.current = onCreateFile;

  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const handleClick = (e: MouseEvent) => {
      const wl = (e.target as HTMLElement).closest(".wikilink, .wikilink-broken");
      if (wl) {
        const target = wl.getAttribute("data-target") ?? "";
        if (!target) return;
        e.preventDefault();
        const resolved = resolveWikilinkTarget(target, filesRef.current);
        if (resolved) {
          onNavigateRef.current?.(resolved);
        } else {
          onCreateFileRef.current?.(wikilinkCreatePath(target));
        }
        return;
      }
      if (!onNavigateRef.current) return;
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href") ?? "";
      if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) return;
      e.preventDefault();
      onNavigateRef.current(href);
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

  const renderPreview = () => {
    if (!editor) return null;
    const md = editor.storage.markdown.getMarkdown();
    const parts = md.split(/(```mermaid\n[\s\S]*?\n```)/g);

    return (
      <div className="editor-preview">
        {parts.map((part: string, i: number) => {
          const mermaidMatch = part.match(/^```mermaid\n([\s\S]*?)\n```$/);
          if (mermaidMatch) {
            return <MermaidBlock key={i} code={mermaidMatch[1] ?? ""} />;
          }
          return (
            <pre key={i} className="editor-preview-text">
              {part}
            </pre>
          );
        })}
      </div>
    );
  };

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
      <MarkdownToolbar
        editor={editor}
        previewMode={previewMode}
        onTogglePreview={() => setPreviewMode((p) => !p)}
        onGenerateOutline={onGenerateOutline}
        isGeneratingOutline={isGeneratingOutline}
        onMetadataRequest={onMetadataRequest}
        isGeneratingMetadata={isGeneratingMetadata}
        onToggleRecording={onToggleRecording}
        isRecording={isRecording}
      />

      <div className="editor-scroll">
        {editor && (
          <EditorBubbleMenu
            editor={editor}
            onToneRequest={onToneRequest}
            onSummarizeRequest={onSummarizeRequest}
            onTableRequest={onTableRequest}
            onAskAboutSelection={onAskAboutSelection}
          />
        )}

        {previewMode ? renderPreview() : <EditorContent editor={editor} />}
      </div>

      {wikiPopup && wikiMatches.length > 0 && (
        <WikilinkPopup
          top={wikiPopup.top}
          left={wikiPopup.left}
          matches={wikiMatches}
          selectedIndex={wikiSelectedIndex}
          onHover={setWikiSelectedIndex}
          onAccept={acceptWikiSuggestion}
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
