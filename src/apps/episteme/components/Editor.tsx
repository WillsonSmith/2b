import { useEditor, EditorContent, Extension } from "@tiptap/react";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { Plugin as ProseMirrorPlugin, PluginKey } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import Placeholder from "@tiptap/extension-placeholder";
import CharacterCount from "@tiptap/extension-character-count";
import { useEffect, useRef, useCallback } from "react";

interface EditorProps {
  content: string;
  onUpdate: (markdown: string) => void;
  /** Called when the editor wants an autocomplete suggestion for the current context. */
  onAutocompleteRequest?: (context: string) => void;
  /** Ghost-text suggestion to display. Clear by setting to "". */
  ghostText?: string;
  /** Called when the user accepts (Tab) or dismisses (Escape) the ghost suggestion. */
  onGhostAccept?: (text: string) => void;
  onGhostDismiss?: () => void;
  /** Called when the Generate Outline button is clicked. */
  onGenerateOutline?: () => void;
  /** True while outline generation is in flight. */
  isGeneratingOutline?: boolean;
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
}: EditorProps) {
  const ghostRef = useRef(ghostText);

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
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
