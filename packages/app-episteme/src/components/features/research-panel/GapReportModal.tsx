import { ArrowRight } from "lucide-react";
import { Button } from "../../primitives/Button.tsx";
import { Icon } from "../../primitives/Icon.tsx";
import { ModalShell } from "../../composites/ModalShell.tsx";
import { MarkdownView } from "../../MarkdownView.tsx";
import { PLAN_PROMPT } from "./GapReportSection.tsx";
import { parseGapItems } from "./gapItems.ts";

interface GapReportModalProps {
  open: boolean;
  gapReport: string;
  onClose: () => void;
  onSearch: (query: string) => void;
  onSendToAgent: (text: string) => void;
}

export function GapReportModal({
  open,
  gapReport,
  onClose,
  onSearch,
  onSendToAgent,
}: GapReportModalProps) {
  const gapItems = parseGapItems(gapReport);

  const planWithAI = () => {
    onSendToAgent(PLAN_PROMPT(gapReport));
    onClose();
  };

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Knowledge Gaps"
      width="min(820px, 92vw)"
      className="modal-gap-expanded"
    >
      <div className="gap-expanded-body">
        <div className="gap-expanded-report">
          <MarkdownView content={gapReport} className="gap-markdown" />
        </div>

        {gapItems.length > 0 && (
          <div className="gap-actions-section">
            <div className="gap-actions-heading">Actionable Items</div>
            <div className="gap-actions-list">
              {gapItems.map((item, i) => (
                <div key={i} className="gap-action-card">
                  <span className="gap-action-text">{item}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      onSearch(item);
                      onClose();
                    }}
                    iconRight={<Icon icon={ArrowRight} size="xs" />}
                    title={`Search: ${item}`}
                  >
                    Search
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="gap-modal-footer">
          <Button
            size="sm"
            variant="solid"
            onClick={planWithAI}
            iconRight={<Icon icon={ArrowRight} size="xs" />}
            title="Send to AI for research planning"
          >
            Plan with AI
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}
