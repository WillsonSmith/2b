import { useCallback, useEffect, useRef, useState } from "react";
import { CodeBlock } from "@tiptap/extension-code-block";
import {
  NodeViewWrapper,
  NodeViewContent,
  ReactNodeViewRenderer,
} from "@tiptap/react";
import mermaid from "mermaid";
import type { NodeViewProps } from "@tiptap/core";

let mermaidReady = false;
function ensureMermaid() {
  if (!mermaidReady) {
    mermaid.initialize({
      startOnLoad: false,
      theme: "base",
      themeVariables: {
        // Backgrounds — match --bg / --bg-raised / --bg-highlight / --bg-active
        background: "#181818",
        mainBkg: "#2e3a50",
        secondaryColor: "#202020",
        tertiaryColor: "#2a2a2a",
        // Text — match --text / --text-muted
        primaryTextColor: "#d4d4d4",
        secondaryTextColor: "#d4d4d4",
        tertiaryTextColor: "#d4d4d4",
        titleColor: "#d4d4d4",
        // Borders & lines — match --accent-soft / --border / --text-muted
        primaryBorderColor: "#3d5a90",
        primaryColor: "#2e3a50",
        nodeBorder: "#3d5a90",
        lineColor: "#888888",
        clusterBkg: "#202020",
        clusterBorder: "#333333",
        // Edge labels
        edgeLabelBackground: "#202020",
        // Sequence diagrams
        actorBkg: "#2e3a50",
        actorBorder: "#3d5a90",
        actorTextColor: "#d4d4d4",
        actorLineColor: "#555555",
        signalColor: "#888888",
        signalTextColor: "#d4d4d4",
        labelBoxBkgColor: "#2a2a2a",
        labelBoxBorderColor: "#333333",
        labelTextColor: "#d4d4d4",
        loopTextColor: "#d4d4d4",
        noteBorderColor: "#3d5a90",
        noteBkgColor: "#202020",
        noteTextColor: "#d4d4d4",
        activationBorderColor: "#6699dd",
        activationBkgColor: "#2e3a50",
        // Font
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif',
      },
    });
    mermaidReady = true;
  }
}

type Pan = { x: number; y: number };

function MermaidDiagram({ svg }: { svg: string }) {
  const [scale, setScale] = useState(1);
  const [pan, setPan] = useState<Pan>({ x: 0, y: 0 });
  const dragging = useRef(false);
  const origin = useRef<Pan>({ x: 0, y: 0 });
  const panStart = useRef<Pan>({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      setScale((s) => Math.min(8, Math.max(0.2, s - e.deltaY * 0.001)));
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      dragging.current = true;
      origin.current = { x: e.clientX, y: e.clientY };
      panStart.current = pan;
    },
    [pan],
  );

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPan({
      x: panStart.current.x + (e.clientX - origin.current.x),
      y: panStart.current.y + (e.clientY - origin.current.y),
    });
  }, []);

  const stopDrag = useCallback(() => {
    dragging.current = false;
  }, []);

  const reset = useCallback(() => {
    setScale(1);
    setPan({ x: 0, y: 0 });
  }, []);

  return (
    <div
      ref={containerRef}
      className="mermaid-diagram"
      contentEditable={false}
      onMouseDown={onMouseDown}
      onMouseMove={onMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <div className="mermaid-diagram-inner">
        <div
          style={{
            width: "98%",
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
            transformOrigin: "center center",
          }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
      <button
        className="mermaid-reset"
        contentEditable={false}
        onClick={reset}
        title="Reset view"
        type="button"
      >
        ⊙
      </button>
    </div>
  );
}

function MermaidNodeView({ node, deleteNode }: NodeViewProps) {
  const language = (node.attrs as { language?: string | null }).language ?? "";
  const code = node.textContent;
  const [svg, setSvg] = useState("");
  const [errored, setErrored] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (language !== "mermaid" || !code.trim()) return;
    ensureMermaid();
    setSvg("");
    setErrored(false);
    const id = `mermaid-${Math.random().toString(36).slice(2, 9)}`;
    mermaid
      .render(id, code)
      .then(({ svg: s }) => setSvg(s))
      .catch(() => setErrored(true));
  }, [language, code]);

  if (language === "mermaid") {
    const hasDiagram = svg && !errored;
    return (
      <NodeViewWrapper className="mermaid-block">
        {hasDiagram && <MermaidDiagram svg={svg} />}
        <div className="mermaid-footer" contentEditable={false}>
          <button
            className="mermaid-toggle"
            onClick={() => setShowSource((v) => !v)}
            type="button"
          >
            {showSource ? "Hide source" : "Show source"}
          </button>
          <div className="mermaid-remove-group">
            {confirmDelete ? (
              <>
                <button
                  className="mermaid-remove mermaid-remove--confirm"
                  onClick={deleteNode}
                  type="button"
                >
                  Delete
                </button>
                <button
                  className="mermaid-remove mermaid-remove--cancel"
                  onClick={() => setConfirmDelete(false)}
                  type="button"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                className="mermaid-remove"
                onClick={() => setConfirmDelete(true)}
                type="button"
              >
                Remove
              </button>
            )}
          </div>
        </div>
        {(showSource || !hasDiagram) && (
          <pre
            className={`mermaid-source${errored ? " mermaid-source--error" : ""}`}
          >
            <NodeViewContent<"code"> as="code" />
          </pre>
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="pre">
      <NodeViewContent<"code">
        as="code"
        className={language ? `language-${language}` : undefined}
      />
    </NodeViewWrapper>
  );
}

export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },
});
