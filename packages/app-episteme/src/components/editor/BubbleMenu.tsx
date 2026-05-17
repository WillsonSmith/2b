import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import type { Tone } from "../../features/tone.ts";

interface BubbleMenuProps {
  editor: Editor;
  onToneRequest?: (text: string, tone: Tone, from: number, to: number) => void;
  onSummarizeRequest?: (text: string, insertPos: number) => void;
  onTableRequest?: (text: string, insertPos: number) => void;
  onAskAboutSelection?: (text: string) => void;
  onOpenLinkPicker?: () => void;
}

export function EditorBubbleMenu({
  editor,
  onToneRequest,
  onSummarizeRequest,
  onTableRequest,
  onAskAboutSelection,
  onOpenLinkPicker,
}: BubbleMenuProps) {
  const isLink = editor.isActive("link");

  return (
    <TiptapBubbleMenu
      editor={editor}
      shouldShow={({ editor: ed }) => {
        const { from, to } = ed.state.selection;
        return from !== to || ed.isActive("link");
      }}
    >
      <div className="bubble-menu">
        {onOpenLinkPicker && (
          <>
            <button
              className={`bubble-btn${isLink ? " active" : ""}`}
              title={isLink ? "Edit link" : "Insert link"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onOpenLinkPicker}
            >
              Link
            </button>
            {isLink && (
              <button
                className="bubble-btn"
                title="Remove link"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().unsetLink().run()}
              >
                Unlink
              </button>
            )}
            <div className="bubble-sep" />
          </>
        )}
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
        {onAskAboutSelection && (
          <>
            <div className="bubble-sep" />
            <button
              className="bubble-btn"
              title="Ask AI about this selection"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const { from, to } = editor.state.selection;
                const text = editor.state.doc.textBetween(from, to, "\n");
                if (text) onAskAboutSelection(text);
              }}
            >
              Ask AI
            </button>
          </>
        )}
      </div>
    </TiptapBubbleMenu>
  );
}
