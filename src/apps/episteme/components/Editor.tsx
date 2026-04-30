import { useEditor, EditorContent, Extension } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { useEffect, useRef, useCallback, useState } from "react";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";
import type { Tone } from "../features/tone.ts";
import type { LintIssue } from "../features/lint.ts";

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
}

// ── Ghost-text TipTap extension ───────────────────────────────────────────────

const ghostKey = new PluginKey<DecorationSet>("ghost-text");

function buildGhostPlugin(getGhost: () => string) {
  return new ProseMirrorPlugin({
    key: ghostKey,
    state: {
      init() {
        return DecorationSet.empty;
      },
      apply(tr, _old) {
        const ghost = getGhost();
        if (!ghost) return DecorationSet.empty;
        const sel = tr.selection;
        const pos = sel.from;
        const deco = Decoration.widget(pos, () => {
          const span = document.createElement("span");
          span.className = "ghost-text";
          span.textContent = ghost;
          return span;
        });
        return DecorationSet.create(tr.doc, [deco]);
      },
    },
    props: {
      decorations(state) {
        return ghostKey.getState(state) ?? DecorationSet.empty;
      },
    },
  });
}

function GhostTextExtension(
  ghostRef: React.MutableRefObject<string>,
  onAccept: (t: string) => void,
  onDismiss: () => void,
) {
  return Extension.create({
    name: "ghostText",
    addProseMirrorPlugins() {
      return [buildGhostPlugin(() => ghostRef.current)];
    },
    addKeyboardShortcuts() {
      return {
        Tab: () => {
          const ghost = ghostRef.current;
          if (!ghost) return false;
          this.editor.commands.insertContent(ghost);
          onAccept(ghost);
          return true;
        },
        Escape: () => {
          if (!ghostRef.current) return false;
          onDismiss();
          return true;
        },
      };
    },
  });
}

// ── Lint decoration plugin ────────────────────────────────────────────────────

interface ResolvedIssue extends LintIssue {
  pmFrom: number;
  pmTo: number;
}

const lintKey = new PluginKey<DecorationSet>("lint-decos");

function buildLintPlugin(getIssues: () => ResolvedIssue[]) {
  return new ProseMirrorPlugin({
    key: lintKey,
    state: {
      init: () => DecorationSet.empty,
      apply(tr, old) {
        if (tr.getMeta("lint-refresh")) {
          const issues = getIssues();
          if (!issues.length) return DecorationSet.empty;
          const decos = issues.map((issue) =>
            Decoration.inline(issue.pmFrom, issue.pmTo, {
              class: `lint-${issue.type}`,
              title: `[${issue.type}] ${issue.suggestion}`,
            }),
          );
          return DecorationSet.create(tr.doc, decos);
        }
        if (tr.docChanged) return old.map(tr.mapping, tr.doc);
        return old;
      },
    },
    props: {
      decorations: (state) => lintKey.getState(state) ?? DecorationSet.empty,
    },
  });
}

function LintExtension(lintRef: React.MutableRefObject<ResolvedIssue[]>) {
  return Extension.create({
    name: "lint",
    addProseMirrorPlugins() {
      return [buildLintPlugin(() => lintRef.current)];
    },
  });
}

function resolveIssuePositions(doc: ProseMirrorNode, issues: LintIssue[]): ResolvedIssue[] {
  const chars: string[] = [];
  const positions: number[] = [];

  doc.descendants((node, pos) => {
    if (node.isText && node.text) {
      for (let i = 0; i < node.text.length; i++) {
        chars.push(node.text[i] ?? "");
        positions.push(pos + i);
      }
    }
  });

  const fullText = chars.join("");
  const resolved: ResolvedIssue[] = [];

  for (const issue of issues) {
    const idx = fullText.indexOf(issue.text);
    if (idx === -1 || idx + issue.text.length > positions.length) continue;
    const pmFrom = positions[idx] ?? 0;
    const pmTo = (positions[idx + issue.text.length - 1] ?? 0) + 1;
    resolved.push({ ...issue, pmFrom, pmTo });
  }

  return resolved;
}

// ── Toolbar button ────────────────────────────────────────────────────────────

function ToolbarButton({
  onClick,
  active,
  title,
  disabled,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  title: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      className={`toolbar-btn${active ? " active" : ""}`}
      onClick={onClick}
      title={title}
      type="button"
      disabled={disabled}
    >
      {children}
    </button>
  );
}

// ── Mermaid renderer (client-side only) ───────────────────────────────────────

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

// ── Editor component ──────────────────────────────────────────────────────────

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
}: EditorProps) {
  const ghostRef = useRef(ghostText);
  const lintRef = useRef<ResolvedIssue[]>([]);
  const [previewMode, setPreviewMode] = useState(false);

  // Stable callbacks for the extension — avoids recreating editor on every render
  const acceptRef = useRef(onGhostAccept);
  const dismissRef = useRef(onGhostDismiss);
  acceptRef.current = onGhostAccept;
  dismissRef.current = onGhostDismiss;

  const handleAccept = useCallback((t: string) => acceptRef.current?.(t), []);
  const handleDismiss = useCallback(() => dismissRef.current?.(), []);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Markdown.configure({ transformPastedText: true }),
      Placeholder.configure({ placeholder: "Start writing… (type /diagram: <description> to insert a diagram)" }),
      CharacterCount,
      GhostTextExtension(ghostRef, handleAccept, handleDismiss),
      LintExtension(lintRef),
    ],
    content,
    onUpdate({ editor }) {
      onUpdate(editor.storage.markdown.getMarkdown());
    },
    editorProps: {
      attributes: { class: "tiptap" },
    },
  });

  // Sync ghost text to ref and force a decoration redraw
  useEffect(() => {
    ghostRef.current = ghostText;
    if (editor) {
      const { tr } = editor.state;
      editor.view.dispatch(tr.setMeta("ghost-refresh", true));
    }
  }, [ghostText, editor]);

  // Sync external content changes (file open) without losing cursor if content unchanged
  useEffect(() => {
    if (!editor) return;
    const current = editor.storage.markdown.getMarkdown();
    if (current !== content) {
      editor.commands.setContent(content);
    }
  }, [content]);

  // Apply tone replacement when result arrives
  useEffect(() => {
    if (!editor || !toneReplacement) return;
    const { from, to, text } = toneReplacement;
    editor.chain().focus().insertContentAt({ from, to }, text).run();
    onToneApplied?.();
  }, [toneReplacement]);

  // Insert TL;DR blockquote when summarize result arrives
  useEffect(() => {
    if (!editor || !summarizeResult) return;
    const { insertPos, text } = summarizeResult;
    editor.chain().focus().insertContentAt(insertPos, {
      type: "blockquote",
      content: [{ type: "paragraph", content: [{ type: "text", text: `[TL;DR]: ${text}` }] }],
    }).run();
    onSummarizeApplied?.();
  }, [summarizeResult]);

  // Apply diagram result — replace /diagram: line with mermaid code block
  useEffect(() => {
    if (!editor || !diagramResult) return;
    const { from, to, code } = diagramResult;
    const replacement = "```mermaid\n" + code + "\n```";
    editor.chain().focus().insertContentAt({ from, to }, replacement).run();
    onDiagramApplied?.();
  }, [diagramResult]);

  // Apply metadata result — insert/replace frontmatter at document start
  useEffect(() => {
    if (!editor || !metadataResult) return;
    const md = editor.storage.markdown.getMarkdown();
    const hasFrontmatter = md.startsWith("---\n");
    if (hasFrontmatter) {
      const endOfFm = md.indexOf("\n---\n", 4);
      if (endOfFm !== -1) {
        // Replace from position 0 to end of ---\n block
        const newMd = `---\n${metadataResult}\n---\n` + md.slice(endOfFm + 5);
        editor.commands.setContent(newMd);
        onUpdate(newMd);
        onMetadataApplied?.();
        return;
      }
    }
    // Prepend new frontmatter
    const newMd = `---\n${metadataResult}\n---\n\n${md.trimStart()}`;
    editor.commands.setContent(newMd);
    onUpdate(newMd);
    onMetadataApplied?.();
  }, [metadataResult]);

  // Apply table result — insert at cursor position
  useEffect(() => {
    if (!editor || !tableResult) return;
    const { insertPos, text } = tableResult;
    editor.chain().focus().insertContentAt(insertPos, "\n\n" + text + "\n\n").run();
    onTableApplied?.();
  }, [tableResult]);

  // Resolve lint issue positions and redraw decorations when issues change
  useEffect(() => {
    if (!editor) return;
    lintRef.current = resolveIssuePositions(editor.state.doc, lintIssues);
    const { tr } = editor.state;
    editor.view.dispatch(tr.setMeta("lint-refresh", true));
  }, [lintIssues, editor]);

  // Autocomplete: fire after 800ms idle after typing
  const autocompleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleAutocomplete = useCallback(() => {
    if (!onAutocompleteRequest || !editor) return;
    if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    autocompleteTimer.current = setTimeout(() => {
      const md = editor.storage.markdown.getMarkdown();
      if (md.trim().length > 10) onAutocompleteRequest(md);
    }, 800);
  }, [onAutocompleteRequest, editor]);

  useEffect(() => {
    if (!editor) return;
    editor.on("update", handleAutocomplete);
    return () => {
      editor.off("update", handleAutocomplete);
      if (autocompleteTimer.current) clearTimeout(autocompleteTimer.current);
    };
  }, [editor, handleAutocomplete]);

  // /diagram: slash command — detect on Enter key
  const handleDiagramCommand = useCallback(() => {
    if (!editor || !onDiagramRequest) return false;
    const { from } = editor.state.selection;

    // Find the line at cursor
    const textBefore = editor.state.doc.textBetween(0, from, "\n");
    const lines = textBefore.split("\n");
    const currentLine = lines.at(-1) ?? "";
    const diagramMatch = currentLine.match(/^\/diagram:\s*(.+)/i);
    if (!diagramMatch) return false;

    const description = diagramMatch[1]?.trim() ?? "";
    if (!description) return false;

    // Find the start of this line in the document
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

  const wordCount = editor?.storage.characterCount?.words() ?? 0;
  const charCount = editor?.storage.characterCount?.characters() ?? 0;

  // Render preview with Mermaid blocks rendered as SVG
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
      <div className="editor-toolbar">
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBold().run()}
          active={editor?.isActive("bold")}
          title="Bold (⌘B)"
        >
          <strong>B</strong>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleItalic().run()}
          active={editor?.isActive("italic")}
          title="Italic (⌘I)"
        >
          <em>I</em>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleStrike().run()}
          active={editor?.isActive("strike")}
          title="Strikethrough"
        >
          <s>S</s>
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleCode().run()}
          active={editor?.isActive("code")}
          title="Inline code"
        >
          {"</>"}
        </ToolbarButton>

        <div className="toolbar-sep" />

        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
          active={editor?.isActive("heading", { level: 1 })}
          title="Heading 1"
        >
          H1
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
          active={editor?.isActive("heading", { level: 2 })}
          title="Heading 2"
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
          active={editor?.isActive("heading", { level: 3 })}
          title="Heading 3"
        >
          H3
        </ToolbarButton>

        <div className="toolbar-sep" />

        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
          active={editor?.isActive("bulletList")}
          title="Bullet list"
        >
          •≡
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
          active={editor?.isActive("orderedList")}
          title="Ordered list"
        >
          1≡
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
          active={editor?.isActive("blockquote")}
          title="Blockquote"
        >
          ❝
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
          active={editor?.isActive("codeBlock")}
          title="Code block"
        >
          ⊞
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().setHorizontalRule().run()}
          title="Horizontal rule"
          active={false}
        >
          —
        </ToolbarButton>

        <div className="toolbar-sep" />

        <ToolbarButton
          onClick={() => editor?.chain().focus().undo().run()}
          title="Undo (⌘Z)"
          active={false}
        >
          ↩
        </ToolbarButton>
        <ToolbarButton
          onClick={() => editor?.chain().focus().redo().run()}
          title="Redo (⌘⇧Z)"
          active={false}
        >
          ↪
        </ToolbarButton>

        <div className="toolbar-sep" />

        <ToolbarButton
          onClick={() => onGenerateOutline?.()}
          title="Generate Outline (AI)"
          disabled={isGeneratingOutline || !onGenerateOutline}
          active={false}
        >
          {isGeneratingOutline ? "…" : "⊟ Outline"}
        </ToolbarButton>

        <ToolbarButton
          onClick={() => onMetadataRequest?.()}
          title="Generate Frontmatter (AI)"
          disabled={isGeneratingMetadata || !onMetadataRequest}
          active={false}
        >
          {isGeneratingMetadata ? "…" : "⊞ Frontmatter"}
        </ToolbarButton>

        <ToolbarButton
          onClick={() => setPreviewMode((p) => !p)}
          title="Toggle preview (renders Mermaid diagrams)"
          active={previewMode}
        >
          {previewMode ? "Edit" : "Preview"}
        </ToolbarButton>

        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>
          {wordCount.toLocaleString()} words · {charCount.toLocaleString()} chars
        </span>
      </div>

      <div className="editor-scroll">
        {editor && (
          <BubbleMenu
            editor={editor}
            shouldShow={({ editor: ed }) => {
              const { from, to } = ed.state.selection;
              return from !== to;
            }}
          >
            <div className="bubble-menu">
              {(["professional", "casual", "academic"] as Tone[]).map((tone) => (
                <button
                  key={tone}
                  className="bubble-btn"
                  title={`Rewrite as ${tone}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    const { from, to } = editor.state.selection;
                    const text = editor.state.doc.textBetween(from, to, " ");
                    if (text) onToneRequest?.(text, tone, from, to);
                  }}
                >
                  {tone.slice(0, 1).toUpperCase() + tone.slice(1)}
                </button>
              ))}
              <div className="bubble-sep" />
              <button
                className="bubble-btn"
                title="Summarize selection"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const { from, to } = editor.state.selection;
                  const text = editor.state.doc.textBetween(from, to, "\n");
                  if (text) onSummarizeRequest?.(text, to);
                }}
              >
                TL;DR
              </button>
              <div className="bubble-sep" />
              <button
                className="bubble-btn"
                title="Convert to table"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  const { from, to } = editor.state.selection;
                  const text = editor.state.doc.textBetween(from, to, "\n");
                  if (text) onTableRequest?.(text, to);
                }}
              >
                Table
              </button>
            </div>
          </BubbleMenu>
        )}

        {previewMode ? renderPreview() : <EditorContent editor={editor} />}
      </div>
    </div>
  );
}
