import { Node } from "@tiptap/core";
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from "@tiptap/react";
import { AlertCircle, Loader2, RotateCw, X } from "lucide-react";
import type React from "react";

/**
 * Diagram placeholder node. Renders three states:
 *   - Generating: spinner + "Generating diagram…" (initial / retry in flight)
 *   - Error:      inline error message with retry + dismiss buttons
 *   - (No success state — the placeholder is replaced by the diagram code block
 *     once a result arrives.)
 *
 * Stores `description` in attrs so retry can re-issue the same request after
 * the backend recovers (e.g. Ollama was down, user starts it, then clicks retry).
 */
export function DiagramPlaceholderExtension(
  callbackRef: React.MutableRefObject<
    ((description: string, placeholderId: string) => void) | undefined
  >,
) {
  function DiagramPlaceholderView({ node, updateAttributes, editor, getPos }: NodeViewProps) {
    const error = (node.attrs.error as string | null) ?? null;
    const description = (node.attrs.description as string | null) ?? null;

    const dismiss = () => {
      if (typeof getPos !== "function") return;
      const pos = getPos();
      if (typeof pos !== "number") return;
      editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run();
    };

    const retry = () => {
      if (!description || !callbackRef.current) return;
      updateAttributes({ error: null });
      callbackRef.current(description, node.attrs.id as string);
    };

    if (error) {
      return (
        <NodeViewWrapper className="diagram-generating diagram-generating--error" contentEditable={false}>
          <AlertCircle size={14} />
          <span className="diagram-error-text">Diagram failed: {error}</span>
          <div className="diagram-generating-actions">
            {description && (
              <button
                className="diagram-generating-btn"
                onClick={retry}
                title="Retry"
                type="button"
              >
                <RotateCw size={11} />
              </button>
            )}
            <button
              className="diagram-generating-btn"
              onClick={dismiss}
              title="Dismiss"
              type="button"
            >
              <X size={11} />
            </button>
          </div>
        </NodeViewWrapper>
      );
    }

    return (
      <NodeViewWrapper className="diagram-generating" contentEditable={false}>
        <Loader2 size={14} className="icon-spin" />
        <span>Generating diagram…</span>
        <div className="diagram-generating-actions">
          <button
            className="diagram-generating-btn"
            onClick={dismiss}
            title="Cancel"
            type="button"
          >
            <X size={11} />
          </button>
        </div>
      </NodeViewWrapper>
    );
  }

  return Node.create({
    name: "diagramPlaceholder",
    group: "block",
    atom: true,
    selectable: true,
    draggable: false,

    addAttributes() {
      return {
        id: { default: null },
        // Stored so retry can re-issue without the user re-typing.
        description: { default: null },
        // Set when the server reports a failure for this placeholder.
        error: { default: null },
      };
    },

    parseHTML() {
      // Placeholders are transient — never re-hydrated from saved markdown.
      // (Markdown serialization for atom nodes is empty by default in tiptap.)
      return [{ tag: 'div[data-type="diagram-placeholder"]' }];
    },

    renderHTML({ HTMLAttributes }) {
      return ["div", { "data-type": "diagram-placeholder", ...HTMLAttributes }];
    },

    addNodeView() {
      return ReactNodeViewRenderer(DiagramPlaceholderView);
    },
  });
}
