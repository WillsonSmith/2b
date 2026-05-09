import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer } from "@tiptap/react";
import { Loader2 } from "lucide-react";

function DiagramPlaceholderView() {
  return (
    <NodeViewWrapper className="diagram-generating" contentEditable={false}>
      <Loader2 size={14} className="icon-spin" />
      <span>Generating diagram…</span>
    </NodeViewWrapper>
  );
}

export const DiagramPlaceholderExtension = Node.create({
  name: "diagramPlaceholder",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      id: { default: null },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-type="diagram-placeholder"]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ["div", { "data-type": "diagram-placeholder", ...HTMLAttributes }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(DiagramPlaceholderView);
  },
});
