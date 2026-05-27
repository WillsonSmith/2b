import {
  Undo2, Redo2, Mic, Square, Quote, Code2, Minus, List, ListOrdered,
  FileCode, Table, CheckSquare, Network, Link, Sparkles,
} from "lucide-react";
import type { Editor } from "@tiptap/react";
import type { ReactNode } from "react";
import { Button } from "../primitives/Button.tsx";
import { Divider } from "../primitives/Divider.tsx";
import { Icon } from "../primitives/Icon.tsx";
import { Spinner } from "../primitives/Spinner.tsx";
import { Toolbar } from "../composites/Toolbar.tsx";

interface ToolbarBtnProps {
  onClick: () => void;
  active?: boolean;
  title: string;
  disabled?: boolean;
  children: ReactNode;
}

function ToolbarBtn({ onClick, active, title, disabled, children }: ToolbarBtnProps) {
  return (
    <Button
      size="sm"
      variant="ghost"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={active ? "toolbar-btn--active" : undefined}
    >
      {children}
    </Button>
  );
}

interface MarkdownToolbarProps {
  editor: Editor | null;
  onMetadataRequest?: () => void;
  isGeneratingMetadata?: boolean;
  onToggleRecording?: () => void;
  isRecording?: boolean;
  onOpenDiagramBar?: () => void;
  onOpenLinkPicker?: () => void;
  onProcessAllFills?: () => void;
}

export function MarkdownToolbar({
  editor,
  onMetadataRequest,
  isGeneratingMetadata,
  onToggleRecording,
  isRecording,
  onOpenDiagramBar,
  onOpenLinkPicker,
  onProcessAllFills,
}: MarkdownToolbarProps) {
  return (
    <Toolbar ariaLabel="Editor formatting" className="editor-toolbar">
      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleBold().run()}
        active={editor?.isActive("bold")}
        title="Bold (⌘B)"
      >
        <strong>B</strong>
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleItalic().run()}
        active={editor?.isActive("italic")}
        title="Italic (⌘I)"
      >
        <em>I</em>
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleStrike().run()}
        active={editor?.isActive("strike")}
        title="Strikethrough"
      >
        <s>S</s>
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleCode().run()}
        active={editor?.isActive("code")}
        title="Inline code"
      >
        {"</>"}
      </ToolbarBtn>

      <Divider orientation="vertical" />

      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleHeading({ level: 1 }).run()}
        active={editor?.isActive("heading", { level: 1 })}
        title="Heading 1"
      >
        H1
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleHeading({ level: 2 }).run()}
        active={editor?.isActive("heading", { level: 2 })}
        title="Heading 2"
      >
        H2
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleHeading({ level: 3 }).run()}
        active={editor?.isActive("heading", { level: 3 })}
        title="Heading 3"
      >
        H3
      </ToolbarBtn>

      <Divider orientation="vertical" />

      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleBulletList().run()}
        active={editor?.isActive("bulletList")}
        title="Bullet list"
      >
        <Icon icon={List} size="sm" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        active={editor?.isActive("orderedList")}
        title="Ordered list"
      >
        <Icon icon={ListOrdered} size="sm" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        active={editor?.isActive("blockquote")}
        title="Blockquote"
      >
        <Icon icon={Quote} size="sm" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        active={editor?.isActive("codeBlock")}
        title="Code block"
      >
        <Icon icon={Code2} size="sm" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().setHorizontalRule().run()}
        title="Horizontal rule"
      >
        <Icon icon={Minus} size="sm" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() =>
          editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
        }
        title="Insert table"
      >
        <Icon icon={Table} size="sm" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().toggleTaskList().run()}
        active={editor?.isActive("taskList")}
        title="Task list"
      >
        <Icon icon={CheckSquare} size="sm" />
      </ToolbarBtn>

      <Divider orientation="vertical" />

      <ToolbarBtn
        onClick={() => editor?.chain().focus().undo().run()}
        title="Undo (⌘Z)"
      >
        <Icon icon={Undo2} size="sm" />
      </ToolbarBtn>
      <ToolbarBtn
        onClick={() => editor?.chain().focus().redo().run()}
        title="Redo (⌘⇧Z)"
      >
        <Icon icon={Redo2} size="sm" />
      </ToolbarBtn>

      {onOpenLinkPicker && (
        <>
          <Divider orientation="vertical" />
          <Button
            size="sm"
            variant="ghost"
            onClick={onOpenLinkPicker}
            title="Insert link (⌘K)"
            iconLeft={<Icon icon={Link} size="sm" />}
          >
            Link
          </Button>
        </>
      )}

      <Divider orientation="vertical" />

      <Button
        size="sm"
        variant="ghost"
        onClick={() => onMetadataRequest?.()}
        title="Generate Frontmatter (AI)"
        disabled={isGeneratingMetadata || !onMetadataRequest}
        iconLeft={isGeneratingMetadata ? <Spinner size="sm" /> : <Icon icon={FileCode} size="sm" />}
      >
        Frontmatter
      </Button>
      {onOpenDiagramBar && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onOpenDiagramBar}
          title="Insert diagram (AI)"
          iconLeft={<Icon icon={Network} size="sm" />}
        >
          Diagram
        </Button>
      )}
      {onProcessAllFills && (
        <Button
          size="sm"
          variant="ghost"
          onClick={onProcessAllFills}
          title="Generate content for all AI Fill blocks in this document"
          iconLeft={<Icon icon={Sparkles} size="sm" />}
        >
          Process Fills
        </Button>
      )}

      {onToggleRecording && (
        <>
          <Divider orientation="vertical" />
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggleRecording}
            title={isRecording ? "Stop recording" : "Record voice (requires Whisper)"}
            className={isRecording ? "toolbar-btn--active" : undefined}
            iconLeft={isRecording ? <Icon icon={Square} size="sm" /> : <Icon icon={Mic} size="sm" />}
          >
            {isRecording ? "Stop" : "Voice"}
          </Button>
        </>
      )}
    </Toolbar>
  );
}
