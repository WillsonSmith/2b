import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";

function getLineRange(
  doc: Editor["state"]["doc"],
  from: number,
  to: number,
): { start: number; end: number } {
  const textBefore = doc.textBetween(0, from, "\n");
  const startLine = textBefore.split("\n").length;
  const textRange = doc.textBetween(from, to, "\n");
  const lineCount = textRange.split("\n").length;
  return { start: startLine, end: startLine + lineCount - 1 };
}

interface BubbleMenuProps {
  editor: Editor;
  onOpenLinkPicker?: () => void;
  onSendToChat?: (selectionRef: string) => void;
  currentFilePath?: string;
}

export function EditorBubbleMenu({
  editor,
  onOpenLinkPicker,
  onSendToChat,
  currentFilePath,
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
          </>
        )}
        {onSendToChat && (
          <>
            <div className="bubble-sep" />
            <button
              className="bubble-btn"
              title="Send selection to AI chat"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                const { from, to } = editor.state.selection;
                const { start, end } = getLineRange(editor.state.doc, from, to);
                const filename = currentFilePath?.split("/").at(-1) ?? "document";
                const ref =
                  start === end
                    ? `@${filename}[line ${start}]`
                    : `@${filename}[lines ${start}–${end}]`;
                onSendToChat(ref);
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
