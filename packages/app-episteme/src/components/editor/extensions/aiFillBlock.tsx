import { Node } from "@tiptap/core";
import {
  NodeViewContent,
  NodeViewWrapper,
  ReactNodeViewRenderer,
  type NodeViewProps,
} from "@tiptap/react";
import { Loader2, Sparkles, X } from "lucide-react";
import type React from "react";

export function AIFillBlockExtension(
  callbackRef: React.MutableRefObject<
    ((id: string, instruction: string) => void) | undefined
  >,
) {
  function AIFillBlockView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
    const isGenerating = node.attrs.generating as boolean;

    const removeBlock = () => {
      if (typeof getPos !== "function") return;
      const pos = getPos();
      if (typeof pos !== "number") return;
      editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    };

    if (isGenerating) {
      return (
        <NodeViewWrapper
          className="ai-fill-block ai-fill-block--generating"
          data-type="ai-fill-block"
          contentEditable={false}
        >
          <Loader2 size={14} className="icon-spin" />
          <span>Generating…</span>
        </NodeViewWrapper>
      );
    }

    const instruction = node.textContent.trim();
    const canGenerate = instruction.length > 0;

    return (
      <NodeViewWrapper className="ai-fill-block" data-type="ai-fill-block">
        <span className="ai-fill-block-label" contentEditable={false}>
          AI Fill
        </span>
        <div className="ai-fill-block-actions" contentEditable={false}>
          <button
            className="ai-fill-block-btn"
            onClick={() => {
              if (!canGenerate || !callbackRef.current) return;
              let blockId = node.attrs.id as string | null;
              if (!blockId) {
                blockId = crypto.randomUUID();
                updateAttributes({ id: blockId, generating: true });
              } else {
                updateAttributes({ generating: true });
              }
              callbackRef.current(blockId, instruction);
            }}
            title={canGenerate ? "Generate content" : "Type an instruction first"}
            type="button"
            disabled={!canGenerate}
          >
            <Sparkles size={12} />
          </button>
          <button
            className="ai-fill-block-btn ai-fill-block-btn--remove"
            onClick={removeBlock}
            title="Remove block"
            type="button"
          >
            <X size={12} />
          </button>
        </div>
        <NodeViewContent className="ai-fill-block-instruction" />
      </NodeViewWrapper>
    );
  }

  return Node.create({
    name: "aiFillBlock",
    group: "block",
    content: "inline*",
    selectable: true,
    draggable: true,

    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (el) => (el as HTMLElement).getAttribute("data-id"),
          renderHTML: (attrs) => (attrs.id ? { "data-id": attrs.id } : {}),
        },
        generating: {
          default: false,
          parseHTML: () => false,
          renderHTML: () => ({}),
        },
      };
    },

    parseHTML() {
      return [{ tag: 'div[data-type="ai-fill-block"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "ai-fill-block", ...HTMLAttributes }, 0];
    },

    addNodeView() {
      return ReactNodeViewRenderer(AIFillBlockView);
    },
  });
}
