import { useMemo, useCallback } from "react";
import { marked } from "marked";

marked.use({
  renderer: {
    table(token) {
      const defaultRenderer = new marked.Renderer();
      const tableHtml = defaultRenderer.table.call(this, token);
      return `<div class="table-scroll">${tableHtml}</div>`;
    },
  },
});

interface MarkdownViewProps {
  content: string;
  className?: string;
  onNavigate?: (path: string) => void;
}

export function MarkdownView({ content, className, onNavigate }: MarkdownViewProps) {
  const html = useMemo(() => {
    const result = marked.parse(content);
    return typeof result === "string" ? result : "";
  }, [content]);

  const handleClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    if (!onNavigate) return;
    const anchor = (e.target as HTMLElement).closest("a");
    if (!anchor) return;
    const href = anchor.getAttribute("href") ?? "";
    if (!href || href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("#")) return;
    e.preventDefault();
    onNavigate(href);
  }, [onNavigate]);

  return (
    <div
      className={`markdown-view${className ? ` ${className}` : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
      onClick={handleClick}
    />
  );
}
