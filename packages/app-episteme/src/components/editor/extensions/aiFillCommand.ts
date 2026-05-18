import { Extension } from "@tiptap/react";

export const AIFillCommandExtension = Extension.create({
  name: "aiFillCommand",
  addKeyboardShortcuts() {
    return {
      Enter: () => {
        const { from, to } = this.editor.state.selection;
        if (from !== to) return false;
        const textBefore = this.editor.state.doc.textBetween(0, from, "\n");
        const lines = textBefore.split("\n");
        const currentLine = lines.at(-1) ?? "";
        const match = currentLine.match(/^\/fill\b\s*(.*)$/i);
        if (!match) return false;
        const seed = match[1]!.trim();
        const lineStart = from - currentLine.length;
        const id = crypto.randomUUID();
        const cursorTarget = lineStart + 1 + seed.length;
        this.editor.chain()
          .deleteRange({ from: lineStart, to: from })
          .insertContentAt(lineStart, {
            type: "aiFillBlock",
            attrs: { id, generating: false },
            content: seed ? [{ type: "text", text: seed }] : [],
          })
          .setTextSelection(cursorTarget)
          .focus()
          .run();
        return true;
      },
    };
  },
});
