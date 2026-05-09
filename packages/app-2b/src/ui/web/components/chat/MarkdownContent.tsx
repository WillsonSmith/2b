import { marked } from "marked";

export function MarkdownContent({ content }: { content: string }) {
  const html = marked.parse(content) as string;
  return (
    <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />
  );
}
