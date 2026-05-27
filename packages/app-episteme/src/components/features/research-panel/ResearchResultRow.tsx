import { ExternalLink } from "lucide-react";
import { Badge } from "../../primitives/Badge.tsx";
import { Button } from "../../primitives/Button.tsx";
import { Icon } from "../../primitives/Icon.tsx";
import { SOURCE_META } from "./sourceMeta.ts";
import type { SearchResult } from "../../../plugins/ResearchPlugin.ts";

interface ResearchResultRowProps {
  result: SearchResult;
  onIngest: (url: string) => void;
}

export function ResearchResultRow({ result, onIngest }: ResearchResultRowProps) {
  const meta = SOURCE_META[result.source];
  const canIngest = result.source !== "workspace" && !!result.url;

  return (
    <li className="research-result">
      <div className="research-result-meta">
        <Badge tone={meta.tone}>{meta.label}</Badge>
        {result.date && <span className="research-result-date">{result.date.slice(0, 4)}</span>}
      </div>
      <div className="research-result-title">{result.title}</div>
      {result.authors.length > 0 && (
        <div className="research-result-authors">{result.authors.join(", ")}</div>
      )}
      {result.excerpt && (
        <div className="research-result-excerpt">{result.excerpt}</div>
      )}
      <div className="research-result-actions">
        {canIngest && result.url && (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onIngest(result.url!)}
            title={`Ingest: ${result.url}`}
          >
            Ingest
          </Button>
        )}
        {canIngest && result.url && (
          <a
            className="research-open-link icon-inline"
            href={result.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open <Icon icon={ExternalLink} size="xs" />
          </a>
        )}
      </div>
    </li>
  );
}
