import { Sparkles } from "lucide-react";
import { Icon } from "../../primitives/Icon.tsx";
import { IconButton } from "../../primitives/IconButton.tsx";
import { Spinner } from "../../primitives/Spinner.tsx";
import { useDebounce } from "../../../hooks/useDebounce.ts";
import { useEditor } from "../../../state/EditorContext.tsx";
import { useFiles } from "../../../state/FileContext.tsx";
import { useSignalValue } from "../../../state/signals.ts";
import { TocEntry } from "./TocEntry.tsx";
import { extractHeadingData, scrollToHeading } from "./tocHeadings.ts";

export function TocPanel() {
  const file = useFiles();
  const editor = useEditor();
  const content = useSignalValue(file.editorContent);
  const tocEntries = useSignalValue(editor.tocEntries);
  const isAnnotating = useSignalValue(editor.isTocGenerating);

  const debouncedContent = useDebounce(content, 600);
  const headings = extractHeadingData(debouncedContent);

  const storedMap = new Map(
    tocEntries.map((e) => [e.text, { description: e.description, contentHash: e.contentHash }]),
  );

  return (
    <div className="toc-panel">
      <IconButton
        size="sm"
        icon={isAnnotating ? <Spinner size="sm" /> : <Icon icon={Sparkles} size="sm" />}
        aria-label="Add AI descriptions to each section"
        onClick={editor.handleGenerateToc}
        disabled={isAnnotating || headings.length === 0}
        className="toc-panel-annotate-btn header-icon-btn"
      />

      <div className="toc-panel-list">
        {headings.length === 0 ? (
          <div className="toc-empty">
            <p className="toc-empty-title">Table of Contents</p>
            <p className="toc-empty-body">
              Headings in your document appear here as navigation links. Add headings using{" "}
              <code>#</code> syntax or the toolbar, then click any entry to jump to that section.
            </p>
          </div>
        ) : (
          headings.map((h, i) => {
            const stored = storedMap.get(h.text);
            const isStale =
              stored?.contentHash !== undefined && stored.contentHash !== h.contentHash;
            return (
              <TocEntry
                key={`${h.text}-${i}`}
                heading={h}
                description={stored?.description}
                isStale={isStale}
                onClick={() => scrollToHeading(h.text)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
