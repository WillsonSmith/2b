import { ArrowRight, Maximize2 } from "lucide-react";
import { Button } from "../../primitives/Button.tsx";
import { Icon } from "../../primitives/Icon.tsx";
import { MarkdownView } from "../../MarkdownView.tsx";

const PLAN_PROMPT = (gapReport: string) =>
  `Based on the following identified knowledge gaps, help me plan a focused research agenda — suggest what to search for, what questions to answer first, and which gaps are highest priority:\n\n${gapReport}`;

interface GapReportSectionProps {
  gapReport: string | null;
  isDetectingGaps: boolean;
  onExpand: () => void;
  onSendToAgent: (text: string) => void;
}

export function GapReportSection({
  gapReport,
  isDetectingGaps,
  onExpand,
  onSendToAgent,
}: GapReportSectionProps) {
  if (isDetectingGaps) {
    return <div className="research-empty">Analyzing workspace for gaps…</div>;
  }
  if (!gapReport) {
    return (
      <div className="research-empty">
        Enter a topic and click <strong>Gaps</strong> to detect missing perspectives.
      </div>
    );
  }

  return (
    <div className="research-gap-report">
      <div className="research-gap-actions">
        <Button
          size="sm"
          variant="ghost"
          onClick={onExpand}
          iconLeft={<Icon icon={Maximize2} size="xs" />}
          title="Open full-screen view"
        >
          Expand
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => onSendToAgent(PLAN_PROMPT(gapReport))}
          iconRight={<Icon icon={ArrowRight} size="xs" />}
          title="Send gap report to AI for research planning"
        >
          Plan with AI
        </Button>
      </div>
      <MarkdownView content={gapReport} className="gap-markdown gap-markdown-narrow" />
    </div>
  );
}

export { PLAN_PROMPT };
