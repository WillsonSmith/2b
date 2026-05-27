import { BubbleMenu as TiptapBubbleMenu } from "@tiptap/react/menus";
import type { Editor } from "@tiptap/react";
import { Button } from "../primitives/Button.tsx";
import { Divider } from "../primitives/Divider.tsx";
import { Toolbar } from "../composites/Toolbar.tsx";

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

  const handleAskAI = () => {
    if (!onSendToChat) return;
    const { from, to } = editor.state.selection;
    const { start, end } = getLineRange(editor.state.doc, from, to);
    const filename = currentFilePath?.split("/").at(-1) ?? "document";
    const ref =
      start === end
        ? `@${filename}[line ${start}]`
        : `@${filename}[lines ${start}–${end}]`;
    onSendToChat(ref);
  };

  return (
    <TiptapBubbleMenu
      editor={editor}
      shouldShow={({ editor: ed }) => {
        const { from, to } = ed.state.selection;
        return from !== to || ed.isActive("link");
      }}
    >
      <Toolbar ariaLabel="Selection actions" className="bubble-menu">
        {onOpenLinkPicker && (
          <>
            <Button
              size="sm"
              variant="ghost"
              title={isLink ? "Edit link" : "Insert link"}
              onMouseDown={(e) => e.preventDefault()}
              onClick={onOpenLinkPicker}
              className={isLink ? "bubble-btn--active" : undefined}
            >
              Link
            </Button>
            {isLink && (
              <Button
                size="sm"
                variant="ghost"
                title="Remove link"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => editor.chain().focus().unsetLink().run()}
              >
                Unlink
              </Button>
            )}
          </>
        )}
        {onSendToChat && (
          <>
            <Divider orientation="vertical" />
            <Button
              size="sm"
              variant="ghost"
              title="Send selection to AI chat"
              onMouseDown={(e) => e.preventDefault()}
              onClick={handleAskAI}
            >
              Ask AI
            </Button>
          </>
        )}
      </Toolbar>
    </TiptapBubbleMenu>
  );
}
