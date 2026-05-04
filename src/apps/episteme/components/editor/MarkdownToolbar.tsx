import {
  Undo2, Redo2, Mic, Square, Quote, Code2, Minus, List, ListOrdered,
  ListTree, FileCode, Loader2,
} from "lucide-react";
import type { Editor } from "@tiptap/react";

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

interface MarkdownToolbarProps {
  editor: Editor | null;
  previewMode: boolean;
  onTogglePreview: () => void;
  onGenerateOutline?: () => void;
  isGeneratingOutline?: boolean;
  onMetadataRequest?: () => void;
  isGeneratingMetadata?: boolean;
  onToggleRecording?: () => void;
  isRecording?: boolean;
}

export function MarkdownToolbar({
  editor,
  previewMode,
  onTogglePreview,
  onGenerateOutline,
  isGeneratingOutline,
  onMetadataRequest,
  isGeneratingMetadata,
  onToggleRecording,
  isRecording,
}: MarkdownToolbarProps) {
  return (
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
        <List size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        active={editor?.isActive("orderedList")}
        title="Ordered list"
      >
        <ListOrdered size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        active={editor?.isActive("blockquote")}
        title="Blockquote"
      >
        <Quote size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        active={editor?.isActive("codeBlock")}
        title="Code block"
      >
        <Code2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
        active={false}
      >
        <Minus size={14} />
      </ToolbarButton>

      <div className="toolbar-sep" />

      <ToolbarButton
        onClick={() => editor?.chain().focus().undo().run()}
        title="Undo (⌘Z)"
        active={false}
      >
        <Undo2 size={14} />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => editor?.chain().focus().redo().run()}
        title="Redo (⌘⇧Z)"
        active={false}
      >
        <Redo2 size={14} />
      </ToolbarButton>

      <div className="toolbar-sep" />

      <ToolbarButton
        onClick={() => onGenerateOutline?.()}
        title="Generate Outline (AI)"
        disabled={isGeneratingOutline || !onGenerateOutline}
        active={false}
      >
        <span className="icon-inline">
          {isGeneratingOutline ? <Loader2 size={14} className="icon-spin" /> : <ListTree size={14} />}
          Outline
        </span>
      </ToolbarButton>

      <ToolbarButton
        onClick={() => onMetadataRequest?.()}
        title="Generate Frontmatter (AI)"
        disabled={isGeneratingMetadata || !onMetadataRequest}
        active={false}
      >
        <span className="icon-inline">
          {isGeneratingMetadata ? <Loader2 size={14} className="icon-spin" /> : <FileCode size={14} />}
          Frontmatter
        </span>
      </ToolbarButton>

      <ToolbarButton
        onClick={onTogglePreview}
        title="Toggle preview (renders Mermaid diagrams)"
        active={previewMode}
      >
        {previewMode ? "Edit" : "Preview"}
      </ToolbarButton>

      {onToggleRecording && (
        <>
          <div className="toolbar-sep" />
          <ToolbarButton
            onClick={onToggleRecording}
            title={isRecording ? "Stop recording" : "Record voice (requires Whisper)"}
            active={isRecording}
          >
            <span className="icon-inline">
              {isRecording ? <><Square size={14} /> Stop</> : <><Mic size={14} /> Voice</>}
            </span>
          </ToolbarButton>
        </>
      )}
    </div>
  );
}
