import { useEditor, EditorContent, Extension } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { useEffect, useRef, useCallback } from "react";
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
}: EditorProps) {
  const ghostRef = useRef(ghostText);
  const lintRef = useRef<ResolvedIssue[]>([]);

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
      Placeholder.configure({ placeholder: "Start writing…" }),
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
      // Trigger a no-op transaction so ProseMirror re-evaluates decorations
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

  const wordCount = editor?.storage.characterCount?.words() ?? 0;
  const charCount = editor?.storage.characterCount?.characters() ?? 0;

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
            </div>
          </BubbleMenu>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
