import { useMemo } from "react";
import { marked } from "marked";

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export function MarkdownView({ content, className }: MarkdownViewProps) {
  const html = useMemo(() => {
    const result = marked.parse(content);
    return typeof result === "string" ? result : "";
  }, [content]);

  return (
    <div
      className={`markdown-view${className ? ` ${className}` : ""}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
