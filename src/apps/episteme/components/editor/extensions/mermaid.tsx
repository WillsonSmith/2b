import { useCallback, useEffect, useRef, useState } from "react";
import { CodeBlock } from "@tiptap/extension-code-block";
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from "@tiptap/react";
import mermaid from "mermaid";
import type { NodeViewProps } from "@tiptap/core";

let mermaidReady = false;
function ensureMermaid() {
  if (!mermaidReady) {
    mermaid.initialize({ startOnLoad: false, theme: "default" });
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

  const onMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragging.current = true;
    origin.current = { x: e.clientX, y: e.clientY };
    panStart.current = pan;
  }, [pan]);

  const onMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current) return;
    setPan({
      x: panStart.current.x + (e.clientX - origin.current.x),
      y: panStart.current.y + (e.clientY - origin.current.y),
    });
  }, []);

  const stopDrag = useCallback(() => { dragging.current = false; }, []);

  const reset = useCallback(() => { setScale(1); setPan({ x: 0, y: 0 }); }, []);

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
          style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`, transformOrigin: "center center" }}
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

function MermaidNodeView({ node }: NodeViewProps) {
  const language = (node.attrs as { language?: string | null }).language ?? "";
  const code = node.textContent;
  const [svg, setSvg] = useState("");
  const [errored, setErrored] = useState(false);
  const [showSource, setShowSource] = useState(false);

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
        </div>
        {(showSource || !hasDiagram) && (
          <pre className={`mermaid-source${errored ? " mermaid-source--error" : ""}`}>
            <NodeViewContent<"code"> as="code" />
          </pre>
        )}
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="pre">
      <NodeViewContent<"code"> as="code" className={language ? `language-${language}` : undefined} />
    </NodeViewWrapper>
  );
}

export const MermaidCodeBlock = CodeBlock.extend({
  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },
});
