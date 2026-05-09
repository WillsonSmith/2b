import { useEffect, useState } from "react";
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

function MermaidNodeView({ node }: NodeViewProps) {
  const language = (node.attrs as { language?: string | null }).language ?? "";
  const code = node.textContent;
  const [svg, setSvg] = useState("");
  const [errored, setErrored] = useState(false);

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
    return (
      <NodeViewWrapper className="mermaid-block">
        {svg && !errored && (
          <div
            className="mermaid-diagram"
            contentEditable={false}
            dangerouslySetInnerHTML={{ __html: svg }}
          />
        )}
        <pre className={`mermaid-source${errored ? " mermaid-source--error" : ""}`}>
          <NodeViewContent<"code"> as="code" />
        </pre>
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
