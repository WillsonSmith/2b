import { useCallback, useState } from "react";

export function CopyButton({ content }: { content: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }, [content]);

  return (
    <button
      className={`copy-btn ${copied ? "copy-btn--copied" : ""}`}
      onClick={handleCopy}
      title="Copy raw markdown"
    >
      {copied ? "copied" : "copy"}
    </button>
  );
}
