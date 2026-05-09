import { Extension } from "@tiptap/react";
import type React from "react";

export function DiagramCommandExtension(
  callbackRef: React.MutableRefObject<
    ((description: string, from: number, to: number) => void) | undefined
  >,
) {
  return Extension.create({
    name: "diagramCommand",
    addKeyboardShortcuts() {
      return {
        Enter: () => {
          const { from, to } = this.editor.state.selection;
          if (from !== to) return false;
          const textBefore = this.editor.state.doc.textBetween(0, from, "\n");
          const lines = textBefore.split("\n");
          const currentLine = lines.at(-1) ?? "";
          // Accept both `/diagram: desc` and `/diagram desc`
          const match = currentLine.match(/^\/diagram:?\s+(.+)/i);
          if (!match || !callbackRef.current) return false;
          const description = match[1]!.trim();
          if (!description) return false;
          const lineStart = from - currentLine.length;
          callbackRef.current(description, lineStart, from);
          return true;
        },
      };
    },
  });
}
